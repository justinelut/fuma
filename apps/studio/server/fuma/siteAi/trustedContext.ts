import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  assertFumaRequestContext,
  type FumaRequestContext,
} from '../context'
import {
  EditorSiteSessionIdentitySchema,
  type EditorSiteSessionIdentity,
} from '../editor/contracts'
import {
  parseSiteAiContract,
  SiteAiAuthoritySnapshotSchema,
  type SiteAiAuthoritySnapshot,
  type SiteAiProfile,
} from './contracts'
import { SiteAiAuthorityError } from './service'

function deeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return true
  seen.add(value)
  return Object.isFrozen(value)
    && Object.values(value).every((nested) => deeplyFrozen(nested, seen))
}

function profile(value: string): SiteAiProfile {
  if (value === 'website' || value === 'publication') return value
  throw new SiteAiAuthorityError('denied', 'Site profile does not support native site AI.')
}

/**
 * The request context is server-derived and deeply frozen; the editor identity
 * is loaded from current owner authority. Repeated coordinates are compared so
 * neither request bodies nor browser snapshots can substitute tenant IDs.
 */
export function createSiteAiAuthoritySnapshot(input: Readonly<{
  context: FumaRequestContext
  editor: EditorSiteSessionIdentity
  revision: number
  observedAt: string
}>): SiteAiAuthoritySnapshot {
  assertFumaRequestContext(input.context)
  if (!deeplyFrozen(input.context)) {
    throw new SiteAiAuthorityError('denied', 'Site AI requires an immutable request context.')
  }
  const parsedEditor = safeParseValue(EditorSiteSessionIdentitySchema, input.editor)
  if (!parsedEditor.ok || input.context.actor.kind !== 'staff') {
    throw new SiteAiAuthorityError('denied', 'Active staff editor authority is required.')
  }
  const editor = parsedEditor.value
  const { scope, actor, profile: activeProfile } = input.context
  const exact = scope.platform.id === editor.platformId
    && scope.organization.id === editor.organizationId
    && scope.workspace.id === editor.workspaceId
    && scope.site.id === editor.siteId
    && scope.site.profileId === editor.profileId
    && activeProfile.id === editor.profileId
    && actor.sessionId.length > 0
  if (!exact) throw new SiteAiAuthorityError('denied', 'Request and editor ancestry do not match.')

  return parseSiteAiContract(SiteAiAuthoritySnapshotSchema, {
    scope: {
      platformId: editor.platformId,
      organizationId: editor.organizationId,
      workspaceId: editor.workspaceId,
      siteId: editor.siteId,
      ownerKey: editor.ownerKey,
      ownerGeneration: editor.generation,
      profileId: profile(editor.profileId),
    },
    actor: {
      actorId: actor.userId,
      sessionId: actor.sessionId,
      editorSessionId: editor.editorSessionId,
    },
    capabilities: [...input.context.capabilities],
    state: 'active',
    revision: input.revision,
    observedAt: input.observedAt,
  }, 'siteAi.trustedContext') as SiteAiAuthoritySnapshot
}
