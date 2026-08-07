/**
 * Render-cache keying across tenants.
 *
 * The failure this closes is silent and public: two hosted sites both serving `/about` shared one
 * cache entry, so whichever rendered first could be served to visitors of the other. Both
 * responses are valid HTML for that path, so nothing errors and nothing looks wrong — the wrong
 * company's page is simply on screen.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { getOrRender, resetForTests } from '../../../server/publish/renderCache'

const response = (body: string) => Object.freeze({
  body, headers: Object.freeze({ 'content-type': 'text/html' }), status: 200 as const,
})

beforeEach(() => { resetForTests() })

describe('two tenants do not share a cache entry', () => {
  it('serves each site its own body for the same path', async () => {
    const a = await getOrRender(
      { urlPath: '/about', queryString: '', siteScope: 'site-a' },
      async () => response('A about'),
    )
    const b = await getOrRender(
      { urlPath: '/about', queryString: '', siteScope: 'site-b' },
      async () => response('B about'),
    )
    expect(a?.body).toBe('A about')
    // Under the old unscoped key this returned 'A about' — another tenant's page.
    expect(b?.body).toBe('B about')
  })

  it('still caches within one site', async () => {
    let renders = 0
    const key = { urlPath: '/about', queryString: '', siteScope: 'site-a' }
    await getOrRender(key, async () => { renders += 1; return response('once') })
    const second = await getOrRender(key, async () => { renders += 1; return response('twice') })
    expect(renders).toBe(1)
    expect(second?.body).toBe('once')
  })

  it('does not let a crafted site id collide with another key', async () => {
    // The scope is separated by the same NUL used between the other parts, so a value cannot be
    // shaped to impersonate a different site's key.
    const crafted = await getOrRender(
      { urlPath: '/x', queryString: '', siteScope: 'site-a\u0000/about' },
      async () => response('crafted'),
    )
    const real = await getOrRender(
      { urlPath: '/about', queryString: '', siteScope: 'site-a' },
      async () => response('real about'),
    )
    expect(crafted?.body).toBe('crafted')
    expect(real?.body).toBe('real about')
  })

  it('keeps the query string part of the identity', async () => {
    const first = await getOrRender(
      { urlPath: '/list', queryString: 'page=1', siteScope: 's' },
      async () => response('page one'),
    )
    const second = await getOrRender(
      { urlPath: '/list', queryString: 'page=2', siteScope: 's' },
      async () => response('page two'),
    )
    expect(first?.body).toBe('page one')
    expect(second?.body).toBe('page two')
  })
})

describe('self-host behaviour is unchanged', () => {
  it('caches with no scope supplied', async () => {
    let renders = 0
    const key = { urlPath: '/about', queryString: '' }
    await getOrRender(key, async () => { renders += 1; return response('self host') })
    const again = await getOrRender(key, async () => { renders += 1; return response('other') })
    expect(renders).toBe(1)
    expect(again?.body).toBe('self host')
  })

  it('treats an unscoped entry as separate from a scoped one', async () => {
    // A self-hosted install and a scoped caller are different callers; sharing an entry between
    // them would be the same collision in a different disguise.
    const unscoped = await getOrRender(
      { urlPath: '/about', queryString: '' },
      async () => response('unscoped'),
    )
    const scoped = await getOrRender(
      { urlPath: '/about', queryString: '', siteScope: 'site-a' },
      async () => response('scoped'),
    )
    expect(unscoped?.body).toBe('unscoped')
    expect(scoped?.body).toBe('scoped')
  })
})
