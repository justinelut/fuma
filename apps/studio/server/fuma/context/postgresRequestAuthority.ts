import { createHash } from 'node:crypto'
import {
  CapabilityOverridesSchema,
  type LaunchPermissionPersona,
  type ResourceScope,
  type ScopedRoleAssignment,
} from '@core/fuma'
import {
  Type,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { DbClient } from '../../db/client'
import { PLATFORM_ORGANIZATION_ID } from '../organizations'
import type {
  FumaHostedSessionAuthenticator,
  FumaRequestContextAuthorityPorts,
  FumaSiteAuthorizationAuthority,
  FumaSiteAuthorizationInput,
} from './requestContext'
import { FumaSiteAuthorizationInputSchema } from './requestContext'

const StoredIdSchema = Type.String({ minLength: 1, maxLength: 255 })
const NullableStoredIdSchema = Type.Union([StoredIdSchema, Type.Null()])

const ExactSiteAuthorizationRowSchema = Type.Object({
  platform_id: StoredIdSchema,
  owner_state: Type.Union([Type.Literal('active'), Type.Literal('transferring')]),
  organization_id: StoredIdSchema,
  organization_kind: Type.Union([Type.Literal('platform'), Type.Literal('customer')]),
  organization_status: Type.Union([
    Type.Literal('active'),
    Type.Literal('suspended'),
    Type.Literal('archived'),
  ]),
  workspace_id: StoredIdSchema,
  workspace_organization_id: StoredIdSchema,
  workspace_status: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
  site_id: StoredIdSchema,
  site_organization_id: StoredIdSchema,
  site_workspace_id: StoredIdSchema,
  site_status: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
  profile_id: Type.String({
    minLength: 1,
    maxLength: 255,
    pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
  }),
  capability_overrides_json: CapabilityOverridesSchema,
  membership_id: NullableStoredIdSchema,
  membership_role: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
  override_access: Type.Union([
    Type.Literal('inherit'),
    Type.Literal('grant'),
    Type.Literal('deny'),
    Type.Null(),
  ]),
  override_role: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
}, { additionalProperties: false })

type ExactSiteAuthorizationRow = Static<typeof ExactSiteAuthorizationRowSchema>

export type HostedSessionResolver = (
  headers: Headers,
) => Promise<HostedResolvedSession | null>

export type PostgresFumaRequestContextAuthorityInput = Readonly<{
  db: DbClient
  resolveSession: HostedSessionResolver
}>

function invalidStoredAuthority(message: string): never {
  throw new Error(`Stored Fuma request authority is invalid: ${message}`)
}

/**
 * Adapts the hosted auth session resolver without consulting the request URL or
 * body. Better Auth's trusted session ID and impersonator become actor source
 * correlation; tenant selection remains exclusively the route authority's job.
 */
export function createFumaHostedSessionAuthenticator(
  resolveSession: HostedSessionResolver,
): FumaHostedSessionAuthenticator {
  return Object.freeze({
    async authenticateSameOriginHostedSession(request: Request) {
      const session = await resolveSession(request.headers)
      if (session === null) return null
      return {
        kind: 'staff',
        userId: session.userId,
        sessionId: session.sessionId,
        impersonator: session.impersonatedBy === null
          ? null
          : { userId: session.impersonatedBy },
      }
    },
  })
}

function organizationPersona(role: string): LaunchPermissionPersona {
  switch (role) {
    case 'owner': return 'owner'
    case 'admin': return 'admin'
    case 'member': return 'member'
    default: return invalidStoredAuthority(`unsupported organization role ${role}.`)
  }
}

function workspacePersona(role: string): LaunchPermissionPersona {
  switch (role) {
    case 'owner': return 'owner'
    case 'admin': return 'admin'
    case 'editor': return 'member'
    case 'viewer': return 'viewer'
    default: return invalidStoredAuthority(`unsupported workspace role ${role}.`)
  }
}

function assignment(
  id: string,
  subjectId: string,
  scope: ResourceScope,
  persona: LaunchPermissionPersona,
): ScopedRoleAssignment {
  return {
    id,
    subjectId,
    scope,
    role: { kind: 'launch-persona', persona },
  }
}

function workspaceAssignmentId(row: ExactSiteAuthorizationRow, userId: string): string {
  const digest = createHash('sha256')
    .update(`${row.platform_id}\u0000${row.organization_id}\u0000${row.workspace_id}\u0000${userId}`)
    .digest('hex')
  return `workspace-override-${digest}`
}

function roleAssignments(
  row: ExactSiteAuthorizationRow,
  subjectId: string,
): ScopedRoleAssignment[] {
  const hasMembership = row.membership_id !== null || row.membership_role !== null
  if (hasMembership && (row.membership_id === null || row.membership_role === null)) {
    invalidStoredAuthority('organization membership is incomplete.')
  }
  if (row.override_access === 'grant' && row.override_role === null) {
    invalidStoredAuthority('workspace grant has no role.')
  }
  if (row.override_access !== 'grant' && row.override_role !== null) {
    invalidStoredAuthority('non-grant workspace override has a role.')
  }
  if (row.membership_id === null || row.membership_role === null) return []
  if (row.override_access === 'deny') return []

  const organizationScope: ResourceScope = {
    kind: 'organization',
    platformId: row.platform_id,
    organizationId: row.organization_id,
  }
  const assignments = [assignment(
    row.membership_id,
    subjectId,
    organizationScope,
    organizationPersona(row.membership_role),
  )]

  if (row.override_access === 'grant') {
    assignments.push(assignment(
      workspaceAssignmentId(row, subjectId),
      subjectId,
      {
        kind: 'workspace',
        platformId: row.platform_id,
        organizationId: row.organization_id,
        workspaceId: row.workspace_id,
      },
      workspacePersona(
        row.override_role
          ?? invalidStoredAuthority('workspace grant has no role.'),
      ),
    ))
  }
  return assignments
}

function mapAuthorization(
  row: ExactSiteAuthorizationRow,
  subjectId: string,
): FumaSiteAuthorizationInput {
  const binding = {
    platformId: row.platform_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
  }
  const candidate = {
    platformOrganizationId: PLATFORM_ORGANIZATION_ID,
    platform: {
      id: row.platform_id,
      status: 'active' as const,
    },
    organization: {
      id: row.organization_id,
      platformId: row.platform_id,
      kind: row.organization_kind,
      status: row.organization_status,
    },
    workspace: {
      id: row.workspace_id,
      platformId: row.platform_id,
      organizationId: row.workspace_organization_id,
      status: row.workspace_status,
    },
    site: {
      id: row.site_id,
      platformId: row.platform_id,
      organizationId: row.site_organization_id,
      workspaceId: row.site_workspace_id,
      profileId: row.profile_id,
      status: row.site_status,
    },
    profile: {
      ...binding,
      id: row.profile_id,
      status: 'active' as const,
    },
    capabilities: {
      ...binding,
      profileId: row.profile_id,
      overrides: row.capability_overrides_json,
    },
    permissions: {
      subjectId,
      scope: {
        kind: 'site' as const,
        ...binding,
      },
      protectedOwnerInvariant: null,
      roleAssignments: roleAssignments(row, subjectId),
      permissionOverrides: [],
      customRoles: [],
    },
  }
  const parsed = safeParseValue(FumaSiteAuthorizationInputSchema, candidate)
  if (!parsed.ok) invalidStoredAuthority('exact site snapshot failed schema validation.')
  return parsed.value
}

/** PostgreSQL authority for one exact route-selected hosted site. */
export class PostgresFumaSiteAuthorizationAuthority
implements FumaSiteAuthorizationAuthority {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma request-context authority requires PostgreSQL.')
    }
    this.#db = db
  }

  async loadExactSiteAuthorization(
    input: Parameters<FumaSiteAuthorizationAuthority['loadExactSiteAuthorization']>[0],
  ): Promise<FumaSiteAuthorizationInput | null> {
    const { actor, routeScope } = input
    const result = await this.#db<ExactSiteAuthorizationRow>`
      select owner.platform_id as platform_id, owner.state as owner_state,
        organization.organization_id as organization_id,
        organization.kind as organization_kind,
        organization.status as organization_status,
        workspace.id as workspace_id,
        workspace.organization_id as workspace_organization_id,
        workspace.status as workspace_status,
        site.id as site_id,
        site.organization_id as site_organization_id,
        site.workspace_id as site_workspace_id,
        site.status as site_status,
        site.profile_id as profile_id,
        site.capability_overrides_json as capability_overrides_json,
        membership.id as membership_id,
        membership.role as membership_role,
        workspace_override.access as override_access,
        workspace_override.role as override_role
      from fuma_sites site
      join fuma_workspaces workspace
        on workspace.organization_id = site.organization_id
        and workspace.id = site.workspace_id
      join fuma_organization_profiles organization
        on organization.organization_id = site.organization_id
      join fuma_tenant_owner_keys owner
        on owner.organization_id = site.organization_id
        and owner.workspace_id = site.workspace_id
        and owner.site_id = site.id
      left join auth_members membership
        on membership.organization_id = site.organization_id
        and membership.user_id = ${actor.userId}
      left join fuma_workspace_membership_overrides workspace_override
        on workspace_override.workspace_id = site.workspace_id
        and workspace_override.user_id = ${actor.userId}
      where site.organization_id = ${routeScope.organizationId}
        and site.workspace_id = ${routeScope.workspaceId}
        and site.id = ${routeScope.siteId}
    `
    if (result.rows.length === 0) return null
    if (result.rows.length !== 1) {
      return invalidStoredAuthority('exact site lookup returned duplicate rows.')
    }
    const parsed = safeParseValue(ExactSiteAuthorizationRowSchema, result.rows[0])
    if (!parsed.ok) invalidStoredAuthority('exact site lookup returned a malformed row.')
    return mapAuthorization(parsed.value, actor.userId)
  }
}

/** Composes the two production request-context ports without mounting routes. */
export function createPostgresFumaRequestContextAuthorityPorts(
  input: PostgresFumaRequestContextAuthorityInput,
): FumaRequestContextAuthorityPorts {
  return Object.freeze({
    sessions: createFumaHostedSessionAuthenticator(input.resolveSession),
    authorization: new PostgresFumaSiteAuthorizationAuthority(input.db),
  })
}
