import {
  CapabilityOverridesSchema,
  CustomRoleDefinitionSchema,
  PermissionSubjectIdSchema,
  ProtectedOwnerInvariantSchema,
  ScopedPermissionOverrideSchema,
  ScopedRoleAssignmentSchema,
  SiteResourceScopeSchema,
  fumaLaunchRegistry,
  type FumaRegistry,
  type PermissionId,
  type SiteResourceScope,
} from '@core/fuma'
import {
  Type,
  Value,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  resolveLayeredPermissions,
  type LayeredRoleResolverInput,
} from '../permissions'
import {
  FumaContextIdSchema,
  FumaPlatformContextStatusSchema,
  FumaProfileStatusSchema,
  FumaSiteContextStatusSchema,
  FumaStaffActorSchema,
  FumaWorkspaceContextStatusSchema,
  assertUntrustedFumaRouteScope,
  freezeFumaRequestContext,
  type FumaRequestContext,
  type FumaStaffActor,
  type UntrustedFumaRouteScope,
} from './contracts'

const OrganizationAuthorityStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('suspended'),
  Type.Literal('archived'),
])

const ExactSiteBindingSchema = {
  platformId: FumaContextIdSchema,
  organizationId: FumaContextIdSchema,
  workspaceId: FumaContextIdSchema,
  siteId: FumaContextIdSchema,
}

/**
 * One server-authoritative authorization snapshot. Repeated ancestry keys are
 * deliberate: they make every independently loaded profile, capability, and
 * permission component non-replayable across tenants, even when lower IDs
 * collide.
 */
export const FumaSiteAuthorizationInputSchema = Type.Object({
  platformOrganizationId: FumaContextIdSchema,
  platform: Type.Object({
    id: FumaContextIdSchema,
    status: FumaPlatformContextStatusSchema,
  }, { additionalProperties: false }),
  organization: Type.Object({
    id: FumaContextIdSchema,
    platformId: FumaContextIdSchema,
    kind: Type.Union([Type.Literal('platform'), Type.Literal('customer')]),
    status: OrganizationAuthorityStatusSchema,
  }, { additionalProperties: false }),
  workspace: Type.Object({
    id: FumaContextIdSchema,
    platformId: FumaContextIdSchema,
    organizationId: FumaContextIdSchema,
    status: FumaWorkspaceContextStatusSchema,
  }, { additionalProperties: false }),
  site: Type.Object({
    id: FumaContextIdSchema,
    platformId: FumaContextIdSchema,
    organizationId: FumaContextIdSchema,
    workspaceId: FumaContextIdSchema,
    profileId: Type.String({
      minLength: 1,
      maxLength: 255,
      pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
    }),
    status: FumaSiteContextStatusSchema,
  }, { additionalProperties: false }),
  profile: Type.Object({
    ...ExactSiteBindingSchema,
    id: Type.String({
      minLength: 1,
      maxLength: 255,
      pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
    }),
    status: FumaProfileStatusSchema,
  }, { additionalProperties: false }),
  capabilities: Type.Object({
    ...ExactSiteBindingSchema,
    profileId: Type.String({
      minLength: 1,
      maxLength: 255,
      pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
    }),
    overrides: CapabilityOverridesSchema,
  }, { additionalProperties: false }),
  permissions: Type.Object({
    subjectId: PermissionSubjectIdSchema,
    scope: SiteResourceScopeSchema,
    protectedOwnerInvariant: Type.Union([ProtectedOwnerInvariantSchema, Type.Null()]),
    roleAssignments: Type.Array(ScopedRoleAssignmentSchema),
    permissionOverrides: Type.Array(ScopedPermissionOverrideSchema),
    customRoles: Type.Array(CustomRoleDefinitionSchema),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

export type FumaSiteAuthorizationInput = Static<
  typeof FumaSiteAuthorizationInputSchema
>

/** Authenticates only the hosted same-origin session; tenant claims are out of scope. */
export interface FumaHostedSessionAuthenticator {
  authenticateSameOriginHostedSession(request: Request): Promise<unknown | null>
}

/** Loads one joined authorization snapshot from server-owned persistence. */
export interface FumaSiteAuthorizationAuthority {
  loadExactSiteAuthorization(input: Readonly<{
    actor: FumaStaffActor
    routeScope: UntrustedFumaRouteScope
  }>): Promise<unknown | null>
}

export type FumaRequestContextAuthorityPorts = Readonly<{
  sessions: FumaHostedSessionAuthenticator
  authorization: FumaSiteAuthorizationAuthority
}>

export type DeriveFumaRequestContextInput = Readonly<{
  request: Request
  routeScope: unknown
  requiredPermission: PermissionId
  ports: FumaRequestContextAuthorityPorts
  registry?: FumaRegistry
  generateRequestId?: () => string
}>

export type FumaRequestContextResolutionErrorCode =
  | 'unauthenticated'
  | 'denied'
  | 'invalid-trusted-authority'

export class FumaRequestContextResolutionError extends Error {
  readonly code: FumaRequestContextResolutionErrorCode
  readonly status: 401 | 404 | 500

  constructor(
    code: FumaRequestContextResolutionErrorCode,
    status: 401 | 404 | 500,
    message: string,
  ) {
    super(message)
    this.name = 'FumaRequestContextResolutionError'
    this.code = code
    this.status = status
  }
}

const FORBIDDEN_TENANT_AUTHORITY_HEADERS = Object.freeze(new Set([
  'x-actor',
  'x-actor-id',
  'x-actor-user-id',
  'x-capabilities',
  'x-capability-id',
  'x-organization-id',
  'x-permission-id',
  'x-permissions',
  'x-platform-id',
  'x-profile-id',
  'x-site-id',
  'x-tenant-id',
  'x-user-id',
  'x-workspace-id',
]))

const FORBIDDEN_FUMA_AUTHORITY_HEADER_MARKERS = Object.freeze([
  'actor',
  'capabilit',
  'correlation',
  'impersonat',
  'invariant',
  'job',
  'organization',
  'permission',
  'platform',
  'profile',
  'request',
  'role',
  'run',
  'scope',
  'session',
  'site',
  'source',
  'tenant',
  'user',
  'workspace',
])

function deny(): never {
  throw new FumaRequestContextResolutionError(
    'denied',
    404,
    'Resource not found.',
  )
}

function unauthenticated(): never {
  throw new FumaRequestContextResolutionError(
    'unauthenticated',
    401,
    'Authentication required.',
  )
}

function invalidTrustedAuthority(message: string): never {
  throw new FumaRequestContextResolutionError(
    'invalid-trusted-authority',
    500,
    message,
  )
}

function hasCallerTenantAuthority(request: Request): boolean {
  for (const name of request.headers.keys()) {
    const normalized = name.toLowerCase()
    if (FORBIDDEN_TENANT_AUTHORITY_HEADERS.has(normalized)) return true
    if (
      normalized.startsWith('x-fuma-')
      && FORBIDDEN_FUMA_AUTHORITY_HEADER_MARKERS.some((marker) => (
        normalized.includes(marker)
      ))
    ) {
      return true
    }
  }
  return false
}

function readStaffActor(value: unknown): FumaStaffActor {
  const parsed = safeParseValue(FumaStaffActorSchema, value)
  if (!parsed.ok) {
    return invalidTrustedAuthority('Hosted session authority returned an invalid actor.')
  }
  return structuredClone(parsed.value)
}

function readRouteScope(value: unknown): UntrustedFumaRouteScope {
  try {
    assertUntrustedFumaRouteScope(value)
    return structuredClone(value)
  } catch (_error) {
    deny()
  }
}

export function readAuthorization(value: unknown): FumaSiteAuthorizationInput {
  const parsed = safeParseValue(FumaSiteAuthorizationInputSchema, value)
  if (!parsed.ok) deny()
  return structuredClone(parsed.value)
}

function exactSiteScope(authorization: FumaSiteAuthorizationInput): SiteResourceScope {
  return {
    kind: 'site',
    platformId: authorization.platform.id,
    organizationId: authorization.organization.id,
    workspaceId: authorization.workspace.id,
    siteId: authorization.site.id,
  }
}

function hasExactBinding(
  binding: {
    readonly platformId: string
    readonly organizationId: string
    readonly workspaceId: string
    readonly siteId: string
  },
  scope: SiteResourceScope,
): boolean {
  return binding.platformId === scope.platformId
    && binding.organizationId === scope.organizationId
    && binding.workspaceId === scope.workspaceId
    && binding.siteId === scope.siteId
}

function assertExactAuthority(
  actor: FumaStaffActor,
  routeScope: UntrustedFumaRouteScope,
  authorization: FumaSiteAuthorizationInput,
): void {
  const scope = exactSiteScope(authorization)
  if (
    authorization.organization.id !== routeScope.organizationId
    || authorization.workspace.id !== routeScope.workspaceId
    || authorization.site.id !== routeScope.siteId
    || authorization.organization.platformId !== scope.platformId
    || authorization.workspace.platformId !== scope.platformId
    || authorization.workspace.organizationId !== scope.organizationId
    || authorization.site.platformId !== scope.platformId
    || authorization.site.organizationId !== scope.organizationId
    || authorization.site.workspaceId !== scope.workspaceId
    || !hasExactBinding(authorization.profile, scope)
    || !hasExactBinding(authorization.capabilities, scope)
    || authorization.profile.id !== authorization.site.profileId
    || authorization.capabilities.profileId !== authorization.profile.id
    || authorization.permissions.subjectId !== actor.userId
    || authorization.permissions.scope.kind !== 'site'
    || authorization.permissions.scope.platformId !== scope.platformId
    || authorization.permissions.scope.organizationId !== scope.organizationId
    || authorization.permissions.scope.workspaceId !== scope.workspaceId
    || authorization.permissions.scope.siteId !== scope.siteId
  ) {
    deny()
  }
}

function assertActiveAuthority(authorization: FumaSiteAuthorizationInput): void {
  if (
    authorization.platform.status !== 'active'
    || authorization.organization.status !== 'active'
    || authorization.workspace.status !== 'active'
    || authorization.site.status !== 'active'
    || authorization.profile.status !== 'active'
  ) {
    deny()
  }
}

function requestId(generateRequestId: () => string): string {
  const generated = generateRequestId()
  if (!Value.Check(FumaContextIdSchema, generated)) {
    invalidTrustedAuthority('Trusted request ID generator returned an invalid identifier.')
  }
  return generated
}

export function permissionInput(
  authorization: FumaSiteAuthorizationInput,
): LayeredRoleResolverInput {
  return {
    subjectId: authorization.permissions.subjectId,
    platformOrganizationId: authorization.platformOrganizationId,
    scope: authorization.permissions.scope,
    organization: {
      id: authorization.organization.id,
      platformId: authorization.organization.platformId,
      kind: authorization.organization.kind,
      status: authorization.organization.status,
    },
    workspace: {
      id: authorization.workspace.id,
      platformId: authorization.workspace.platformId,
      organizationId: authorization.workspace.organizationId,
      status: authorization.workspace.status,
    },
    site: {
      id: authorization.site.id,
      platformId: authorization.site.platformId,
      organizationId: authorization.site.organizationId,
      workspaceId: authorization.site.workspaceId,
      status: authorization.site.status,
      profileId: authorization.profile.id,
      capabilityOverrides: authorization.capabilities.overrides,
    },
    protectedOwnerInvariant: authorization.permissions.protectedOwnerInvariant,
    roleAssignments: authorization.permissions.roleAssignments,
    permissionOverrides: authorization.permissions.permissionOverrides,
    customRoles: authorization.permissions.customRoles,
  }
}

/**
 * Derives one request authority snapshot without consulting request body or
 * tenant headers. Authentication happens first so 401 is reserved for a
 * genuinely absent hosted session; every tenant existence/authorization
 * difference then collapses to the same non-leaking 404 denial.
 */
export async function deriveFumaRequestContext(
  input: DeriveFumaRequestContextInput,
): Promise<FumaRequestContext> {
  const rawActor = await input.ports.sessions.authenticateSameOriginHostedSession(
    input.request,
  )
  if (rawActor === null) unauthenticated()
  const actor = readStaffActor(rawActor)

  if (hasCallerTenantAuthority(input.request)) deny()

  const routeScope = readRouteScope(input.routeScope)
  const rawAuthorization = await input.ports.authorization.loadExactSiteAuthorization({
    actor: structuredClone(actor),
    routeScope: structuredClone(routeScope),
  })
  if (rawAuthorization === null) deny()
  const authorization = readAuthorization(rawAuthorization)

  assertExactAuthority(actor, routeScope, authorization)

  const registry = input.registry ?? fumaLaunchRegistry
  let composed: ReturnType<FumaRegistry['compose']>
  let resolved: ReturnType<typeof resolveLayeredPermissions>
  try {
    composed = registry.compose(
      authorization.profile.id,
      authorization.capabilities.overrides,
    )
    resolved = resolveLayeredPermissions(permissionInput(authorization), registry)
  } catch (_error) {
    deny()
  }

  const capabilityIds = composed.capabilities.map(({ id }) => id)
  if (
    resolved.profileId !== authorization.profile.id
    || resolved.subjectId !== actor.userId
    || resolved.activeCapabilityIds.length !== capabilityIds.length
    || resolved.activeCapabilityIds.some((id, index) => id !== capabilityIds[index])
    || !resolved.allowedPermissionIds.includes(input.requiredPermission)
  ) {
    deny()
  }

  assertActiveAuthority(authorization)

  const generatedRequestId = requestId(
    input.generateRequestId ?? (() => crypto.randomUUID()),
  )
  return freezeFumaRequestContext({
    requestId: generatedRequestId,
    source: {
      kind: 'staff-session',
      correlationId: generatedRequestId,
      userId: actor.userId,
      sessionId: actor.sessionId,
      impersonatedBy: actor.impersonator?.userId ?? null,
    },
    actor,
    scope: {
      platform: {
        id: authorization.platform.id,
        status: authorization.platform.status,
      },
      organization: {
        id: authorization.organization.id,
        platformId: authorization.organization.platformId,
        status: authorization.organization.status,
      },
      workspace: {
        id: authorization.workspace.id,
        platformId: authorization.workspace.platformId,
        organizationId: authorization.workspace.organizationId,
        status: authorization.workspace.status,
      },
      site: {
        id: authorization.site.id,
        platformId: authorization.site.platformId,
        organizationId: authorization.site.organizationId,
        workspaceId: authorization.site.workspaceId,
        profileId: authorization.site.profileId,
        status: authorization.site.status,
      },
    },
    profile: {
      id: authorization.profile.id,
      status: authorization.profile.status,
    },
    capabilities: capabilityIds,
    permissions: {
      subjectId: resolved.subjectId,
      allow: [...resolved.allowedPermissionIds],
      deny: [...resolved.deniedPermissionIds],
    },
  })
}
