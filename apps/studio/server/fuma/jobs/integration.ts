import type { FumaRegistry } from '@core/fuma'
import type { DbClient } from '../../db/client'
import { createPostgresClient } from '../../db/postgres'
import {
  deriveFumaJobContext,
  type FumaJobContextAuthority,
  type FumaOrganizationJobContext,
  type FumaSiteJobContext,
} from '../context/jobContext'
import { runHostedMigrations } from '../db/hostedMigrationRunner'
import { BunRedisDriver, FumaRedisCoordination } from '../redis'
import type { FumaRuntimeComponentFactory } from '../runtime/boot'
import { createRuntimeControlComponent } from '../runtime/health'
import type { FumaRuntimeComponent, FumaRuntimeContext } from '../runtime/lifecycle'
import {
  PostgresScopedSiteRepository,
  type BoundSiteRepository,
  type BoundSiteRepositoryTransaction,
  type ScopedSiteUpdate,
  type SiteSlug,
} from '../sites'
import {
  deriveFumaRepositoryScope,
  type FumaRepositoryScope,
  type FumaRepositoryScopeOwnerKeyAuthority,
} from '../tenancy/repositoryScope'
import { PostgresFumaRepositoryScopeOwnerKeyAuthority } from '../tenancy/ownerKeyAuthority'
import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import { resolvePublicMarketingAnalyticsSchemaSentinel } from '../publicAnalytics/runtime'
import type { FumaJobAdmissionPolicy, FumaJobJsonValue } from './contracts'
import { RedisFumaJobReadyQueue, type FumaJobReadyQueue } from './readyQueue'
import { PostgresFumaJobRepository, type FumaJobRepository } from './repository'
import {
  createRecurringJobProducers,
  PostgresRecurringCustomerPaymentSource,
  PostgresRecurringCloudflareSource,
  PostgresRecurringPublicationSiteSource,
} from './runtime/composition'
import { FumaJobScheduler, createFumaJobSchedulerComponent, type FumaRecurringJobProducer } from './scheduler'
import { FumaJobService } from './service'
import {
  FumaJobWorker,
  createFumaJobWorkerComponent,
  type FumaJobHandler,
  type FumaJobHandlerContext,
} from './worker'

interface SharedDependencies {
  repository: FumaJobRepository
  readyQueue: FumaJobReadyQueue
  db?: DbClient
  coordination?: FumaRedisCoordination
}

export interface FumaScopedSiteRepositoryFactory {
  forScope(scope: FumaRepositoryScope): BoundSiteRepository
}

export interface FumaJobScopeBoundaryOptions {
  authority: FumaJobContextAuthority
  ownerKeys: FumaRepositoryScopeOwnerKeyAuthority
  siteRepositories: FumaScopedSiteRepositoryFactory
  registry?: FumaRegistry
  now?: () => Date
}

type SiteJobHandlerAuthority = Readonly<{
  jobContext: FumaSiteJobContext
  repositoryScope: FumaRepositoryScope
  siteRepository: BoundSiteRepository
}>

type OrganizationJobHandlerAuthority = Readonly<{
  jobContext: FumaOrganizationJobContext
  repositoryScope: null
  siteRepository: null
}>

export type FumaScopedJobHandlerContext =
  | (FumaJobHandlerContext & SiteJobHandlerAuthority)
  | (FumaJobHandlerContext & OrganizationJobHandlerAuthority)

export type FumaScopedJobHandler = (
  context: FumaScopedJobHandlerContext,
) => Promise<FumaJobJsonValue>

export class FumaJobScopeResolutionError extends Error {
  readonly code = 'denied' as const

  constructor() {
    super('Durable job scope authority denied.')
    this.name = 'FumaJobScopeResolutionError'
  }
}

function deny(): never {
  throw new FumaJobScopeResolutionError()
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function detachedHandlerContext(context: FumaJobHandlerContext): FumaJobHandlerContext {
  return Object.freeze({
    ...context,
    job: deepFreeze(structuredClone(context.job)),
  })
}

function trustedNow(now: () => Date): number {
  let value: Date
  try {
    value = now()
  } catch (_error) {
    deny()
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) deny()
  return value.getTime()
}

async function assertActiveClaim(
  context: FumaJobHandlerContext,
  now: () => Date,
): Promise<void> {
  const expiresAt = context.job.claimExpiresAt === null
    ? Number.NaN
    : Date.parse(context.job.claimExpiresAt)
  if (
    context.job.status !== 'running'
    || context.job.fence !== context.fence
    || context.job.attemptCount !== context.attemptNumber
    || context.job.claimedBy === null
    || !Number.isFinite(expiresAt)
    || expiresAt <= trustedNow(now)
  ) {
    deny()
  }

  let cancelled: boolean
  try {
    cancelled = await context.cancellationRequested()
  } catch (_error) {
    deny()
  }
  if (cancelled) deny()
}

function guardedTransaction(
  repository: BoundSiteRepositoryTransaction,
  guard: () => Promise<void>,
): BoundSiteRepositoryTransaction {
  return Object.freeze({
    scope: repository.scope,
    async get() {
      await guard()
      return await repository.get()
    },
    async findBySlug(slug: SiteSlug) {
      await guard()
      return await repository.findBySlug(slug)
    },
    async countActiveOwnedSites() {
      await guard()
      return await repository.countActiveOwnedSites()
    },
    async update(input: ScopedSiteUpdate) {
      await guard()
      return await repository.update(input)
    },
    async archive() {
      await guard()
      return await repository.archive()
    },
  })
}

function guardedSiteRepository(
  repository: BoundSiteRepository,
  guard: () => Promise<void>,
): BoundSiteRepository {
  return Object.freeze({
    scope: repository.scope,
    async get() {
      await guard()
      return await repository.get()
    },
    async findBySlug(slug: SiteSlug) {
      await guard()
      return await repository.findBySlug(slug)
    },
    async countActiveOwnedSites() {
      await guard()
      return await repository.countActiveOwnedSites()
    },
    async update(input: ScopedSiteUpdate) {
      await guard()
      return await repository.update(input)
    },
    async archive() {
      await guard()
      return await repository.archive()
    },
    async transaction<T>(
      work: (transaction: BoundSiteRepositoryTransaction) => Promise<T>,
    ): Promise<T> {
      await guard()
      return await repository.transaction(async (transaction) => {
        await guard()
        return await work(guardedTransaction(transaction, guard))
      })
    },
  })
}

/**
 * Resolves one claimed durable job into server-owned authority. Payload fields
 * never participate in context or owner-key lookup, and organization jobs are
 * represented without a site repository capability.
 */
export class FumaJobScopeBoundary {
  readonly #authority: FumaJobContextAuthority
  readonly #ownerKeys: FumaRepositoryScopeOwnerKeyAuthority
  readonly #siteRepositories: FumaScopedSiteRepositoryFactory
  readonly #registry?: FumaRegistry
  readonly #now: () => Date

  constructor(options: FumaJobScopeBoundaryOptions) {
    this.#authority = options.authority
    this.#ownerKeys = options.ownerKeys
    this.#siteRepositories = options.siteRepositories
    this.#registry = options.registry
    this.#now = options.now ?? (() => new Date())
  }

  async bind(context: FumaJobHandlerContext): Promise<FumaScopedJobHandlerContext> {
    const detached = detachedHandlerContext(context)
    const guard = async () => await assertActiveClaim(detached, this.#now)

    try {
      await guard()
      const jobContext = await deriveFumaJobContext({
        jobRecord: detached.job,
        authority: this.#authority,
        ...(this.#registry ? { registry: this.#registry } : {}),
        now: this.#now,
      })
      await guard()

      if (jobContext.kind === 'organization') {
        return Object.freeze({
          ...detached,
          jobContext,
          repositoryScope: null,
          siteRepository: null,
        })
      }

      const repositoryScope = await deriveFumaRepositoryScope({
        trustedContext: { kind: 'job', context: jobContext },
        ownerKeys: this.#ownerKeys,
      })
      await guard()
      const siteRepository = guardedSiteRepository(
        this.#siteRepositories.forScope(repositoryScope),
        guard,
      )
      return Object.freeze({
        ...detached,
        jobContext,
        repositoryScope,
        siteRepository,
      })
    } catch (error) {
      if (error instanceof FumaJobScopeResolutionError) throw error
      deny()
    }
  }
}

/** Converts authority-consuming handlers into the neutral FUMA-009 worker map. */
export function scopeFumaJobHandlers(
  handlers: Readonly<Record<string, FumaScopedJobHandler>>,
  boundary: FumaJobScopeBoundary,
): Readonly<Record<string, FumaJobHandler>> {
  const scoped = Object.fromEntries(Object.entries(handlers).map(([kind, handler]) => [
    kind,
    async (context: FumaJobHandlerContext) => await handler(await boundary.bind(context)),
  ]))
  return Object.freeze(scoped)
}

export interface FumaJobIntegrationOptions {
  env?: Readonly<Record<string, unknown>>
  repository?: FumaJobRepository
  readyQueue?: FumaJobReadyQueue
  coordination?: FumaRedisCoordination
  db?: DbClient
  admission?: FumaJobAdmissionPolicy
  handlers?: Readonly<Record<string, FumaScopedJobHandler>>
  recurringProducers?: readonly FumaRecurringJobProducer[]
  jobAuthority?: FumaJobContextAuthority
  ownerKeys?: FumaRepositoryScopeOwnerKeyAuthority
  siteRepositories?: FumaScopedSiteRepositoryFactory
  registry?: FumaRegistry
  instanceId?: string
  now?: () => Date
}

const DEFAULT_ADMISSION: FumaJobAdmissionPolicy = {
  maxActivePerOrganization: 10_000,
  maxActivePerSite: 2_000,
}

function requiredEnv(env: Readonly<Record<string, unknown>>, name: string): string {
  const value = env[name]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required for Fuma durable jobs.`)
  return value
}

function redisNamespace(env: Readonly<Record<string, unknown>>): string {
  const explicit = env.FUMA_REDIS_NAMESPACE
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const host = typeof env.FUMA_PRODUCT_HOST === 'string' ? env.FUMA_PRODUCT_HOST : 'local'
  return host.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 63)
}

async function dependencies(options: FumaJobIntegrationOptions, needsCoordination: boolean): Promise<SharedDependencies> {
  const env = options.env ?? process.env
  const db = options.db ?? (options.repository ? undefined : createPostgresClient(requiredEnv(env, 'DATABASE_URL')))
  if (db) await runHostedMigrations(db)
  const repository = options.repository ?? new PostgresFumaJobRepository(db!)
  const readyQueue = options.readyQueue ?? new RedisFumaJobReadyQueue(
    requiredEnv(env, 'FUMA_REDIS_URL'),
    redisNamespace(env),
  )
  const coordination = needsCoordination
    ? options.coordination ?? new FumaRedisCoordination({
      namespace: redisNamespace(env),
      driver: new BunRedisDriver(requiredEnv(env, 'FUMA_REDIS_URL')),
    })
    : undefined
  return { repository, readyQueue, db, coordination }
}

function workerHandlers(
  options: FumaJobIntegrationOptions,
  db: DbClient | undefined,
): Readonly<Record<string, FumaJobHandler>> {
  const handlers = options.handlers ?? {}
  if (Object.keys(handlers).length === 0) return Object.freeze({})
  if (!options.jobAuthority) {
    throw new Error('Fuma durable-job handlers require trusted job authority.')
  }
  const ownerKeys = options.ownerKeys
    ?? (db ? new PostgresFumaRepositoryScopeOwnerKeyAuthority(db) : undefined)
  const siteRepositories = options.siteRepositories
    ?? (db ? new PostgresScopedSiteRepository(db, options.now) : undefined)
  if (!ownerKeys || !siteRepositories) {
    throw new Error('Fuma durable-job handlers require server-owned site scope authority.')
  }
  return scopeFumaJobHandlers(handlers, new FumaJobScopeBoundary({
    authority: options.jobAuthority,
    ownerKeys,
    siteRepositories,
    ...(options.registry ? { registry: options.registry } : {}),
    ...(options.now ? { now: options.now } : {}),
  }))
}

function controlComponent(input: Parameters<FumaRuntimeComponentFactory>[0]): FumaRuntimeComponent {
  return createRuntimeControlComponent({
    id: input.id,
    role: input.role,
    port: input.settings.healthPort,
    log: input.log,
  })
}

/** Factory for the worker root; every mounted handler receives trusted scope. */
export function createFumaJobWorkerComponentFactory(options: FumaJobIntegrationOptions = {}): FumaRuntimeComponentFactory {
  return (input) => {
    if (input.id !== 'durable-job-worker') return controlComponent(input)
    return {
      id: input.id,
      async start(context: FumaRuntimeContext) {
        const deps = await dependencies(options, false)
        const handlers = workerHandlers(options, deps.db)
        await deps.readyQueue.connect()
        const worker = new FumaJobWorker({
          repository: deps.repository,
          readyQueue: deps.readyQueue,
          handlers,
          workerId: options.instanceId ?? `worker-${crypto.randomUUID()}`,
          now: options.now,
        })
        await worker.rebuildReadyQueue()
        const handle = await createFumaJobWorkerComponent(worker).start(context)
        return {
          beginDrain: () => handle?.beginDrain?.(),
          async stop() {
            await handle?.stop?.()
            await deps.readyQueue.close()
          },
        }
      },
    }
  }
}

/** Factory for the scheduler root; Redis leases coordinate, while PostgreSQL fences every cursor update. */
export function createFumaJobSchedulerComponentFactory(options: FumaJobIntegrationOptions = {}): FumaRuntimeComponentFactory {
  return (input) => {
    if (input.id !== 'durable-job-scheduler') return controlComponent(input)
    return {
      id: input.id,
      async start(context: FumaRuntimeContext) {
        const deps = await dependencies(options, true)
        await Promise.all([deps.readyQueue.connect(), deps.coordination!.connect()])
        const admission = options.admission ?? DEFAULT_ADMISSION
        const producers = options.recurringProducers ?? (deps.db
          ? createRecurringJobProducers({
              jobs: new FumaJobService({
                repository: deps.repository,
                readyQueue: deps.readyQueue,
                admission,
                ...(options.now ? { now: options.now } : {}),
              }),
              publicationSites: new PostgresRecurringPublicationSiteSource(deps.db),
              customerPayments: new PostgresRecurringCustomerPaymentSource(deps.db),
              cloudflare: new PostgresRecurringCloudflareSource(deps.db),
              publicMarketingRetentionEnabled: await resolvePublicMarketingAnalyticsSchemaSentinel(deps.db) !== undefined,
              protectedOrganizationId: PLATFORM_ORGANIZATION_ID,
            })
          : [])
        const scheduler = new FumaJobScheduler({
          repository: deps.repository,
          readyQueue: deps.readyQueue,
          coordination: deps.coordination!,
          admission,
          schedulerId: options.instanceId ?? `scheduler-${crypto.randomUUID()}`,
          producers,
          now: options.now,
        })
        const handle = await createFumaJobSchedulerComponent(scheduler).start(context)
        return {
          beginDrain: () => handle?.beginDrain?.(),
          async stop() {
            await handle?.stop?.()
            await Promise.all([deps.readyQueue.close(), deps.coordination!.close()])
          },
        }
      },
    }
  }
}
