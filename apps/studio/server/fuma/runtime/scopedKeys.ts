import { CapabilityIdSchema } from '@core/fuma'
import {
  Type,
  Value,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  FumaActiveProfileSchema,
  FumaJobContextSchema,
  FumaRequestContextSchema,
  assertFumaRequestContext,
} from '../context'
import { FumaRepositoryScopeSchema } from '../tenancy'

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER
const SAFE_RESOURCE_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/
const textEncoder = new TextEncoder()

const FumaTrustedKeyContextSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('request'),
    context: FumaRequestContextSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('job'),
    context: FumaJobContextSchema,
  }, { additionalProperties: false }),
])

export const FumaScopedKeyVersionSchema = Type.Integer({
  minimum: 1,
  maximum: MAX_SAFE_INTEGER,
})
export type FumaScopedKeyVersion = Static<typeof FumaScopedKeyVersionSchema>

export const FumaScopedKeyFactoryInputSchema = Type.Object({
  trustedContext: FumaTrustedKeyContextSchema,
  repositoryScope: FumaRepositoryScopeSchema,
  capabilityId: CapabilityIdSchema,
  version: FumaScopedKeyVersionSchema,
}, { additionalProperties: false })
export type FumaScopedKeyFactoryInput = Static<typeof FumaScopedKeyFactoryInputSchema>

export const FumaScopedKeyAuthoritySchema = Type.Object({
  platformId: FumaRepositoryScopeSchema.anyOf[0].properties.platformId,
  organizationId: FumaRepositoryScopeSchema.anyOf[0].properties.organizationId,
  workspaceId: FumaRepositoryScopeSchema.anyOf[0].properties.workspaceId,
  siteId: FumaRepositoryScopeSchema.anyOf[0].properties.siteId,
  ownerKey: FumaRepositoryScopeSchema.anyOf[0].properties.ownerKey,
  generation: FumaRepositoryScopeSchema.anyOf[0].properties.generation,
  profileId: FumaActiveProfileSchema.properties.id,
  capabilityId: CapabilityIdSchema,
  version: FumaScopedKeyVersionSchema,
}, { additionalProperties: false })
export type FumaScopedKeyAuthority = Readonly<Static<typeof FumaScopedKeyAuthoritySchema>>

export interface FumaScopedKeyFactory {
  readonly authority: FumaScopedKeyAuthority
  cache(resource: string): string
  pubsub(resource: string): string
  lock(resource: string): string
}

/** Uniform denial keeps malformed and cross-tenant authority from becoming an oracle. */
export class FumaScopedKeyResolutionError extends Error {
  readonly code = 'denied' as const

  constructor() {
    super('Scoped key authority denied.')
    this.name = 'FumaScopedKeyResolutionError'
  }
}

function deny(): never {
  throw new FumaScopedKeyResolutionError()
}

function isDeepFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false
  return Object.values(value).every((nested) => (
    !nested || typeof nested !== 'object' || isDeepFrozen(nested)
  ))
}

function assertCanonicalResource(resource: string): void {
  if (
    typeof resource !== 'string'
    || resource.length === 0
    || textEncoder.encode(resource).byteLength > 255
    || resource.startsWith('/')
    || resource.endsWith('/')
    || resource.includes('\\')
    || resource.includes('%')
    || [...resource].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
  ) {
    deny()
  }
  const segments = resource.split('/')
  if (segments.some((segment) => (
    segment === '.' || segment === '..' || !SAFE_RESOURCE_SEGMENT.test(segment)
  ))) {
    deny()
  }
}

function authorityFingerprint(authority: FumaScopedKeyAuthority): string {
  const canonical = JSON.stringify([
    authority.platformId,
    authority.organizationId,
    authority.workspaceId,
    authority.siteId,
    authority.ownerKey,
    authority.generation,
    authority.profileId,
    authority.capabilityId,
    authority.version,
  ])
  return new Bun.CryptoHasher('sha256')
    .update(textEncoder.encode(canonical))
    .digest('hex')
}

function exactAuthority(input: FumaScopedKeyFactoryInput): FumaScopedKeyAuthority {
  if (
    !Value.Check(FumaScopedKeyFactoryInputSchema, input)
    || !isDeepFrozen(input.trustedContext.context)
    || !isDeepFrozen(input.repositoryScope)
  ) {
    deny()
  }

  const context = input.trustedContext.context
  if (input.trustedContext.kind === 'request') {
    try {
      assertFumaRequestContext(context)
    } catch (_error) {
      deny()
    }
  } else if (!Value.Check(FumaJobContextSchema, context) || context.kind !== 'site') {
    deny()
  }

  if (
    context.profile.status !== 'active'
    || context.profile.id !== context.scope.site.profileId
    || !context.capabilities.includes(input.capabilityId)
  ) {
    deny()
  }

  const scope = input.repositoryScope
  if (
    scope.state !== 'active'
    || scope.transferFence !== null
    || context.scope.platform.id !== scope.platformId
    || context.scope.organization.id !== scope.organizationId
    || context.scope.workspace.id !== scope.workspaceId
    || context.scope.site.id !== scope.siteId
  ) {
    deny()
  }

  const authority = {
    platformId: scope.platformId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    ownerKey: scope.ownerKey,
    generation: scope.generation,
    profileId: context.profile.id,
    capabilityId: input.capabilityId,
    version: input.version,
  }
  if (!Value.Check(FumaScopedKeyAuthoritySchema, authority)) deny()
  return Object.freeze(authority)
}

/**
 * Binds coordination keys to one immutable request/site-job authority and one
 * server-derived owner-key generation. Callers cannot substitute tenant IDs.
 */
export function createFumaScopedKeyFactory(
  input: FumaScopedKeyFactoryInput,
): FumaScopedKeyFactory {
  const authority = exactAuthority(input)
  const fingerprint = authorityFingerprint(authority)
  const prefix = `fuma-scope:v1:${fingerprint}:g${authority.generation}:v${authority.version}`

  function key(kind: 'cache' | 'pubsub' | 'lock', resource: string): string {
    assertCanonicalResource(resource)
    return `${prefix}:${kind}:${Buffer.from(resource).toString('base64url')}`
  }

  return Object.freeze({
    authority,
    cache: (resource: string) => key('cache', resource),
    pubsub: (resource: string) => key('pubsub', resource),
    lock: (resource: string) => key('lock', resource),
  })
}
