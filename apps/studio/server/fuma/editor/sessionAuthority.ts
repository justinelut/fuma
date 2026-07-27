import {
  Type,
  Value,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  FumaRequestContextSchema,
  assertFumaRequestContext,
} from '../context'
import { FumaRepositoryScopeSchema } from '../tenancy'

const SHA256_HEX_PATTERN = '^[a-f0-9]{64}$'
const textEncoder = new TextEncoder()

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

export const EditorSessionAuthorityInputSchema = Type.Object({
  context: FumaRequestContextSchema,
  repositoryScope: FumaRepositoryScopeSchema,
}, { additionalProperties: false })
export type EditorSessionAuthorityInput = DeepReadonly<
  Static<typeof EditorSessionAuthorityInputSchema>
>

export const EditorSessionKeySchema = Type.String({
  minLength: 64,
  maxLength: 64,
  pattern: SHA256_HEX_PATTERN,
})
export type EditorSessionKey = Static<typeof EditorSessionKeySchema>

export interface EditorSessionAuthorityPort {
  resolveEditorSessionKey(
    input: EditorSessionAuthorityInput,
  ): EditorSessionKey | Promise<EditorSessionKey>
}

/** Uniform denial prevents malformed or cross-tenant snapshots becoming an oracle. */
export class EditorSessionAuthorityError extends Error {
  readonly code = 'denied' as const

  constructor() {
    super('Editor session authority denied.')
    this.name = 'EditorSessionAuthorityError'
  }
}

function deny(): never {
  throw new EditorSessionAuthorityError()
}

function isDeepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object') return true
  if (seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  return Object.values(value).every((nested) => isDeepFrozen(nested, seen))
}

function hasExactActiveAuthority(input: EditorSessionAuthorityInput): boolean {
  const { context, repositoryScope } = input
  return context.actor.kind === 'staff'
    && repositoryScope.state === 'active'
    && repositoryScope.transferFence === null
    && context.scope.platform.id === repositoryScope.platformId
    && context.scope.organization.id === repositoryScope.organizationId
    && context.scope.workspace.id === repositoryScope.workspaceId
    && context.scope.site.id === repositoryScope.siteId
    && context.scope.site.profileId === context.profile.id
}

function hashInput(input: EditorSessionAuthorityInput): string {
  const { context, repositoryScope } = input
  if (context.actor.kind !== 'staff') deny()
  return JSON.stringify([
    'fuma-editor-session',
    1,
    context.actor.sessionId,
    repositoryScope.platformId,
    repositoryScope.organizationId,
    repositoryScope.workspaceId,
    repositoryScope.siteId,
    repositoryScope.ownerKey,
    repositoryScope.generation,
    context.profile.id,
  ])
}

/**
 * Derives an opaque editor-session key exclusively from one immutable trusted
 * request snapshot and its server-owned active repository owner generation.
 */
export class EditorSessionAuthority implements EditorSessionAuthorityPort {
  constructor() {
    Object.freeze(this)
  }

  resolveEditorSessionKey(input: EditorSessionAuthorityInput): EditorSessionKey {
    try {
      if (
        !Value.Check(EditorSessionAuthorityInputSchema, input)
        || !isDeepFrozen(input)
      ) {
        deny()
      }

      assertFumaRequestContext(input.context)
      if (!hasExactActiveAuthority(input)) deny()

      const key = new Bun.CryptoHasher('sha256')
        .update(textEncoder.encode(hashInput(input)))
        .digest('hex')
      if (!Value.Check(EditorSessionKeySchema, key)) deny()
      return key
    } catch (_error) {
      deny()
    }
  }
}
