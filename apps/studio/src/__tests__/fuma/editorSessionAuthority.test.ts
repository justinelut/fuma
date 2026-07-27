import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  EditorSessionAuthority,
  EditorSessionAuthorityError,
  EditorSessionAuthorityInputSchema,
  EditorSessionKeySchema,
  type EditorSessionAuthorityInput,
} from '../../../server/fuma/editor'
import {
  freezeFumaRequestContext,
  type FumaRequestContext,
} from '../../../server/fuma/context'
import type { FumaRepositoryScope } from '../../../server/fuma/tenancy'

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T

const ANCESTRY = Object.freeze({
  platformId: 'platform-fuma',
  organizationId: 'organization-acme',
  workspaceId: 'workspace-primary',
  siteId: 'site-main',
})

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    for (const nested of Object.values(value)) deepFreeze(nested, seen)
    Object.freeze(value)
  }
  return value
}

function context(
  sessionId = 'session-primary',
  changes: Readonly<{
    requestId?: string
    platformId?: string
    organizationId?: string
    workspaceId?: string
    siteId?: string
  }> = {},
): FumaRequestContext {
  const platformId = changes.platformId ?? ANCESTRY.platformId
  const organizationId = changes.organizationId ?? ANCESTRY.organizationId
  const workspaceId = changes.workspaceId ?? ANCESTRY.workspaceId
  const siteId = changes.siteId ?? ANCESTRY.siteId
  return freezeFumaRequestContext({
    requestId: changes.requestId ?? 'request-editor-session',
    source: {
      kind: 'staff-session',
      correlationId: 'correlation-editor-session',
      userId: 'staff-editor',
      sessionId,
      impersonatedBy: null,
    },
    actor: {
      kind: 'staff',
      userId: 'staff-editor',
      sessionId,
      impersonator: null,
    },
    scope: {
      platform: { id: platformId, status: 'active' },
      organization: { id: organizationId, platformId, status: 'active' },
      workspace: {
        id: workspaceId,
        platformId,
        organizationId,
        status: 'active',
      },
      site: {
        id: siteId,
        platformId,
        organizationId,
        workspaceId,
        profileId: 'website',
        status: 'active',
      },
    },
    profile: { id: 'website', status: 'active' },
    capabilities: ['content.pages'],
    permissions: {
      subjectId: 'staff-editor',
      allow: ['content.pages.read', 'content.pages.write'],
      deny: [],
    },
  })
}

function repositoryScope(
  changes: Partial<Mutable<FumaRepositoryScope>> = {},
): FumaRepositoryScope {
  return deepFreeze({
    ...ANCESTRY,
    ownerKey: 'owner-stable',
    generation: 7,
    state: 'active' as const,
    transferFence: null,
    ...changes,
  }) as FumaRepositoryScope
}

function input(
  requestContext = context(),
  scope = repositoryScope(),
): EditorSessionAuthorityInput {
  return deepFreeze({ context: requestContext, repositoryScope: scope })
}

function expectDenied(candidate: unknown): void {
  expect(() => new EditorSessionAuthority().resolveEditorSessionKey(
    candidate as EditorSessionAuthorityInput,
  )).toThrow(EditorSessionAuthorityError)
}

describe('FUMA-027 production editor session authority', () => {
  it('publishes strict TypeBox-compatible frozen input and opaque key contracts', () => {
    const authority = new EditorSessionAuthority()
    const authorityInput = input()
    const key = authority.resolveEditorSessionKey(authorityInput)

    expect(Value.Check(EditorSessionAuthorityInputSchema, authorityInput)).toBe(true)
    expect(Value.Check(EditorSessionKeySchema, key)).toBe(true)
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(authority)).toBe(true)
    expect(Object.isFrozen(authorityInput)).toBe(true)
    expect(Object.isFrozen(authorityInput.context.scope.site)).toBe(true)
    expect(Object.isFrozen(authorityInput.repositoryScope)).toBe(true)
    expect(Object.isFrozen(key)).toBe(true)

    for (const sensitiveValue of [
      authorityInput.context.actor.sessionId,
      authorityInput.repositoryScope.ownerKey,
      authorityInput.repositoryScope.platformId,
      authorityInput.repositoryScope.organizationId,
      authorityInput.repositoryScope.workspaceId,
      authorityInput.repositoryScope.siteId,
    ]) {
      expect(key).not.toContain(sensitiveValue)
    }
  })

  it('is deterministic for one authority and ignores request-local caller data', () => {
    const authority = new EditorSessionAuthority()
    const first = authority.resolveEditorSessionKey(input(context(
      'session-primary',
      { requestId: 'request-one' },
    )))
    const second = authority.resolveEditorSessionKey(input(context(
      'session-primary',
      { requestId: 'request-two' },
    )))

    expect(second).toBe(first)
    expect(authority.resolveEditorSessionKey(input())).toBe(first)
  })

  it('rotates after session, owner key, generation, or exact ancestry changes', () => {
    const authority = new EditorSessionAuthority()
    const baseline = authority.resolveEditorSessionKey(input())
    const changedSession = authority.resolveEditorSessionKey(input(context('session-next')))
    const changedOwner = authority.resolveEditorSessionKey(input(
      context(),
      repositoryScope({ ownerKey: 'owner-next' }),
    ))
    const changedGeneration = authority.resolveEditorSessionKey(input(
      context(),
      repositoryScope({ generation: 8 }),
    ))
    const nextContext = context('session-primary', {
      organizationId: 'organization-next',
      workspaceId: 'workspace-next',
      siteId: 'site-next',
    })
    const changedAncestry = authority.resolveEditorSessionKey(input(
      nextContext,
      repositoryScope({
        organizationId: 'organization-next',
        workspaceId: 'workspace-next',
        siteId: 'site-next',
      }),
    ))

    expect(new Set([
      baseline,
      changedSession,
      changedOwner,
      changedGeneration,
      changedAncestry,
    ])).toHaveLength(5)
  })

  it('fails closed on every context/repository mismatch and non-active owner state', () => {
    for (const mismatch of [
      { platformId: 'platform-other' },
      { organizationId: 'organization-other' },
      { workspaceId: 'workspace-other' },
      { siteId: 'site-other' },
    ]) {
      expectDenied(input(context(), repositoryScope(mismatch)))
    }

    expectDenied(input(context(), repositoryScope({
      state: 'transferring',
      transferFence: 11,
    })))
  })

  it('fails closed on mutable, additional, malformed, and non-staff authority', () => {
    const mutable = {
      context: structuredClone(context()),
      repositoryScope: structuredClone(repositoryScope()),
    }
    expect(Value.Check(EditorSessionAuthorityInputSchema, mutable)).toBe(true)
    expectDenied(mutable)

    expectDenied(deepFreeze({
      ...input(),
      callerSessionId: 'caller-controlled',
    }))

    expectDenied(deepFreeze({
      context: context(),
      repositoryScope: { ...repositoryScope(), generation: 0 },
    }))

    const jobContext = structuredClone(context()) as Mutable<FumaRequestContext>
    jobContext.source = {
      kind: 'internal-job',
      correlationId: 'correlation-job',
      jobId: 'editor-job',
      runId: 'run-one',
    }
    jobContext.actor = {
      kind: 'internal-job',
      jobId: 'editor-job',
      runId: 'run-one',
    }
    jobContext.permissions.subjectId = 'editor-job'
    expectDenied(input(freezeFumaRequestContext(jobContext)))
  })
})
