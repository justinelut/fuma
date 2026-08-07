/**
 * The hosted site-document bridge.
 *
 * The property that makes this safe to add to a shipping self-hosted product: with no resolver
 * registered, behaviour is byte-for-byte what it was. The tests below assert that in both
 * directions, and assert that registration cannot smuggle the legacy document back into a
 * hosted refusal.
 */

import { describe, it, expect, afterEach } from 'bun:test'
import {
  SELF_HOST_SITE_ID,
  isHostedSiteDocumentModeActive,
  resolveRequestSiteDocumentId,
  setHostedSiteDocumentResolver,
} from '../../../server/selfHost'

const req = (query = '') =>
  new Request(`https://app.example/admin/api/cms/site-document${query}`)

// Module-level state: every test must leave the process as it found it, or an unregistered test
// running afterwards would silently inherit hosted behaviour.
afterEach(() => { setHostedSiteDocumentResolver(null) })

describe('self-host behaviour is unchanged by the seam existing', () => {
  it('resolves the historical id when no resolver is registered', async () => {
    expect(await resolveRequestSiteDocumentId(req())).toBe(SELF_HOST_SITE_ID)
    expect(SELF_HOST_SITE_ID).toBe('default')
  })

  it('reports hosted mode as inactive', async () => {
    expect(isHostedSiteDocumentModeActive()).toBe(false)
  })

  it('ignores query parameters entirely', async () => {
    // A self-hosted install has one site; a scope in the URL must not redirect it elsewhere.
    expect(await resolveRequestSiteDocumentId(req('?siteId=somewhere-else')))
      .toBe(SELF_HOST_SITE_ID)
  })
})

describe('hosted registration takes over completely', () => {
  it('uses the registered resolver', async () => {
    setHostedSiteDocumentResolver(async () => 'site-abc')
    expect(await resolveRequestSiteDocumentId(req())).toBe('site-abc')
    expect(isHostedSiteDocumentModeActive()).toBe(true)
  })

  it('passes the request through so the resolver can read its scope', async () => {
    setHostedSiteDocumentResolver(async (request) =>
      new URL(request.url).searchParams.get('siteId'))
    expect(await resolveRequestSiteDocumentId(req('?siteId=site-xyz'))).toBe('site-xyz')
  })

  it('propagates a refusal as null rather than falling back', async () => {
    // The whole point: a hosted request that cannot be authorised must NOT receive the legacy
    // document, because that is another tenant's design.
    setHostedSiteDocumentResolver(async () => null)
    expect(await resolveRequestSiteDocumentId(req())).toBeNull()
  })

  it('never silently substitutes the legacy id for a refusal', async () => {
    setHostedSiteDocumentResolver(async () => null)
    const resolved = await resolveRequestSiteDocumentId(req())
    expect(resolved).not.toBe(SELF_HOST_SITE_ID)
  })

  it('separates two tenants', async () => {
    setHostedSiteDocumentResolver(async (request) =>
      new URL(request.url).searchParams.get('siteId'))
    const first = await resolveRequestSiteDocumentId(req('?siteId=tenant-1'))
    const second = await resolveRequestSiteDocumentId(req('?siteId=tenant-2'))
    expect(first).toBe('tenant-1')
    expect(second).toBe('tenant-2')
    expect(first).not.toBe(second)
  })
})

describe('unregistering restores self-host behaviour', () => {
  it('returns to the historical id', async () => {
    setHostedSiteDocumentResolver(async () => 'site-abc')
    expect(await resolveRequestSiteDocumentId(req())).toBe('site-abc')
    setHostedSiteDocumentResolver(null)
    expect(await resolveRequestSiteDocumentId(req())).toBe(SELF_HOST_SITE_ID)
    expect(isHostedSiteDocumentModeActive()).toBe(false)
  })
})
