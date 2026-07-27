import {
  Type,
  Value,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  FumaJobContextSchema,
  type FumaTrustedContext,
} from '../context/jobContext'
import { assertFumaRequestContext } from '../context/contracts'
import {
  TenantKeyIdSchema,
  TenantOwnershipCoordinateSchema,
  validateTenantOwnerKeyRecord,
} from './contracts'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

const repositoryScopeBase = {
  platformId: TenantKeyIdSchema,
  organizationId: TenantKeyIdSchema,
  workspaceId: TenantKeyIdSchema,
  siteId: TenantKeyIdSchema,
  ownerKey: TenantKeyIdSchema,
  generation: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
}

/**
 * The complete predicate set every site-owned repository operation carries.
 * IDs that look globally unique are deliberately insufficient on their own.
 */
export const FumaRepositoryScopeSchema = Type.Union([
  Type.Object({
    ...repositoryScopeBase,
    state: Type.Literal('active'),
    transferFence: Type.Null(),
  }, { additionalProperties: false }),
  Type.Object({
    ...repositoryScopeBase,
    state: Type.Literal('transferring'),
    transferFence: Type.Integer({ minimum: 1, maximum: MAX_SAFE_INTEGER }),
  }, { additionalProperties: false }),
])
export type FumaRepositoryScope = DeepReadonly<Static<typeof FumaRepositoryScopeSchema>>

export type FumaRepositoryScopeCoordinate = DeepReadonly<
  Static<typeof TenantOwnershipCoordinateSchema>
>

/**
 * Resolves the stable owner key from server-owned persistence. Implementations
 * must query by every coordinate supplied here, never by site ID alone.
 */
export interface FumaRepositoryScopeOwnerKeyAuthority {
  loadOwnerKey(
    coordinate: FumaRepositoryScopeCoordinate,
  ): Promise<unknown | null>
}

export type DeriveFumaRepositoryScopeInput = Readonly<{
  trustedContext: FumaTrustedContext
  ownerKeys: FumaRepositoryScopeOwnerKeyAuthority
}>

/** A uniform denial avoids turning owner-key resolution into a tenant oracle. */
export class FumaRepositoryScopeResolutionError extends Error {
  readonly code = 'denied' as const

  constructor() {
    super('Repository scope authority denied.')
    this.name = 'FumaRepositoryScopeResolutionError'
  }
}

function deny(): never {
  throw new FumaRepositoryScopeResolutionError()
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

function isDeepFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false
  return Object.values(value).every((nested) => (
    !nested || typeof nested !== 'object' || isDeepFrozen(nested)
  ))
}

function coordinateFromTrustedContext(
  trusted: FumaTrustedContext,
): FumaRepositoryScopeCoordinate {
  const context = trusted.context
  if (!isDeepFrozen(context)) deny()

  if (trusted.kind === 'request') {
    try {
      assertFumaRequestContext(context)
    } catch (_error) {
      deny()
    }
  } else if (!Value.Check(FumaJobContextSchema, context) || context.kind !== 'site') {
    deny()
  }

  const { platform, organization, workspace, site } = context.scope
  if (
    organization.platformId !== platform.id
    || workspace.platformId !== platform.id
    || workspace.organizationId !== organization.id
    || site.platformId !== platform.id
    || site.organizationId !== organization.id
    || site.workspaceId !== workspace.id
  ) {
    deny()
  }

  return deepFreeze({
    platformId: platform.id,
    organizationId: organization.id,
    workspaceId: workspace.id,
    siteId: site.id,
  })
}

function hasExactCoordinate(
  actual: FumaRepositoryScopeCoordinate,
  expected: FumaRepositoryScopeCoordinate,
): boolean {
  return actual.platformId === expected.platformId
    && actual.organizationId === expected.organizationId
    && actual.workspaceId === expected.workspaceId
    && actual.siteId === expected.siteId
}

/**
 * Derives repository predicates exclusively from an immutable request or site
 * job authority snapshot, then binds them to the current stable owner record.
 * No route, body, header, job-payload, or standalone ID input is accepted.
 */
export async function deriveFumaRepositoryScope(
  input: DeriveFumaRepositoryScopeInput,
): Promise<FumaRepositoryScope> {
  const coordinate = coordinateFromTrustedContext(input.trustedContext)
  let rawOwnerKey: unknown | null
  try {
    rawOwnerKey = await input.ownerKeys.loadOwnerKey(coordinate)
  } catch (_error) {
    deny()
  }
  if (rawOwnerKey === null) deny()

  let ownerKey: ReturnType<typeof validateTenantOwnerKeyRecord>
  try {
    ownerKey = validateTenantOwnerKeyRecord(rawOwnerKey)
  } catch (_error) {
    deny()
  }
  if (!hasExactCoordinate(ownerKey.coordinate, coordinate)) deny()

  const scope = {
    ...coordinate,
    ownerKey: ownerKey.ownerKey,
    state: ownerKey.state,
    generation: ownerKey.generation,
    transferFence: ownerKey.transferFence,
  }
  if (!Value.Check(FumaRepositoryScopeSchema, scope)) deny()
  return deepFreeze(scope)
}
