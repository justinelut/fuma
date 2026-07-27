import {
  Type,
  Value,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'
import {
  CapabilityIdSchema,
  PermissionIdSchema,
} from '@core/fuma'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

const CONTEXT_ID_OPTIONS = {
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
} as const
const REGISTRY_ID_OPTIONS = {
  minLength: 1,
  maxLength: 255,
  pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
} as const

export const FumaContextIdSchema = Type.String(CONTEXT_ID_OPTIONS)
export type FumaContextId = Contract<Static<typeof FumaContextIdSchema>>

export const FumaImpersonatorSchema = Type.Object({
  userId: FumaContextIdSchema,
}, { additionalProperties: false })
export type FumaImpersonator = Contract<Static<typeof FumaImpersonatorSchema>>

export const FumaStaffActorSchema = Type.Object({
  kind: Type.Literal('staff'),
  userId: FumaContextIdSchema,
  sessionId: FumaContextIdSchema,
  impersonator: Type.Union([FumaImpersonatorSchema, Type.Null()]),
}, { additionalProperties: false })
export type FumaStaffActor = Contract<Static<typeof FumaStaffActorSchema>>

export const FumaInternalJobActorSchema = Type.Object({
  kind: Type.Literal('internal-job'),
  jobId: FumaContextIdSchema,
  runId: FumaContextIdSchema,
}, { additionalProperties: false })
export type FumaInternalJobActor = Contract<Static<typeof FumaInternalJobActorSchema>>

export const FumaTrustedActorSchema = Type.Union([
  FumaStaffActorSchema,
  FumaInternalJobActorSchema,
])
export type FumaTrustedActor = Contract<Static<typeof FumaTrustedActorSchema>>

export const FumaPlatformContextStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('suspended'),
])
export type FumaPlatformContextStatus = Contract<
  Static<typeof FumaPlatformContextStatusSchema>
>

export const FumaOrganizationContextStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('suspended'),
])
export type FumaOrganizationContextStatus = Contract<
  Static<typeof FumaOrganizationContextStatusSchema>
>

export const FumaWorkspaceContextStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('archived'),
])
export type FumaWorkspaceContextStatus = Contract<
  Static<typeof FumaWorkspaceContextStatusSchema>
>

export const FumaSiteContextStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('archived'),
])
export type FumaSiteContextStatus = Contract<Static<typeof FumaSiteContextStatusSchema>>

export const FumaPlatformContextScopeSchema = Type.Object({
  id: FumaContextIdSchema,
  status: FumaPlatformContextStatusSchema,
}, { additionalProperties: false })
export type FumaPlatformContextScope = Contract<
  Static<typeof FumaPlatformContextScopeSchema>
>

export const FumaOrganizationContextScopeSchema = Type.Object({
  id: FumaContextIdSchema,
  platformId: FumaContextIdSchema,
  status: FumaOrganizationContextStatusSchema,
}, { additionalProperties: false })
export type FumaOrganizationContextScope = Contract<
  Static<typeof FumaOrganizationContextScopeSchema>
>

export const FumaWorkspaceContextScopeSchema = Type.Object({
  id: FumaContextIdSchema,
  platformId: FumaContextIdSchema,
  organizationId: FumaContextIdSchema,
  status: FumaWorkspaceContextStatusSchema,
}, { additionalProperties: false })
export type FumaWorkspaceContextScope = Contract<
  Static<typeof FumaWorkspaceContextScopeSchema>
>

export const FumaSiteContextScopeSchema = Type.Object({
  id: FumaContextIdSchema,
  platformId: FumaContextIdSchema,
  organizationId: FumaContextIdSchema,
  workspaceId: FumaContextIdSchema,
  profileId: Type.String(REGISTRY_ID_OPTIONS),
  status: FumaSiteContextStatusSchema,
}, { additionalProperties: false })
export type FumaSiteContextScope = Contract<Static<typeof FumaSiteContextScopeSchema>>

export const FumaExactContextScopeSchema = Type.Object({
  platform: FumaPlatformContextScopeSchema,
  organization: FumaOrganizationContextScopeSchema,
  workspace: FumaWorkspaceContextScopeSchema,
  site: FumaSiteContextScopeSchema,
}, { additionalProperties: false })
export type FumaExactContextScope = Contract<Static<typeof FumaExactContextScopeSchema>>

export const FumaProfileStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('inactive'),
])
export type FumaProfileStatus = Contract<Static<typeof FumaProfileStatusSchema>>

export const FumaActiveProfileSchema = Type.Object({
  id: Type.String(REGISTRY_ID_OPTIONS),
  status: FumaProfileStatusSchema,
}, { additionalProperties: false })
export type FumaActiveProfile = Contract<Static<typeof FumaActiveProfileSchema>>

export const FumaPermissionDecisionSummarySchema = Type.Object({
  subjectId: FumaContextIdSchema,
  allow: Type.Array(PermissionIdSchema, { uniqueItems: true }),
  deny: Type.Array(PermissionIdSchema, { uniqueItems: true }),
}, { additionalProperties: false })
export type FumaPermissionDecisionSummary = Contract<
  Static<typeof FumaPermissionDecisionSummarySchema>
>

export const FumaStaffSourceCorrelationSchema = Type.Object({
  kind: Type.Literal('staff-session'),
  correlationId: FumaContextIdSchema,
  userId: FumaContextIdSchema,
  sessionId: FumaContextIdSchema,
  impersonatedBy: Type.Union([FumaContextIdSchema, Type.Null()]),
}, { additionalProperties: false })
export type FumaStaffSourceCorrelation = Contract<
  Static<typeof FumaStaffSourceCorrelationSchema>
>

export const FumaInternalJobSourceCorrelationSchema = Type.Object({
  kind: Type.Literal('internal-job'),
  correlationId: FumaContextIdSchema,
  jobId: FumaContextIdSchema,
  runId: FumaContextIdSchema,
}, { additionalProperties: false })
export type FumaInternalJobSourceCorrelation = Contract<
  Static<typeof FumaInternalJobSourceCorrelationSchema>
>

export const FumaRequestSourceCorrelationSchema = Type.Union([
  FumaStaffSourceCorrelationSchema,
  FumaInternalJobSourceCorrelationSchema,
])
export type FumaRequestSourceCorrelation = Contract<
  Static<typeof FumaRequestSourceCorrelationSchema>
>

/**
 * Route parameters remain untrusted input. This contract deliberately has no
 * actor, profile, capability, or permission fields; those claims are composed
 * only from authenticated server-side authorities.
 */
export const UntrustedFumaRouteScopeSchema = Type.Object({
  organizationId: FumaContextIdSchema,
  workspaceId: FumaContextIdSchema,
  siteId: FumaContextIdSchema,
}, { additionalProperties: false })
export type UntrustedFumaRouteScope = Contract<Static<typeof UntrustedFumaRouteScopeSchema>>

export const FumaRequestContextSchema = Type.Object({
  requestId: FumaContextIdSchema,
  source: FumaRequestSourceCorrelationSchema,
  actor: FumaTrustedActorSchema,
  scope: FumaExactContextScopeSchema,
  profile: FumaActiveProfileSchema,
  capabilities: Type.Array(CapabilityIdSchema, {
    uniqueItems: true,
  }),
  permissions: FumaPermissionDecisionSummarySchema,
}, { additionalProperties: false })
export type FumaRequestContext = Contract<Static<typeof FumaRequestContextSchema>>

export const FumaContextContractErrorCodeSchema = Type.Union([
  Type.Literal('invalid-contract'),
  Type.Literal('ancestry-mismatch'),
  Type.Literal('duplicate-capability'),
  Type.Literal('duplicate-permission'),
  Type.Literal('permission-overlap'),
  Type.Literal('actor-source-mismatch'),
  Type.Literal('invalid-impersonation'),
  Type.Literal('inactive-context'),
  Type.Literal('profile-mismatch'),
])
export type FumaContextContractErrorCode = Contract<
  Static<typeof FumaContextContractErrorCodeSchema>
>

export class FumaContextContractError extends Error {
  readonly code: FumaContextContractErrorCode
  readonly path: string

  constructor(code: FumaContextContractErrorCode, message: string, path: string) {
    super(message)
    this.name = 'FumaContextContractError'
    this.code = code
    this.path = path
  }
}

function assertSchema<T extends TSchema>(
  schema: T,
  value: unknown,
  path: string,
): asserts value is Static<T> {
  if (Value.Check(schema, value)) return
  const error = Value.Errors(schema, value).First()
  throw new FumaContextContractError(
    'invalid-contract',
    `${path} does not match its TypeBox contract${error ? `: ${error.path || '/'} ${error.message}` : ''}.`,
    path,
  )
}

function assertUnique(
  values: readonly string[],
  path: string,
  code: 'duplicate-capability' | 'duplicate-permission',
): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      throw new FumaContextContractError(
        code,
        `${path} contains duplicate value "${value}".`,
        path,
      )
    }
    seen.add(value)
  }
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNoDuplicateClaims(value: unknown): void {
  if (!isRecord(value)) return
  const capabilities = stringArray(value.capabilities)
  if (capabilities) {
    assertUnique(capabilities, 'context.capabilities', 'duplicate-capability')
  }

  if (!isRecord(value.permissions)) return
  const allowed = stringArray(value.permissions.allow)
  const denied = stringArray(value.permissions.deny)
  if (allowed) assertUnique(allowed, 'context.permissions.allow', 'duplicate-permission')
  if (denied) assertUnique(denied, 'context.permissions.deny', 'duplicate-permission')
}

function assertExactAncestry(scope: FumaExactContextScope): void {
  const { platform, organization, workspace, site } = scope
  if (organization.platformId !== platform.id) {
    throw new FumaContextContractError(
      'ancestry-mismatch',
      'Organization does not belong to the context platform.',
      'context.scope.organization.platformId',
    )
  }
  if (
    workspace.platformId !== platform.id
    || workspace.organizationId !== organization.id
  ) {
    throw new FumaContextContractError(
      'ancestry-mismatch',
      'Workspace does not belong to the context platform and organization.',
      'context.scope.workspace',
    )
  }
  if (
    site.platformId !== platform.id
    || site.organizationId !== organization.id
    || site.workspaceId !== workspace.id
  ) {
    throw new FumaContextContractError(
      'ancestry-mismatch',
      'Site does not belong to the context platform, organization, and workspace.',
      'context.scope.site',
    )
  }
}

function actorSubjectId(actor: FumaTrustedActor): string {
  return actor.kind === 'staff' ? actor.userId : actor.jobId
}

function assertActorSourceCorrelation(context: FumaRequestContext): void {
  const { actor, source } = context
  if (actor.kind === 'staff') {
    const impersonatedBy = actor.impersonator?.userId ?? null
    if (
      source.kind !== 'staff-session'
      || source.userId !== actor.userId
      || source.sessionId !== actor.sessionId
      || source.impersonatedBy !== impersonatedBy
    ) {
      throw new FumaContextContractError(
        'actor-source-mismatch',
        'Staff actor does not match its trusted session source.',
        'context.source',
      )
    }
    if (actor.impersonator?.userId === actor.userId) {
      throw new FumaContextContractError(
        'invalid-impersonation',
        'An impersonator must be distinct from the effective staff actor.',
        'context.actor.impersonator.userId',
      )
    }
  } else if (
    source.kind !== 'internal-job'
    || source.jobId !== actor.jobId
    || source.runId !== actor.runId
  ) {
    throw new FumaContextContractError(
      'actor-source-mismatch',
      'Internal-job actor does not match its trusted job source.',
      'context.source',
    )
  }

  if (context.permissions.subjectId !== actorSubjectId(actor)) {
    throw new FumaContextContractError(
      'actor-source-mismatch',
      'Permission decisions do not belong to the effective actor.',
      'context.permissions.subjectId',
    )
  }
}

function assertActiveContext(context: FumaRequestContext): void {
  const statuses = [
    ['context.scope.platform.status', context.scope.platform.status],
    ['context.scope.organization.status', context.scope.organization.status],
    ['context.scope.workspace.status', context.scope.workspace.status],
    ['context.scope.site.status', context.scope.site.status],
    ['context.profile.status', context.profile.status],
  ] as const
  const inactive = statuses.find(([, status]) => status !== 'active')
  if (inactive) {
    throw new FumaContextContractError(
      'inactive-context',
      `An authoritative request context cannot claim inactive status "${inactive[1]}".`,
      inactive[0],
    )
  }
}

export function assertUntrustedFumaRouteScope(
  value: unknown,
): asserts value is UntrustedFumaRouteScope {
  assertSchema(UntrustedFumaRouteScopeSchema, value, 'routeScope')
}

export function assertFumaRequestContext(
  value: unknown,
): asserts value is FumaRequestContext {
  assertNoDuplicateClaims(value)
  assertSchema(FumaRequestContextSchema, value, 'context')
  assertExactAncestry(value.scope)

  const denied = new Set(value.permissions.deny)
  const overlap = value.permissions.allow.find((permissionId) => denied.has(permissionId))
  if (overlap) {
    throw new FumaContextContractError(
      'permission-overlap',
      `Permission "${overlap}" cannot be both allowed and denied.`,
      'context.permissions',
    )
  }

  if (value.profile.id !== value.scope.site.profileId) {
    throw new FumaContextContractError(
      'profile-mismatch',
      'Active profile does not match the exact site profile assignment.',
      'context.profile.id',
    )
  }

  assertActorSourceCorrelation(value)
  assertActiveContext(value)
}

/** Returns a validated detached copy. Use freezeFumaRequestContext for authority snapshots. */
export function cloneFumaRequestContext(value: unknown): FumaRequestContext {
  assertFumaRequestContext(value)
  return structuredClone(value)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/**
 * Produces the final deeply immutable authority snapshot. The caller's graph
 * is validated but never frozen or reused.
 */
export function freezeFumaRequestContext(value: unknown): FumaRequestContext {
  return deepFreeze(cloneFumaRequestContext(value))
}
