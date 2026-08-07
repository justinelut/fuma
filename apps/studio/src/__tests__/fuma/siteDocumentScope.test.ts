/**
 * Resolving which site document a request addresses.
 *
 * The bug this closes: the CMS handlers answered with the constant `'default'`, so in a hosted
 * deployment every site shared one document and editing one overwrote another. The tests below
 * assert the ABSENCE of the dangerous answers as carefully as the presence of the right ones,
 * because every dangerous answer here is silent — a wrong document is still a valid document,
 * and the write succeeds.
 */

import { describe, it, expect } from 'bun:test'
import {
  LEGACY_SELF_HOST_DOCUMENT_ID,
  readUntrustedScope,
  resolveSiteDocumentId,
  selfHostDocumentId,
  statusForRefusal,
  type AuthorizedSiteScope,
} from '../../../server/fuma/editor/siteDocumentScope'

const scope = (siteId: string): AuthorizedSiteScope => Object.freeze({
  organizationId: 'org-1', workspaceId: 'ws-1', siteId,
})

describe('self-host keeps its historical document', () => {
  it('resolves the legacy id', () => {
    // Existing installs persist their one site under this id. Changing it would orphan every
    // existing self-hosted site's design.
    const result = resolveSiteDocumentId({
      mode: 'self-host', authorizedScope: null, scopeWasSupplied: false,
    })
    expect(result).toEqual({ ok: true, documentId: 'default' })
  })

  it('resolves the legacy id even with no scope at all', () => {
    // A self-hosted install has no tenant scope to supply, so absence is normal rather than an
    // error.
    expect(selfHostDocumentId()).toBe(LEGACY_SELF_HOST_DOCUMENT_ID)
  })
})

describe('hosted never reaches the shared document', () => {
  it('gives each site its own document', () => {
    const first = resolveSiteDocumentId({
      mode: 'hosted', authorizedScope: scope('site-a'), scopeWasSupplied: true,
    })
    const second = resolveSiteDocumentId({
      mode: 'hosted', authorizedScope: scope('site-b'), scopeWasSupplied: true,
    })
    expect(first).toEqual({ ok: true, documentId: 'site-a' })
    expect(second).toEqual({ ok: true, documentId: 'site-b' })
    // The whole point: two sites must not collide.
    expect(first).not.toEqual(second)
  })

  it('never returns the legacy id for a hosted request', () => {
    // If it could, a hosted request that merely forgot its scope would land on the shared
    // document — the original bug, reappearing only in the requests hardest to notice.
    for (const supplied of [true, false]) {
      const result = resolveSiteDocumentId({
        mode: 'hosted', authorizedScope: null, scopeWasSupplied: supplied,
      })
      expect(result.ok).toBe(false)
    }
    const authorized = resolveSiteDocumentId({
      mode: 'hosted', authorizedScope: scope('site-a'), scopeWasSupplied: true,
    })
    expect(authorized.ok && authorized.documentId).not.toBe(LEGACY_SELF_HOST_DOCUMENT_ID)
  })

  it('refuses a hosted site whose id collides with the legacy document', () => {
    // Cheap check, severe consequence: such a site would read and write the shared row.
    const result = resolveSiteDocumentId({
      mode: 'hosted', authorizedScope: scope('default'), scopeWasSupplied: true,
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('reserved-site-id')
  })

  it('refuses a missing scope rather than assuming one', () => {
    const result = resolveSiteDocumentId({
      mode: 'hosted', authorizedScope: null, scopeWasSupplied: false,
    })
    expect(result.ok === false && result.reason).toBe('missing-scope')
    expect(result.ok === false && result.message).toContain('no default site')
  })

  it('refuses an unauthorized scope rather than serving the default', () => {
    // Falling back here would return another tenant's design to somebody with no right to it.
    const result = resolveSiteDocumentId({
      mode: 'hosted', authorizedScope: null, scopeWasSupplied: true,
    })
    expect(result.ok === false && result.reason).toBe('unauthorized-scope')
  })

  it('distinguishes not-asked from not-allowed', () => {
    // They need different responses: a 400 naming the parameters versus a 403 permission
    // decision. Collapsing them tells a caller to fix parameters that were fine.
    const missing = resolveSiteDocumentId({
      mode: 'hosted', authorizedScope: null, scopeWasSupplied: false,
    })
    const denied = resolveSiteDocumentId({
      mode: 'hosted', authorizedScope: null, scopeWasSupplied: true,
    })
    expect(missing.ok === false && missing.reason).not
      .toBe(denied.ok === false ? denied.reason : 'x')
    expect(statusForRefusal('missing-scope')).toBe(400)
    expect(statusForRefusal('unauthorized-scope')).toBe(403)
    expect(statusForRefusal('reserved-site-id')).toBe(400)
  })
})

describe('the document key is stable against things that should not move it', () => {
  it('does not change when the site moves workspace', () => {
    // Folding organisation and workspace into the key would mean moving a site between
    // workspaces orphaned its design.
    const before = resolveSiteDocumentId({
      mode: 'hosted',
      authorizedScope: Object.freeze({ organizationId: 'org-1', workspaceId: 'ws-1', siteId: 's' }),
      scopeWasSupplied: true,
    })
    const after = resolveSiteDocumentId({
      mode: 'hosted',
      authorizedScope: Object.freeze({ organizationId: 'org-2', workspaceId: 'ws-9', siteId: 's' }),
      scopeWasSupplied: true,
    })
    expect(before).toEqual(after)
  })
})

describe('reading the untrusted scope from a request', () => {
  const req = (query: string) => new Request(`https://app.example/admin/api/cms/site${query}`)

  it('reads a complete scope', () => {
    expect(readUntrustedScope(req('?organizationId=o&workspaceId=w&siteId=s')))
      .toEqual({ organizationId: 'o', workspaceId: 'w', siteId: 's' })
  })

  it('returns null when any part is missing', () => {
    expect(readUntrustedScope(req('?organizationId=o&workspaceId=w'))).toBeNull()
    expect(readUntrustedScope(req('?siteId=s'))).toBeNull()
    expect(readUntrustedScope(req(''))).toBeNull()
  })

  it('treats a blank parameter as absent', () => {
    // A present-but-blank parameter is what a client sends when it meant to send a scope and had
    // nothing. Treating it as a value would build a document key out of whitespace.
    expect(readUntrustedScope(req('?organizationId=o&workspaceId=w&siteId=%20%20'))).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(readUntrustedScope(req('?organizationId=%20o%20&workspaceId=w&siteId=s'))?.organizationId)
      .toBe('o')
  })

  it('does not authorise anything by parsing', () => {
    // The parsed triple is untrusted by construction: this is the value an attacker controls, so
    // handing it straight to resolveSiteDocumentId as `authorizedScope` is the mistake the two
    // separate parameters exist to make visible in review.
    const parsed = readUntrustedScope(req('?organizationId=o&workspaceId=w&siteId=victim-site'))
    expect(parsed).not.toBeNull()
    // Parsing alone must not be sufficient: the caller still has to check it.
    expect(typeof parsed?.siteId).toBe('string')
  })
})
