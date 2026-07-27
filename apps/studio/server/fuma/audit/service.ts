import {
  Type,
  Value,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  FumaJobContextSchema,
  assertFumaRequestContext,
  type FumaJobContext,
  type FumaRequestContext,
} from '../context'
import { getAuditEventCatalogEntry } from './catalog'
import {
  AuditActionSchema,
  AuditContractError,
  AuditOutcomeSchema,
  assertAuditListFilter,
  assertCreatedAuditEvent,
  type AuditActor,
  type CreatedAuditEvent,
  type AuditTenantScope,
} from './contracts'
import { redactAuditMetadata } from './redaction'
import type { AuditRepository } from './repository'

export const AuditTargetSchema = Type.Union([
  Type.Literal('platform'),
  Type.Literal('organization'),
  Type.Literal('workspace'),
  Type.Literal('site'),
])
export type AuditTarget = Static<typeof AuditTargetSchema>

const AuditRecordInputSchema = Type.Object({
  action: AuditActionSchema,
  target: AuditTargetSchema,
  outcome: AuditOutcomeSchema,
  metadata: Type.Unknown(),
}, { additionalProperties: false })
export type AuditRecordInput = Static<typeof AuditRecordInputSchema>

export interface AuditServiceOptions {
  repository: AuditRepository
  generateId?: () => string
  now?: () => Date
}

function contractError(message: string, path: string): never {
  throw new AuditContractError('invalid-contract', message, path)
}

function canonicalAuditJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalAuditJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalAuditJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return true
  seen.add(value)
  if (!Object.isFrozen(value)) return false
  return Object.values(value).every((nested) => isDeeplyFrozen(nested, seen))
}

function parseRecordInput(value: unknown): AuditRecordInput {
  if (!Value.Check(AuditRecordInputSchema, value)) {
    contractError('Audit record input is invalid.', 'input')
  }
  getAuditEventCatalogEntry(value.action)
  return structuredClone(value)
}

function requestTargetScope(
  context: FumaRequestContext,
  target: AuditTarget,
): AuditTenantScope {
  const { platform, organization, workspace, site } = context.scope
  if (target === 'platform') {
    return { kind: 'platform', platformId: platform.id }
  }
  if (target === 'organization') {
    return {
      kind: 'organization',
      platformId: platform.id,
      organizationId: organization.id,
    }
  }
  if (target === 'workspace') {
    return {
      kind: 'workspace',
      platformId: platform.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
    }
  }
  return {
    kind: 'site',
    platformId: platform.id,
    organizationId: organization.id,
    workspaceId: workspace.id,
    siteId: site.id,
  }
}

function jobTargetScope(
  context: FumaJobContext,
  target: AuditTarget,
): AuditTenantScope {
  const { platform, organization } = context.scope
  if (target === 'platform') {
    contractError(
      'Internal-job audit events require organization ancestry.',
      'input.target',
    )
  }
  if (target === 'organization') {
    return {
      kind: 'organization',
      platformId: platform.id,
      organizationId: organization.id,
    }
  }
  if (context.kind !== 'site') {
    contractError(
      `Organization job contexts cannot target ${target} resources.`,
      'input.target',
    )
  }
  if (target === 'workspace') {
    return {
      kind: 'workspace',
      platformId: platform.id,
      organizationId: organization.id,
      workspaceId: context.scope.workspace.id,
    }
  }
  return {
    kind: 'site',
    platformId: platform.id,
    organizationId: organization.id,
    workspaceId: context.scope.workspace.id,
    siteId: context.scope.site.id,
  }
}

function validateJobContext(value: unknown): FumaJobContext {
  if (!Value.Check(FumaJobContextSchema, value)) {
    contractError('Trusted job context is invalid.', 'context')
  }
  if (!isDeeplyFrozen(value)) {
    contractError('Audit integrations require an immutable trusted job context.', 'context')
  }

  const context = value
  if (
    context.actor.kind !== 'internal-job'
    || context.source.kind !== 'internal-job'
    || context.source.correlationId !== context.requestId
    || context.source.jobId !== context.actor.jobId
    || context.source.runId !== context.actor.runId
    || context.permissions.subjectId !== context.actor.jobId
    || context.scope.organization.platformId !== context.scope.platform.id
  ) {
    contractError('Trusted job actor, correlation, or ancestry is inconsistent.', 'context')
  }

  if (context.kind === 'site') {
    const baseRequestContext = {
      requestId: context.requestId,
      source: context.source,
      actor: context.actor,
      scope: context.scope,
      profile: context.profile,
      capabilities: context.capabilities,
      permissions: context.permissions,
    }
    assertFumaRequestContext(baseRequestContext)
  }
  return context
}

function validateRequestContext(value: unknown): FumaRequestContext {
  assertFumaRequestContext(value)
  if (!isDeeplyFrozen(value)) {
    contractError('Audit integrations require an immutable trusted request context.', 'context')
  }
  if (value.actor.kind !== 'staff' || value.source.kind !== 'staff-session') {
    contractError('Request audit integrations require a trusted staff context.', 'context.actor')
  }
  return value
}

export class AuditService {
  readonly #repository: AuditRepository
  readonly #generateId: () => string
  readonly #now: () => Date

  constructor(options: AuditServiceOptions) {
    this.#repository = options.repository
    this.#generateId = options.generateId ?? (() => crypto.randomUUID())
    this.#now = options.now ?? (() => new Date())
  }

  async #append(
    actor: AuditActor,
    correlation: CreatedAuditEvent['correlation'],
    scope: AuditTenantScope,
    input: AuditRecordInput,
  ): Promise<CreatedAuditEvent> {
    const id = this.#generateId()
    const now = this.#now()
    const createdAt = Number.isFinite(now.getTime()) ? now.toISOString() : ''
    const event = {
      id,
      action: input.action,
      scope,
      actor,
      correlation,
      outcome: input.outcome,
      metadata: redactAuditMetadata(input.action, input.metadata),
      createdAt,
    }
    assertCreatedAuditEvent(event)

    // Do not catch repository failures: audit durability is part of the operation.
    const persisted = await this.#repository.append(deepFreeze(structuredClone(event)))
    assertCreatedAuditEvent(persisted)
    if (canonicalAuditJson(persisted) !== canonicalAuditJson(event)) {
      throw new Error(`Audit repository returned a mismatched event for ${event.id}.`)
    }
    return deepFreeze(structuredClone(persisted))
  }

  async recordRequest(
    context: FumaRequestContext,
    input: unknown,
  ): Promise<CreatedAuditEvent> {
    const trusted = validateRequestContext(context)
    const value = parseRecordInput(input)
    return await this.#append(
      structuredClone(trusted.actor),
      { kind: 'request', requestId: trusted.requestId },
      requestTargetScope(trusted, value.target),
      value,
    )
  }

  async recordJob(
    context: FumaJobContext,
    input: unknown,
  ): Promise<CreatedAuditEvent> {
    const trusted = validateJobContext(context)
    const value = parseRecordInput(input)
    return await this.#append(
      structuredClone(trusted.actor),
      {
        kind: 'job',
        requestId: trusted.requestId,
        jobId: trusted.actor.jobId,
        runId: trusted.actor.runId,
        originatingRequestId: trusted.originatingRequestId,
      },
      jobTargetScope(trusted, value.target),
      value,
    )
  }

  async list(filter: unknown): Promise<readonly CreatedAuditEvent[]> {
    assertAuditListFilter(filter)
    const events = await this.#repository.list(structuredClone(filter))
    for (const event of events) assertCreatedAuditEvent(event)
    return deepFreeze(structuredClone(events))
  }
}
