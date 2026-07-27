import {
  CapabilityIdSchema,
  CustomRoleDefinitionSchema,
  FUMA_BASE_PERMISSION_CATALOG,
  OrganizationResourceScopeSchema,
  PermissionIdSchema,
  PermissionSubjectIdSchema,
  ProtectedOwnerInvariantSchema,
  ScopedPermissionOverrideSchema,
  ScopedRoleAssignmentSchema,
  fumaLaunchRegistry,
  type FumaRegistry,
  type SiteResourceScope,
} from '@core/fuma'
import {
  Type,
  Value,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  FumaJobRecordSchema,
  type FumaJobRecord,
} from '../jobs/contracts'
import {
  resolveLayeredPermissions,
  resolvePermission,
  type LayeredRoleResolverInput,
} from '../permissions'
import {
  FumaActiveProfileSchema,
  FumaContextIdSchema,
  FumaExactContextScopeSchema,
  FumaInternalJobActorSchema,
  FumaInternalJobSourceCorrelationSchema,
  FumaOrganizationContextScopeSchema,
  FumaPermissionDecisionSummarySchema,
  FumaPlatformContextScopeSchema,
  freezeFumaRequestContext,
  type FumaRequestContext,
} from './contracts'
import {
  FumaSiteAuthorizationInputSchema,
  type FumaSiteAuthorizationInput,
} from './requestContext'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

const OrganizationAuthorityStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('suspended'),
  Type.Literal('archived'),
])

const OriginatingRequestIdSchema = Type.Union([
  FumaContextIdSchema,
  Type.Null(),
])

export const FumaSiteJobAuthoritySchema = Type.Object({
  kind: Type.Literal('site'),
  originatingRequestId: OriginatingRequestIdSchema,
  authorization: FumaSiteAuthorizationInputSchema,
}, { additionalProperties: false })
export type FumaSiteJobAuthority = Static<typeof FumaSiteJobAuthoritySchema>

export const FumaOrganizationJobAuthoritySchema = Type.Object({
  kind: Type.Literal('organization'),
  originatingRequestId: OriginatingRequestIdSchema,
  platformOrganizationId: FumaContextIdSchema,
  job: Type.Object({
    kind: FumaContextIdSchema,
    permission: PermissionIdSchema,
  }, { additionalProperties: false }),
  platform: Type.Object({
    id: FumaContextIdSchema,
    status: Type.Union([Type.Literal('active'), Type.Literal('suspended')]),
  }, { additionalProperties: false }),
  organization: Type.Object({
    id: FumaContextIdSchema,
    platformId: FumaContextIdSchema,
    kind: Type.Union([Type.Literal('platform'), Type.Literal('customer')]),
    status: OrganizationAuthorityStatusSchema,
  }, { additionalProperties: false }),
  permissions: Type.Object({
    subjectId: PermissionSubjectIdSchema,
    scope: OrganizationResourceScopeSchema,
    protectedOwnerInvariant: Type.Union([ProtectedOwnerInvariantSchema, Type.Null()]),
    roleAssignments: Type.Array(ScopedRoleAssignmentSchema),
    permissionOverrides: Type.Array(ScopedPermissionOverrideSchema),
    customRoles: Type.Array(CustomRoleDefinitionSchema),
  }, { additionalProperties: false }),
}, { additionalProperties: false })
export type FumaOrganizationJobAuthority = Static<
  typeof FumaOrganizationJobAuthoritySchema
>

export const FumaTrustedJobAuthoritySchema = Type.Union([
  FumaSiteJobAuthoritySchema,
  FumaOrganizationJobAuthoritySchema,
])
export type FumaTrustedJobAuthority = Static<typeof FumaTrustedJobAuthoritySchema>

const FumaSiteJobContextSchema = Type.Object({
  kind: Type.Literal('site'),
  originatingRequestId: OriginatingRequestIdSchema,
  requestId: FumaContextIdSchema,
  source: FumaInternalJobSourceCorrelationSchema,
  actor: FumaInternalJobActorSchema,
  scope: FumaExactContextScopeSchema,
  profile: FumaActiveProfileSchema,
  capabilities: Type.Array(CapabilityIdSchema, {
    uniqueItems: true,
  }),
  permissions: FumaPermissionDecisionSummarySchema,
  requiredPermission: PermissionIdSchema,
}, { additionalProperties: false })
export type FumaSiteJobContext = DeepReadonly<Static<typeof FumaSiteJobContextSchema>>

const FumaOrganizationJobContextSchema = Type.Object({
  kind: Type.Literal('organization'),
  originatingRequestId: OriginatingRequestIdSchema,
  requestId: FumaContextIdSchema,
  source: FumaInternalJobSourceCorrelationSchema,
  actor: FumaInternalJobActorSchema,
  scope: Type.Object({
    platform: FumaPlatformContextScopeSchema,
    organization: FumaOrganizationContextScopeSchema,
  }, { additionalProperties: false }),
  permissions: FumaPermissionDecisionSummarySchema,
  requiredPermission: PermissionIdSchema,
}, { additionalProperties: false })
export type FumaOrganizationJobContext = DeepReadonly<
  Static<typeof FumaOrganizationJobContextSchema>
>

/** Site and organization jobs are deliberately different authority shapes. */
export const FumaJobContextSchema = Type.Union([
  FumaSiteJobContextSchema,
  FumaOrganizationJobContextSchema,
])
export type FumaJobContext = DeepReadonly<Static<typeof FumaJobContextSchema>>

/** A wrapper keeps request and job authority snapshots explicitly discriminated. */
export type FumaTrustedContext =
  | Readonly<{ kind: 'request'; context: FumaRequestContext }>
  | Readonly<{ kind: 'job'; context: FumaJobContext }>

export type FumaJobAuthorityLookupInput = Readonly<{
  jobId: string
  organizationId: string
  siteId: string | null
  jobKind: string
}>

/** Loads server-owned authority using only persisted job selectors, never payload claims. */
export interface FumaJobContextAuthority {
  loadTrustedJobAuthority(input: FumaJobAuthorityLookupInput): Promise<unknown | null>
}

export type DeriveFumaJobContextInput = Readonly<{
  jobRecord: unknown
  authority: FumaJobContextAuthority
  registry?: FumaRegistry
  now?: () => Date
}>

export class FumaJobContextResolutionError extends Error {
  readonly code = 'denied' as const

  constructor() {
    super('Internal job authority denied.')
    this.name = 'FumaJobContextResolutionError'
  }
}

function deny(): never {
  throw new FumaJobContextResolutionError()
}

function trustedNow(now: () => Date): number {
  let current: Date
  try {
    current = now()
  } catch (_error) {
    deny()
  }
  if (!(current instanceof Date) || !Number.isFinite(current.getTime())) deny()
  return current.getTime()
}

function readRunningJob(value: unknown, now: () => Date): FumaJobRecord {
  const parsed = safeParseValue(FumaJobRecordSchema, value)
  if (!parsed.ok) deny()
  const job = parsed.value
  const claimExpiresAt = job.claimExpiresAt === null
    ? Number.NaN
    : Date.parse(job.claimExpiresAt)
  let fence: bigint
  try {
    fence = BigInt(job.fence)
  } catch (_error) {
    deny()
  }
  if (
    !Value.Check(FumaContextIdSchema, job.id)
    || !Value.Check(FumaContextIdSchema, job.organizationId)
    || !Value.Check(FumaContextIdSchema, job.kind)
    || (job.siteId !== null && !Value.Check(FumaContextIdSchema, job.siteId))
    || job.status !== 'running'
    || job.claimedBy === null
    || job.claimedBy.trim().length === 0
    || !Number.isFinite(claimExpiresAt)
    || claimExpiresAt <= trustedNow(now)
    || job.attemptCount < 1
    || job.attemptCount > job.maxAttempts
    || fence <= 0n
    || job.fence !== fence.toString()
    || job.completedAt !== null
  ) {
    deny()
  }
  return structuredClone(job)
}

function readAuthority(value: unknown): FumaTrustedJobAuthority {
  const parsed = safeParseValue(FumaTrustedJobAuthoritySchema, value)
  if (!parsed.ok) deny()
  return structuredClone(parsed.value)
}

function executionIds(job: FumaJobRecord): Readonly<{
  requestId: string
  runId: string
}> {
  const requestId = `${job.id}:request:${job.fence}`
  const runId = `${job.id}:run:${job.fence}`
  if (
    !Value.Check(FumaContextIdSchema, requestId)
    || !Value.Check(FumaContextIdSchema, runId)
  ) {
    deny()
  }
  return { requestId, runId }
}

function hasExactBinding(
  binding: Readonly<{
    platformId: string
    organizationId: string
    workspaceId: string
    siteId: string
  }>,
  scope: SiteResourceScope,
): boolean {
  return binding.platformId === scope.platformId
    && binding.organizationId === scope.organizationId
    && binding.workspaceId === scope.workspaceId
    && binding.siteId === scope.siteId
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

function assertExactSiteAuthority(
  job: FumaJobRecord,
  authorization: FumaSiteAuthorizationInput,
): void {
  if (job.siteId === null) deny()
  const scope = exactSiteScope(authorization)
  if (
    authorization.organization.id !== job.organizationId
    || authorization.site.id !== job.siteId
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
    || authorization.permissions.subjectId !== job.id
    || authorization.permissions.scope.kind !== 'site'
    || authorization.permissions.scope.platformId !== scope.platformId
    || authorization.permissions.scope.organizationId !== scope.organizationId
    || authorization.permissions.scope.workspaceId !== scope.workspaceId
    || authorization.permissions.scope.siteId !== scope.siteId
    || authorization.platform.status !== 'active'
    || authorization.organization.status !== 'active'
    || authorization.workspace.status !== 'active'
    || authorization.site.status !== 'active'
    || authorization.profile.status !== 'active'
  ) {
    deny()
  }
}

function layeredPermissionInput(
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function freezeJobContext(value: unknown): FumaJobContext {
  if (!Value.Check(FumaJobContextSchema, value)) deny()
  return deepFreeze(structuredClone(value)) as FumaJobContext
}

function deriveSiteContext(
  job: FumaJobRecord,
  authority: FumaSiteJobAuthority,
  registry: FumaRegistry,
): FumaSiteJobContext {
  const authorization = structuredClone(authority.authorization)
  assertExactSiteAuthority(job, authorization)

  let composed: ReturnType<FumaRegistry['compose']>
  let resolved: ReturnType<typeof resolveLayeredPermissions>
  try {
    composed = registry.compose(
      authorization.profile.id,
      authorization.capabilities.overrides,
    )
    resolved = resolveLayeredPermissions(layeredPermissionInput(authorization), registry)
  } catch (_error) {
    deny()
  }

  const matchingJobs = composed.jobs.filter(({ id, handlerId }) => (
    id === job.kind || handlerId === job.kind
  ))
  if (matchingJobs.length !== 1) deny()
  const requiredPermission = matchingJobs[0]!.permission
  const capabilityIds = composed.capabilities.map(({ id }) => id)
  if (
    resolved.profileId !== authorization.profile.id
    || resolved.subjectId !== job.id
    || resolved.activeCapabilityIds.length !== capabilityIds.length
    || resolved.activeCapabilityIds.some((id, index) => id !== capabilityIds[index])
    || !resolved.allowedPermissionIds.includes(requiredPermission)
  ) {
    deny()
  }

  const { requestId, runId } = executionIds(job)
  const base = freezeFumaRequestContext({
    requestId,
    source: {
      kind: 'internal-job',
      correlationId: requestId,
      jobId: job.id,
      runId,
    },
    actor: {
      kind: 'internal-job',
      jobId: job.id,
      runId,
    },
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

  return freezeJobContext({
    kind: 'site',
    originatingRequestId: authority.originatingRequestId,
    ...base,
    requiredPermission,
  }) as FumaSiteJobContext
}

function assertExactOrganizationAuthority(
  job: FumaJobRecord,
  authority: FumaOrganizationJobAuthority,
): void {
  const isPlatformOrganization = authority.organization.id === authority.platformOrganizationId
  if (
    job.siteId !== null
    || authority.job.kind !== job.kind
    || authority.organization.id !== job.organizationId
    || authority.organization.platformId !== authority.platform.id
    || authority.permissions.subjectId !== job.id
    || authority.permissions.scope.platformId !== authority.platform.id
    || authority.permissions.scope.organizationId !== authority.organization.id
    || (authority.organization.kind === 'platform') !== isPlatformOrganization
    || authority.platform.status !== 'active'
    || authority.organization.status !== 'active'
  ) {
    deny()
  }
}

function deriveOrganizationContext(
  job: FumaJobRecord,
  authority: FumaOrganizationJobAuthority,
): FumaOrganizationJobContext {
  assertExactOrganizationAuthority(job, authority)
  const catalogEntry = FUMA_BASE_PERMISSION_CATALOG.permissions.find(({ id }) => (
    id === authority.job.permission
  ))
  if (!catalogEntry || catalogEntry.scopeKind !== 'organization') deny()

  let decisions: ReturnType<typeof resolvePermission>[]
  try {
    decisions = FUMA_BASE_PERMISSION_CATALOG.permissions
      .filter(({ scopeKind }) => scopeKind === 'organization')
      .map(({ id }) => resolvePermission({
        subjectId: authority.permissions.subjectId,
        permissionId: id,
        scope: authority.permissions.scope,
        capabilityPermission: {
          kind: 'available',
          capabilityId: 'core',
        },
        protectedOwnerInvariant: authority.permissions.protectedOwnerInvariant,
        roleAssignments: authority.permissions.roleAssignments,
        permissionOverrides: authority.permissions.permissionOverrides,
        customRoles: authority.permissions.customRoles,
      }, FUMA_BASE_PERMISSION_CATALOG))
  } catch (_error) {
    deny()
  }

  const allow = decisions
    .filter(({ decision }) => decision === 'allow')
    .map(({ permissionId }) => permissionId)
  const denied = decisions
    .filter(({ decision }) => decision === 'deny')
    .map(({ permissionId }) => permissionId)
  if (!allow.includes(authority.job.permission)) deny()

  const { requestId, runId } = executionIds(job)
  return freezeJobContext({
    kind: 'organization',
    originatingRequestId: authority.originatingRequestId,
    requestId,
    source: {
      kind: 'internal-job',
      correlationId: requestId,
      jobId: job.id,
      runId,
    },
    actor: {
      kind: 'internal-job',
      jobId: job.id,
      runId,
    },
    scope: {
      platform: {
        id: authority.platform.id,
        status: authority.platform.status,
      },
      organization: {
        id: authority.organization.id,
        platformId: authority.organization.platformId,
        status: authority.organization.status,
      },
    },
    permissions: {
      subjectId: job.id,
      allow,
      deny: denied,
    },
    requiredPermission: authority.job.permission,
  }) as FumaOrganizationJobContext
}

/**
 * Derives an immutable internal-job snapshot from durable PostgreSQL authority.
 * The lookup receives no payload, headers, or caller-provided tenant claims.
 */
export async function deriveFumaJobContext(
  input: DeriveFumaJobContextInput,
): Promise<FumaJobContext> {
  const job = readRunningJob(input.jobRecord, input.now ?? (() => new Date()))
  let rawAuthority: unknown | null
  try {
    rawAuthority = await input.authority.loadTrustedJobAuthority({
      jobId: job.id,
      organizationId: job.organizationId,
      siteId: job.siteId,
      jobKind: job.kind,
    })
  } catch (_error) {
    deny()
  }
  if (rawAuthority === null) deny()
  const authority = readAuthority(rawAuthority)

  if (job.siteId === null) {
    if (authority.kind !== 'organization') deny()
    return deriveOrganizationContext(job, authority)
  }
  if (authority.kind !== 'site') deny()
  return deriveSiteContext(job, authority, input.registry ?? fumaLaunchRegistry)
}
