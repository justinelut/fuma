import { fumaLaunchRegistry } from '@core/fuma'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { DbClient } from '../../db/client'
import { FreeHostService, PostgresFreeHostRepository } from '../freeHosts'
import { PostgresSiteRepository, SiteService, normalizeSiteSlug } from '../sites'
import { PostgresWorkspaceRepository, WorkspaceService, normalizeWorkspaceSlug } from '../workspaces'

export const HOSTED_SITE_ONBOARDING_PATH = '/api/fuma/onboarding/site'
const Strict = { additionalProperties: false } as const

export const HostedSiteOnboardingInputSchema = Type.Object({
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  workspaceName: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  siteName: Type.String({ minLength: 1, maxLength: 255 }),
  siteSlug: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  profileId: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
}, Strict)
export type HostedSiteOnboardingInput = Static<typeof HostedSiteOnboardingInputSchema>

export const HostedSiteOnboardingResultSchema = Type.Object({
  organizationId: Type.String({ minLength: 1 }),
  workspaceId: Type.String({ minLength: 1 }),
  siteId: Type.String({ minLength: 1 }),
  siteSlug: Type.String({ minLength: 1 }),
  host: Type.String({ minLength: 1 }),
  profileId: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
  created: Type.Object({ workspace: Type.Boolean(), site: Type.Boolean(), ownerKey: Type.Boolean(), freeHost: Type.Boolean() }, Strict),
}, Strict)
export type HostedSiteOnboardingResult = Static<typeof HostedSiteOnboardingResultSchema>

export class HostedSiteOnboardingError extends Error {
  override readonly name = 'HostedSiteOnboardingError'
  readonly status: 400 | 403 | 409

  constructor(status: 400 | 403 | 409, message: string) {
    super(message)
    this.status = status
  }
}

function generatedId(prefix: 'workspace' | 'site' | 'owner'): string {
  return `${prefix}-${crypto.randomUUID()}`
}

/**
 * Creates the first editable tenant context as one PostgreSQL transaction.
 * Existing domain services remain the source of lifecycle/profile validation;
 * nested service transactions use DbClient savepoints.
 */
export class HostedSiteOnboardingService {
  readonly #db: DbClient
  readonly #freeHostSuffix: string
  readonly #limits?: Readonly<{ limits(organizationId: string): Promise<Readonly<{ sites: number; pages: number }>> }>

  constructor(db: DbClient, freeHostSuffix: string, limits?: Readonly<{ limits(organizationId: string): Promise<Readonly<{ sites: number; pages: number }>> }>) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted site onboarding requires PostgreSQL.')
    if (!freeHostSuffix.startsWith('.')) throw new TypeError('Hosted site onboarding requires a free-host suffix.')
    this.#db = db
    this.#freeHostSuffix = freeHostSuffix
    this.#limits = limits
  }

  async provision(actorUserId: string, rawInput: unknown): Promise<HostedSiteOnboardingResult> {
    const parsed = safeParseValue(HostedSiteOnboardingInputSchema, rawInput)
    if (!parsed.ok) throw new HostedSiteOnboardingError(400, 'Site onboarding input is invalid.')
    const input = parsed.value
    const siteSlug = normalizeSiteSlug(input.siteSlug ?? input.siteName)
    const workspaceName = input.workspaceName?.trim() || 'Default workspace'
    const workspaceSlug = normalizeWorkspaceSlug(workspaceName)
    if (!siteSlug || !workspaceSlug) throw new HostedSiteOnboardingError(400, 'Site or workspace name cannot produce a valid slug.')

    return await this.#db.transaction(async (db) => {
      await db`select pg_advisory_xact_lock(hashtextextended(${'fuma:onboarding:' + input.organizationId},0))`
      const authority = await db<Readonly<{
        role: string
        kind: string
        status: string
        max_workspaces: number
        max_sites: number
      }>>`
        select member.role,profile.kind,profile.status,limits.max_workspaces,limits.max_sites
        from auth_members member
        join fuma_organization_profiles profile on profile.organization_id=member.organization_id
        join fuma_organization_limits limits on limits.organization_id=member.organization_id
        where member.organization_id=${input.organizationId} and member.user_id=${actorUserId}`
      const grant = authority.rows[0]
      if (!grant || grant.kind !== 'customer' || grant.status !== 'active' || grant.role !== 'owner') {
        throw new HostedSiteOnboardingError(403, 'Only an active customer organization owner can create its first site.')
      }

      const siteRepository = new PostgresSiteRepository(db)
      const workspaceService = new WorkspaceService({
        repository: new PostgresWorkspaceRepository(db),
        siteCountGuard: siteRepository,
      })
      const siteService = new SiteService({ repository: siteRepository, registry: fumaLaunchRegistry })

      const existingWorkspaces = await workspaceService.list(input.organizationId)
      let workspace = existingWorkspaces.find((value) => value.status === 'active' && value.isDefault)
      let workspaceCreated = false
      if (!workspace) {
        if (existingWorkspaces.length >= grant.max_workspaces) {
          throw new HostedSiteOnboardingError(409, 'The organization workspace limit has been reached.')
        }
        workspace = await workspaceService.create({
          id: generatedId('workspace'),
          organizationId: input.organizationId,
          slug: workspaceSlug,
          name: workspaceName,
          isDefault: true,
        })
        workspaceCreated = true
      }

      const existingSites = await siteService.list(input.organizationId, workspace.id)
      let site = existingSites.find((value) => value.slug === siteSlug)
      let siteCreated = false
      if (site && site.profileId !== input.profileId) {
        throw new HostedSiteOnboardingError(409, 'A site with this slug already uses a different product profile.')
      }
      if (!site) {
        const count = await db<Readonly<{ count: number }>>`
          select count(*)::int count from fuma_sites where organization_id=${input.organizationId}`
        const entitlementLimit = this.#limits ? (await this.#limits.limits(input.organizationId)).sites : grant.max_sites
        const siteLimit = Math.min(grant.max_sites, entitlementLimit)
        if ((count.rows[0]?.count ?? 0) >= siteLimit) {
          throw new HostedSiteOnboardingError(409, `The ${siteLimit === 1 ? 'free tier one-site' : 'organization site'} limit has been reached.`)
        }
        site = await siteService.create({
          id: generatedId('site'),
          organizationId: input.organizationId,
          workspaceId: workspace.id,
          slug: siteSlug,
          name: input.siteName.trim(),
          profileId: input.profileId,
          capabilityOverrides: { grant: [], revoke: [] },
        })
        siteCreated = true
      }

      const existingOwner = await db<Readonly<{ owner_key: string; generation: number }>>`
        select owner_key,generation from fuma_tenant_owner_keys
        where platform_id='fuma' and organization_id=${input.organizationId}
          and workspace_id=${workspace.id} and site_id=${site.id}`
      let ownerKeyCreated = false
      let ownerKey: string
      let ownerGeneration: number
      if (existingOwner.rows.length === 0) {
        ownerKey = generatedId('owner')
        ownerGeneration = 1
        await db`
          insert into fuma_tenant_owner_keys(
            platform_id,owner_key,organization_id,workspace_id,site_id,state,generation
          ) values(
            'fuma',${ownerKey},${input.organizationId},${workspace.id},${site.id},'active',${ownerGeneration}
          )`
        ownerKeyCreated = true
      } else if (existingOwner.rows.length === 1) {
        ownerKey = existingOwner.rows[0]!.owner_key
        ownerGeneration = Number(existingOwner.rows[0]!.generation)
      } else {
        throw new Error('Site onboarding found duplicate tenant owner-key authority.')
      }

      const existingHost = await db<Readonly<{ host: string; owner_key: string; owner_generation: number }>>`
        select host,owner_key,owner_generation from fuma_free_hosts_v2
        where platform_id='fuma' and organization_id=${input.organizationId}
          and workspace_id=${workspace.id} and site_id=${site.id}`
      let freeHostCreated = false
      let host: string
      if (existingHost.rows.length === 0) {
        const freeHostRepository = new PostgresFreeHostRepository(db)
        const freeHosts = new FreeHostService(
          freeHostRepository,
          freeHostRepository,
          () => new Date(),
          this.#freeHostSuffix,
        )
        const allocated = await freeHosts.allocate({
          label: site.slug,
          platformId: 'fuma',
          organizationId: input.organizationId,
          workspaceId: workspace.id,
          siteId: site.id,
          ownerKey,
          ownerGeneration,
        })
        host = allocated.host
        freeHostCreated = true
      } else if (
        existingHost.rows.length === 1
        && existingHost.rows[0]!.owner_key === ownerKey
        && Number(existingHost.rows[0]!.owner_generation) === ownerGeneration
      ) {
        host = existingHost.rows[0]!.host
      } else {
        throw new Error('Site onboarding found conflicting free-host authority.')
      }

      return {
        organizationId: input.organizationId,
        workspaceId: workspace.id,
        siteId: site.id,
        siteSlug: site.slug,
        host,
        profileId: site.profileId as 'website' | 'publication',
        created: { workspace: workspaceCreated, site: siteCreated, ownerKey: ownerKeyCreated, freeHost: freeHostCreated },
      }
    })
  }
}

export type HostedSiteOnboardingBoundary = Readonly<{
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}>

export function createHostedSiteOnboardingBoundary(input: Readonly<{
  service: HostedSiteOnboardingService
  resolveSession(headers: Headers): Promise<HostedResolvedSession | null>
  handlesProductRequest(request: Request): boolean
  allowsMutationOrigin(request: Request): boolean
}>): HostedSiteOnboardingBoundary {
  function handles(request: Request): boolean {
    return new URL(request.url).pathname === HOSTED_SITE_ONBOARDING_PATH
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' }
    if (!input.handlesProductRequest(request)) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...headers, allow: 'POST' } })
    if (!input.allowsMutationOrigin(request)) return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers })
    const session = await input.resolveSession(request.headers)
    if (!session) return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers })
    let body: unknown
    try { body = await request.json() } catch { return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers }) }
    try {
      const result = await input.service.provision(session.userId, body)
      if (!safeParseValue(HostedSiteOnboardingResultSchema, result).ok) throw new Error('Onboarding response failed validation.')
      return new Response(JSON.stringify({ result }), { status: 200, headers })
    } catch (error) {
      if (error instanceof HostedSiteOnboardingError) {
        return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers })
      }
      throw error
    }
  }

  return Object.freeze({ handles, handle })
}
