/**
 * The client half of tenant-scoped site documents.
 *
 * Self-hosted requests must be byte-for-byte what they always were, and hosted requests must
 * carry the scope the server resolves the document from. Both directions are asserted, because
 * getting either wrong is silent: an unscoped hosted request is refused (the builder appears
 * broken), and a scoped self-host request changes a URL that nothing was expecting to change.
 */

import { describe, it, expect, afterEach } from 'bun:test'
import {
  activeBuilderScopeQuery,
  builderScopeSearch,
  getActiveBuilderScope,
  setActiveBuilderScope,
} from '@core/fuma/builder/builderScope'
import { openBuilderSession } from '@core/fuma/builder/builderSessionClient'

// Module-level state: a scope left registered would leak into a later test and make a self-host
// assertion pass for the wrong reason.
afterEach(() => { setActiveBuilderScope(null) })

describe('self-host sends exactly what it always sent', () => {
  it('has no scope by default', () => {
    expect(getActiveBuilderScope()).toBeNull()
  })

  it('produces an empty query object', () => {
    // Empty rather than undefined so a caller can spread it unconditionally.
    expect(activeBuilderScopeQuery()).toEqual({})
  })

  it('produces an empty search string, not a bare question mark', () => {
    // A trailing `?` changes the URL a cache keys on.
    expect(builderScopeSearch()).toBe('')
  })
})

describe('hosted requests carry the scope', () => {
  const scope = Object.freeze({
    organizationId: 'org-1', workspaceId: 'ws-1', siteId: 'site-a',
  })

  it('records the scope', () => {
    setActiveBuilderScope(scope)
    expect(getActiveBuilderScope()).toEqual(scope)
  })

  it('exposes all three parts as a query object', () => {
    setActiveBuilderScope(scope)
    expect(activeBuilderScopeQuery()).toEqual({
      organizationId: 'org-1', workspaceId: 'ws-1', siteId: 'site-a',
    })
  })

  it('builds a search string the server can parse', () => {
    setActiveBuilderScope(scope)
    const search = builderScopeSearch()
    expect(search.startsWith('?')).toBe(true)
    // Parsed back through the same API the server uses, so the two cannot disagree about encoding.
    const parsed = new URLSearchParams(search)
    expect(parsed.get('organizationId')).toBe('org-1')
    expect(parsed.get('workspaceId')).toBe('ws-1')
    expect(parsed.get('siteId')).toBe('site-a')
  })

  it('encodes values that would otherwise break the URL', () => {
    // An id containing & or = would silently truncate the scope and the server would see a
    // different site than the builder is editing.
    setActiveBuilderScope(Object.freeze({
      organizationId: 'o&x', workspaceId: 'w=1', siteId: 'site a',
    }))
    const parsed = new URLSearchParams(builderScopeSearch())
    expect(parsed.get('organizationId')).toBe('o&x')
    expect(parsed.get('workspaceId')).toBe('w=1')
    expect(parsed.get('siteId')).toBe('site a')
  })

  it('switches cleanly between two sites', () => {
    setActiveBuilderScope(scope)
    expect(activeBuilderScopeQuery().siteId).toBe('site-a')
    setActiveBuilderScope(Object.freeze({ ...scope, siteId: 'site-b' }))
    expect(activeBuilderScopeQuery().siteId).toBe('site-b')
  })

  it('restores self-host behaviour when cleared', () => {
    setActiveBuilderScope(scope)
    setActiveBuilderScope(null)
    expect(activeBuilderScopeQuery()).toEqual({})
    expect(builderScopeSearch()).toBe('')
  })
})

describe('the session exchange records the scope', () => {
  const scope = Object.freeze({
    organizationId: 'org-1', workspaceId: 'ws-1', siteId: 'site-a',
  })

  // Shaped to satisfy CmsCurrentUserSchema exactly: apiRequest validates the envelope, so a
  // partial fixture would fail validation and the test would prove nothing about scope recording.
  const envelope = {
    user: {
      id: 'u1', email: 'a@b.c', displayName: 'A', status: 'active',
      role: {
        id: 'r1', slug: 'admin', name: 'Admin', description: 'Full access',
        isSystem: true, capabilities: [],
      },
      capabilities: [], lastLoginAt: null, failedLoginCount: 0, lockedUntil: null,
      passwordUpdatedAt: null, mfaEnabled: false, mfaEnabledAt: null,
      mfaRecoveryCodesRemaining: 0, stepUpAuthMode: 'disabled', stepUpWindowMinutes: 15,
      avatarMediaId: null, avatarUrl: null, gravatarHash: 'abc',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    },
    publicOrigin: null,
  }

  it('records it on success, so every later CMS request carries it', async () => {
    // This is the integration that makes the whole chain work: without it the builder's CMS
    // requests carry no scope and the server refuses them.
    const result = await openBuilderSession(scope, (async () => new Response(
      JSON.stringify(envelope),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as Parameters<typeof openBuilderSession>[1])
    expect(result.kind).toBe('ready')
    expect(getActiveBuilderScope()).toEqual(scope)
  })

  it('does NOT record it when the server refuses', async () => {
    // Recording a scope the server just refused would make later requests claim an
    // authorisation this exchange did not establish.
    const result = await openBuilderSession(scope, (async () => new Response(
      JSON.stringify({ error: 'Builder access requires edit permission' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )) as unknown as Parameters<typeof openBuilderSession>[1])
    expect(result.kind).not.toBe('ready')
    expect(getActiveBuilderScope()).toBeNull()
  })
})
