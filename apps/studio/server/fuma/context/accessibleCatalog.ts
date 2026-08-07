import {
  AccessibleContextCatalogSchema,
  type AccessibleContextCatalog,
} from '@core/fuma'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { DbClient } from '../../db/client'

export const ACCESSIBLE_CONTEXT_CATALOG_PATH = '/api/fuma/context-catalog'


export const AccessibleContextPermissionProjectionSchema = Type.Object({
  organizationId: Type.String({ minLength: 1, maxLength: 255 }),
  workspaceId: Type.String({ minLength: 1, maxLength: 255 }),
  siteId: Type.String({ minLength: 1, maxLength: 255 }),
  allow: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 512, uniqueItems: true }),
}, { additionalProperties: false })
export type AccessibleContextPermissionProjection = Static<typeof AccessibleContextPermissionProjectionSchema>
type OrganizationRow = Readonly<{
  id: string
  name: string
  status: 'active' | 'suspended'
  owner_label: string | null
}>

type WorkspaceRow = Readonly<{
  id: string
  organization_id: string
  name: string
  status: 'active' | 'archived'
  is_default: boolean
}>

type SiteRow = Readonly<{
  id: string
  organization_id: string
  workspace_id: string
  name: string
  status: 'active' | 'archived'
  profile_id: string
  capability_overrides_json: unknown
}>

/**
 * Read-only browser projection of authority the server has already established.
 *
 * The projection is informational: every scoped API call independently derives
 * immutable FUMA-021 request authority again. Returning a site here never grants
 * access. The query deliberately mirrors `PostgresFumaSiteAuthorizationAuthority`:
 * organization membership is mandatory, an explicit workspace deny wins, and a
 * site is selectable only after its tenant owner key exists.
 */
export class PostgresAccessibleContextCatalog {
  readonly #db: DbClient
  readonly #reconcileOwned?: (userId: string) => Promise<void>

  constructor(db: DbClient, reconcileOwned?: (userId: string) => Promise<void>) {
    if (db.dialect !== 'postgres') {
      throw new TypeError('Accessible context projection requires PostgreSQL.')
    }
    this.#db = db
    this.#reconcileOwned = reconcileOwned
  }

  async read(userId: string): Promise<AccessibleContextCatalog> {
    if (!userId.trim()) throw new TypeError('Accessible context projection requires a user id.')
    await this.#reconcileOwned?.(userId)

    return await this.#db.transaction(async (db) => {
      const organizations = await db<OrganizationRow>`
        select organization.id, organization.name, profile.status,
          -- The owner is a membership row, so it is read as a correlated subquery rather than a join:
          -- joining would multiply the organization row by its members and silently duplicate every
          -- organization in the catalog. A limit of one with a stable order keeps the answer
          -- deterministic if an organization somehow carries two owner rows.
          (
            select coalesce(nullif(trim(owner_account.name), ''), owner_account.email)
            from auth_members owner_membership
            join auth_users owner_account on owner_account.id=owner_membership.user_id
            where owner_membership.organization_id=organization.id
              and owner_membership.role='owner'
            order by owner_membership.created_at, owner_membership.user_id
            limit 1
          ) as owner_label
        from auth_members membership
        join auth_organizations organization on organization.id=membership.organization_id
        join fuma_organization_profiles profile on profile.organization_id=organization.id
        where membership.user_id=${userId}
          and profile.kind='customer'
          and profile.status in ('active','suspended')
        order by lower(organization.name), organization.id`

      const workspaces = await db<WorkspaceRow>`
        select workspace.id, workspace.organization_id, workspace.name,
          workspace.status, workspace.is_default
        from auth_members membership
        join fuma_organization_profiles profile
          on profile.organization_id=membership.organization_id
        join fuma_workspaces workspace
          on workspace.organization_id=membership.organization_id
        left join fuma_workspace_membership_overrides workspace_override
          on workspace_override.workspace_id=workspace.id
          and workspace_override.user_id=membership.user_id
        where membership.user_id=${userId}
          and profile.kind='customer'
          and profile.status <> 'archived'
          and coalesce(workspace_override.access, 'inherit') <> 'deny'
          and (
            workspace.status='active'
            or coalesce(
              case when workspace_override.access='grant' then workspace_override.role else null end,
              case membership.role
                when 'owner' then 'owner'
                when 'admin' then 'admin'
                when 'member' then 'editor'
                else null
              end
            ) in ('owner','admin')
          )
        order by workspace.organization_id, workspace.is_default desc,
          lower(workspace.name), workspace.id`

      const sites = await db<SiteRow>`
        select site.id, site.organization_id, site.workspace_id, site.name,
          site.status, site.profile_id, site.capability_overrides_json
        from auth_members membership
        join fuma_organization_profiles profile
          on profile.organization_id=membership.organization_id
        join fuma_workspaces workspace
          on workspace.organization_id=membership.organization_id
        join fuma_sites site
          on site.organization_id=workspace.organization_id
          and site.workspace_id=workspace.id
        join fuma_tenant_owner_keys owner
          on owner.organization_id=site.organization_id
          and owner.workspace_id=site.workspace_id
          and owner.site_id=site.id
          and owner.state in ('active','transferring')
        left join fuma_workspace_membership_overrides workspace_override
          on workspace_override.workspace_id=workspace.id
          and workspace_override.user_id=membership.user_id
        where membership.user_id=${userId}
          and profile.kind='customer'
          and profile.status <> 'archived'
          and coalesce(workspace_override.access, 'inherit') <> 'deny'
          and (
            workspace.status='active'
            or coalesce(
              case when workspace_override.access='grant' then workspace_override.role else null end,
              case membership.role
                when 'owner' then 'owner'
                when 'admin' then 'admin'
                when 'member' then 'editor'
                else null
              end
            ) in ('owner','admin')
          )
        order by site.organization_id, site.workspace_id, lower(site.name), site.id`

      const catalog: AccessibleContextCatalog = {
        organizations: organizations.rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          // Omitted rather than sent as null: the schema forbids additional properties and an absent
          // optional says "not known", where an empty string would render as an owner with no name.
          ...(row.owner_label && row.owner_label.trim().length > 0
            ? { ownerLabel: row.owner_label.trim() }
            : {}),
        })),
        workspaces: workspaces.rows.map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          name: row.name,
          status: row.status,
          isDefault: row.is_default,
        })),
        sites: sites.rows.map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          workspaceId: row.workspace_id,
          name: row.name,
          status: row.status,
          profileId: row.profile_id,
          capabilityOverrides: row.capability_overrides_json as AccessibleContextCatalog['sites'][number]['capabilityOverrides'],
        })),
      }
      if (!Value.Check(AccessibleContextCatalogSchema, catalog)) {
        throw new Error('Stored accessible context catalog failed contract validation.')
      }
      return catalog
    })
  }
}

export type AccessibleContextCatalogBoundary = Readonly<{
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}>

export function createAccessibleContextCatalogBoundary(input: Readonly<{
  catalog: PostgresAccessibleContextCatalog
  resolveSession(headers: Headers): Promise<HostedResolvedSession | null>
  handlesProductRequest(request: Request): boolean
  resolvePermissions?: (
    request: Request,
    catalog: AccessibleContextCatalog,
  ) => Promise<readonly AccessibleContextPermissionProjection[]>
}>): AccessibleContextCatalogBoundary {
  function handles(request: Request): boolean {
    return new URL(request.url).pathname === ACCESSIBLE_CONTEXT_CATALOG_PATH
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' }
    if (!input.handlesProductRequest(request)) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...headers, allow: 'GET' },
      })
    }
    const session = await input.resolveSession(request.headers)
    if (!session) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers })
    }
    const catalog = await input.catalog.read(session.userId)
    const projected = input.resolvePermissions
      ? await input.resolvePermissions(request, catalog)
      : []
    const visible = new Set(catalog.sites.map((site) => `${site.organizationId}\0${site.workspaceId}\0${site.id}`))
    const permissions = projected.map((value) => {
      if (!Value.Check(AccessibleContextPermissionProjectionSchema, value)
        || !visible.has(`${value.organizationId}\0${value.workspaceId}\0${value.siteId}`)) {
        throw new Error('Accessible context permission projection failed validation.')
      }
      return value
    })
    return new Response(JSON.stringify({ catalog, permissions }), { status: 200, headers })
  }

  return Object.freeze({ handles, handle })
}
