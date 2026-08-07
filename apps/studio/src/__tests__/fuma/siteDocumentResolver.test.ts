/**
 * The authorising side of site-document resolution.
 *
 * The property that matters most: a caller who edits `?siteId=` in the URL must not receive
 * another tenant's document. Without an authorisation step, fixing the shared-document bug by
 * trusting the query string would turn one bug into a cross-tenant breach.
 */

import { describe, it, expect } from 'bun:test'
import {
  createSiteDocumentResolver,
  refusalResponse,
  type SiteScopeAuthorizer,
} from '../../../server/fuma/editor/siteDocumentResolver'

const req = (query = '') =>
  new Request(`https://app.example/admin/api/cms/site-document${query}`)

const fullScope = '?organizationId=org-1&workspaceId=ws-1&siteId=site-a'

/** Authorises everything it is asked about. */
const permissive: SiteScopeAuthorizer = {
  authorizeScope: async (_request, scope) => scope,
}

/** Authorises only the one site the caller genuinely owns. */
function ownerOf(ownedSiteId: string): SiteScopeAuthorizer {
  return {
    authorizeScope: async (_request, scope) =>
      scope.siteId === ownedSiteId ? scope : null,
  }
}

/** Fails the test if consulted. */
const neverCalled: SiteScopeAuthorizer = {
  authorizeScope: async () => {
    throw new Error('The authorizer must not be consulted in self-host mode.')
  },
}

describe('self-host does not consult a hosted authority', () => {
  it('resolves the legacy document without authorising anything', async () => {
    // A self-hosted install has no hosted authorisation tables, so calling the authority would
    // make it depend on something it does not have.
    const resolver = createSiteDocumentResolver({ mode: 'self-host', authorizer: neverCalled })
    const result = await resolver.resolve(req())
    expect(result).toEqual({ ok: true, documentId: 'default' })
  })

  it('ignores any scope in the URL', async () => {
    const resolver = createSiteDocumentResolver({ mode: 'self-host', authorizer: neverCalled })
    const result = await resolver.resolve(req(fullScope))
    expect(result.ok && result.documentId).toBe('default')
  })
})

describe('hosted resolution is gated on authorisation', () => {
  it('resolves the site the caller is authorised for', async () => {
    const resolver = createSiteDocumentResolver({ mode: 'hosted', authorizer: permissive })
    const result = await resolver.resolve(req(fullScope))
    expect(result).toEqual({ ok: true, documentId: 'site-a' })
  })

  it('REFUSES a site the caller does not own', async () => {
    // The attack the design exists to stop: editing the query string to reach another tenant.
    const resolver = createSiteDocumentResolver({
      mode: 'hosted', authorizer: ownerOf('site-mine'),
    })
    const result = await resolver.resolve(
      req('?organizationId=org-1&workspaceId=ws-1&siteId=site-theirs'),
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('unauthorized-scope')
  })

  it('does not fall back to the shared document when denied', async () => {
    // A fallback here would hand an unauthorised caller the legacy document.
    const resolver = createSiteDocumentResolver({
      mode: 'hosted', authorizer: ownerOf('site-mine'),
    })
    const result = await resolver.resolve(
      req('?organizationId=org-1&workspaceId=ws-1&siteId=site-theirs'),
    )
    expect(result.ok).toBe(false)
  })

  it('separates two tenants completely', async () => {
    const resolver = createSiteDocumentResolver({ mode: 'hosted', authorizer: permissive })
    const first = await resolver.resolve(
      req('?organizationId=o&workspaceId=w&siteId=site-1'),
    )
    const second = await resolver.resolve(
      req('?organizationId=o&workspaceId=w&siteId=site-2'),
    )
    expect(first.ok && first.documentId).toBe('site-1')
    expect(second.ok && second.documentId).toBe('site-2')
  })

  it('reports a missing scope as missing, not denied', async () => {
    const resolver = createSiteDocumentResolver({ mode: 'hosted', authorizer: permissive })
    const result = await resolver.resolve(req())
    expect(result.ok === false && result.reason).toBe('missing-scope')
  })

  it('refuses a hosted site id that collides with the legacy document', async () => {
    const resolver = createSiteDocumentResolver({ mode: 'hosted', authorizer: permissive })
    const result = await resolver.resolve(
      req('?organizationId=o&workspaceId=w&siteId=default'),
    )
    expect(result.ok === false && result.reason).toBe('reserved-site-id')
  })
})

describe('refusals become consistent responses', () => {
  it('returns null for a successful resolution so a handler can continue', async () => {
    const resolver = createSiteDocumentResolver({ mode: 'hosted', authorizer: permissive })
    expect(refusalResponse(await resolver.resolve(req(fullScope)))).toBeNull()
  })

  it('answers 403 for a denial and 400 for a missing scope', async () => {
    const denied = createSiteDocumentResolver({
      mode: 'hosted', authorizer: ownerOf('mine'),
    })
    const deniedResponse = refusalResponse(
      await denied.resolve(req('?organizationId=o&workspaceId=w&siteId=theirs')),
    )
    expect(deniedResponse?.status).toBe(403)

    const missing = createSiteDocumentResolver({ mode: 'hosted', authorizer: permissive })
    expect(refusalResponse(await missing.resolve(req()))?.status).toBe(400)
  })

  it('does not echo the requested site id back to an unauthorised caller', async () => {
    // Echoing it confirms the site exists, which is a disclosure in itself.
    const resolver = createSiteDocumentResolver({ mode: 'hosted', authorizer: ownerOf('mine') })
    const response = refusalResponse(
      await resolver.resolve(req('?organizationId=o&workspaceId=w&siteId=secret-client-site')),
    )
    expect(await response?.text()).not.toContain('secret-client-site')
  })

  it('marks refusals uncacheable', async () => {
    // A cached 403 keyed only by path would deny the next legitimate caller.
    const resolver = createSiteDocumentResolver({ mode: 'hosted', authorizer: permissive })
    const response = refusalResponse(await resolver.resolve(req()))
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })
})
