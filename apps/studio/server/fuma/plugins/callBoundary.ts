import {
  CapabilityIdSchema,
  type CapabilityId,
} from '@core/fuma'
import {
  isPluginPermission,
  type PluginPermission,
} from '@core/plugin-sdk'
import {
  Type,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  FumaContextIdSchema,
  type FumaSiteJobContext,
  type FumaTrustedContext,
} from '../context'
import {
  deriveFumaRepositoryScope,
  type FumaRepositoryScope,
  type FumaRepositoryScopeOwnerKeyAuthority,
} from '../tenancy'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

export const FumaPluginCallKindSchema = Type.Union([
  Type.Literal('persistence'),
  Type.Literal('rpc'),
])
export type FumaPluginCallKind = Static<typeof FumaPluginCallKindSchema>

const FumaPluginCallTargetSchema = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
})

const FumaPluginPermissionSchema = Type.Unsafe<PluginPermission>(
  Type.String({ minLength: 1, maxLength: 255 }),
)

export const FumaHostedPluginCallSchema = Type.Object({
  kind: FumaPluginCallKindSchema,
  target: FumaPluginCallTargetSchema,
  payload: Type.Unknown(),
}, { additionalProperties: false })
export type FumaHostedPluginCall = DeepReadonly<
  Static<typeof FumaHostedPluginCallSchema>
>

export const FumaHostedPluginCallRequirementSchema = Type.Object({
  kind: FumaPluginCallKindSchema,
  target: FumaPluginCallTargetSchema,
  requiredCapabilities: Type.Array(CapabilityIdSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
  requiredPluginPermissions: Type.Array(FumaPluginPermissionSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
}, { additionalProperties: false })
export type FumaHostedPluginCallRequirement = DeepReadonly<
  Static<typeof FumaHostedPluginCallRequirementSchema>
>

export type FumaHostedPluginCallAuthority = DeepReadonly<{
  pluginId: string
  repositoryScope: FumaRepositoryScope
  profileId: string
  grantedCapabilities: readonly CapabilityId[]
  grantedPermissions: readonly PluginPermission[]
}>

export type FumaHostedPluginDispatchCall = DeepReadonly<{
  authority: FumaHostedPluginCallAuthority
  kind: FumaPluginCallKind
  target: string
  payload: unknown
}>

/**
 * Hosted persistence and RPC adapters receive authority out-of-band from the
 * plugin payload. They must use repositoryScope rather than parsing tenant or
 * owner selectors from payload.
 */
export interface FumaHostedPluginCallDispatcher {
  dispatch(call: FumaHostedPluginDispatchCall): Promise<unknown>
}

export type BindFumaHostedPluginCallsInput = Readonly<{
  pluginId: string
  trustedContext: FumaTrustedContext
  ownerKeys: FumaRepositoryScopeOwnerKeyAuthority
  grantedPermissions: readonly PluginPermission[]
  requirements: readonly FumaHostedPluginCallRequirement[]
  persistence: FumaHostedPluginCallDispatcher
  rpc: FumaHostedPluginCallDispatcher
}>

export type FumaHostedPluginCallBoundaryErrorCode = 'invalid-call' | 'denied'

export class FumaHostedPluginCallBoundaryError extends Error {
  readonly code: FumaHostedPluginCallBoundaryErrorCode

  constructor(code: FumaHostedPluginCallBoundaryErrorCode, message: string) {
    super(message)
    this.name = 'FumaHostedPluginCallBoundaryError'
    this.code = code
  }
}

function normalizeAuthorityKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const CALLER_AUTHORITY_KEYS = Object.freeze(new Set([
  'capabilities',
  'generation',
  'grantedCapabilities',
  'grantedPermissions',
  'organizationId',
  'ownerKey',
  'permissions',
  'platformId',
  'pluginPermissions',
  'profileId',
  'repositoryScope',
  'requiredCapabilities',
  'requiredPluginPermissions',
  'scope',
  'siteId',
  'tenantId',
  'transferFence',
  'workspaceId',
].map(normalizeAuthorityKey)))

const MAX_PAYLOAD_SCAN_DEPTH = 32
const MAX_PAYLOAD_SCAN_VALUES = 10_000

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): DeepReadonly<T> {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    for (const nested of Object.values(value)) deepFreeze(nested, seen)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

function deny(): never {
  throw new FumaHostedPluginCallBoundaryError(
    'denied',
    'Hosted plugin call denied.',
  )
}

function invalidCall(): never {
  throw new FumaHostedPluginCallBoundaryError(
    'invalid-call',
    'Hosted plugin call is invalid.',
  )
}

function requirementKey(kind: FumaPluginCallKind, target: string): string {
  return `${kind}:${target}`
}

function readRequirements(
  values: readonly FumaHostedPluginCallRequirement[],
): ReadonlyMap<string, FumaHostedPluginCallRequirement> {
  const requirements = new Map<string, FumaHostedPluginCallRequirement>()
  for (const value of values) {
    const parsed = safeParseValue(FumaHostedPluginCallRequirementSchema, value)
    if (
      !parsed.ok
      || parsed.value.requiredPluginPermissions.some((permission) => (
        !isPluginPermission(permission)
      ))
    ) {
      invalidCall()
    }
    const requirement = deepFreeze(structuredClone(parsed.value))
    const key = requirementKey(requirement.kind, requirement.target)
    if (requirements.has(key)) invalidCall()
    requirements.set(key, requirement)
  }
  return requirements
}

function readGrantedPermissions(value: unknown): readonly PluginPermission[] {
  if (!Array.isArray(value)) invalidCall()
  const permissions: PluginPermission[] = []
  for (const permission of value) {
    if (!isPluginPermission(permission)) invalidCall()
    permissions.push(permission)
  }
  if (new Set(permissions).size !== permissions.length) invalidCall()
  return deepFreeze(permissions)
}

function siteContext(trustedContext: FumaTrustedContext) {
  if (trustedContext.kind === 'request') return trustedContext.context
  if (trustedContext.context.kind !== 'site') deny()
  return trustedContext.context as FumaSiteJobContext
}

function sameScope(
  left: FumaRepositoryScope,
  right: FumaRepositoryScope,
): boolean {
  return left.platformId === right.platformId
    && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId
    && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey
    && left.generation === right.generation
    && left.state === right.state
    && left.transferFence === right.transferFence
}

function assertPayloadHasNoCallerAuthorityClaims(payload: unknown): void {
  const pending: Array<Readonly<{ value: unknown, depth: number }>> = [{
    value: payload,
    depth: 0,
  }]
  const seen = new WeakSet<object>()
  let scannedValues = 0

  try {
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current) break
      scannedValues += 1
      if (
        scannedValues > MAX_PAYLOAD_SCAN_VALUES
        || current.depth > MAX_PAYLOAD_SCAN_DEPTH
      ) {
        deny()
      }
      if (!current.value || typeof current.value !== 'object') continue
      if (seen.has(current.value)) continue
      seen.add(current.value)

      for (const key of Object.keys(current.value)) {
        if (CALLER_AUTHORITY_KEYS.has(normalizeAuthorityKey(key))) deny()
        pending.push({
          value: (current.value as Record<string, unknown>)[key],
          depth: current.depth + 1,
        })
      }
    }
  } catch (_error) {
    deny()
  }
}

function clonePayload(payload: unknown): unknown {
  try {
    return deepFreeze(structuredClone(payload))
  } catch (_error) {
    invalidCall()
  }
}

export interface FumaHostedPluginCallBoundary {
  readonly authority: FumaHostedPluginCallAuthority
  call(input: unknown): Promise<unknown>
}

class BoundFumaHostedPluginCalls implements FumaHostedPluginCallBoundary {
  readonly authority: FumaHostedPluginCallAuthority
  readonly #trustedContext: FumaTrustedContext
  readonly #ownerKeys: FumaRepositoryScopeOwnerKeyAuthority
  readonly #requirements: ReadonlyMap<string, FumaHostedPluginCallRequirement>
  readonly #grantedCapabilities: ReadonlySet<CapabilityId>
  readonly #grantedPermissions: ReadonlySet<PluginPermission>
  readonly #persistence: FumaHostedPluginCallDispatcher
  readonly #rpc: FumaHostedPluginCallDispatcher

  constructor(input: {
    authority: FumaHostedPluginCallAuthority
    trustedContext: FumaTrustedContext
    ownerKeys: FumaRepositoryScopeOwnerKeyAuthority
    requirements: ReadonlyMap<string, FumaHostedPluginCallRequirement>
    persistence: FumaHostedPluginCallDispatcher
    rpc: FumaHostedPluginCallDispatcher
  }) {
    this.authority = input.authority
    this.#trustedContext = input.trustedContext
    this.#ownerKeys = input.ownerKeys
    this.#requirements = input.requirements
    this.#grantedCapabilities = new Set(input.authority.grantedCapabilities)
    this.#grantedPermissions = new Set(input.authority.grantedPermissions)
    this.#persistence = input.persistence
    this.#rpc = input.rpc
    Object.freeze(this)
  }

  async call(input: unknown): Promise<unknown> {
    const parsed = safeParseValue(FumaHostedPluginCallSchema, input)
    if (!parsed.ok) invalidCall()
    assertPayloadHasNoCallerAuthorityClaims(parsed.value.payload)

    const requirement = this.#requirements.get(requirementKey(
      parsed.value.kind,
      parsed.value.target,
    ))
    if (
      !requirement
      || requirement.requiredCapabilities.some((capability) => (
        !this.#grantedCapabilities.has(capability)
      ))
      || requirement.requiredPluginPermissions.some((permission) => (
        !this.#grantedPermissions.has(permission)
      ))
    ) {
      deny()
    }

    let currentScope: FumaRepositoryScope
    try {
      currentScope = await deriveFumaRepositoryScope({
        trustedContext: this.#trustedContext,
        ownerKeys: this.#ownerKeys,
      })
    } catch (_error) {
      deny()
    }
    if (
      currentScope.state !== 'active'
      || !sameScope(currentScope, this.authority.repositoryScope)
    ) {
      deny()
    }

    const dispatchCall = deepFreeze({
      authority: this.authority,
      kind: parsed.value.kind,
      target: parsed.value.target,
      payload: clonePayload(parsed.value.payload),
    })
    const dispatcher = parsed.value.kind === 'persistence'
      ? this.#persistence
      : this.#rpc
    return await dispatcher.dispatch(dispatchCall)
  }
}

/**
 * Binds one hosted plugin identity to the exact immutable repository,
 * capability, and operator-approved plugin-permission snapshot derived from
 * server-owned authority. No caller tenant, owner, profile, capability, or
 * plugin grant selector is accepted.
 */
export async function bindFumaHostedPluginCalls(
  input: BindFumaHostedPluginCallsInput,
): Promise<FumaHostedPluginCallBoundary> {
  if (!safeParseValue(FumaContextIdSchema, input.pluginId).ok) invalidCall()
  const requirements = readRequirements(input.requirements)
  const grantedPermissions = readGrantedPermissions(input.grantedPermissions)
  let repositoryScope: FumaRepositoryScope
  try {
    repositoryScope = await deriveFumaRepositoryScope({
      trustedContext: input.trustedContext,
      ownerKeys: input.ownerKeys,
    })
  } catch (_error) {
    deny()
  }
  if (repositoryScope.state !== 'active') deny()

  const context = siteContext(input.trustedContext)
  const authority = deepFreeze({
    pluginId: input.pluginId,
    repositoryScope,
    profileId: context.profile.id,
    grantedCapabilities: structuredClone(context.capabilities),
    grantedPermissions,
  })

  return new BoundFumaHostedPluginCalls({
    authority,
    trustedContext: input.trustedContext,
    ownerKeys: input.ownerKeys,
    requirements,
    persistence: input.persistence,
    rpc: input.rpc,
  })
}

export interface LegacySelfHostPluginCallBoundary<TCall, TResult> {
  call(input: TCall): Promise<TResult>
}

/**
 * Legacy self-host composition remains an exact pass-through: it neither
 * invents Fuma authority nor changes the call object or dispatcher result.
 */
export function createLegacySelfHostPluginCallBoundary<TCall, TResult>(
  dispatch: (input: TCall) => Promise<TResult>,
): LegacySelfHostPluginCallBoundary<TCall, TResult> {
  return Object.freeze({
    call(input: TCall): Promise<TResult> {
      return dispatch(input)
    },
  })
}
