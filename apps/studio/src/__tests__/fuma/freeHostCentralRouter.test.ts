import { describe, expect, it } from 'bun:test'
import { handleServerRequest } from '../../../server/router'
import type { FreeHostPublicBoundary } from '../../../server/fuma/freeHosts'

function request(host: string, path: string, method = 'GET'): Request {
  return {
    method,
    url: `http://internal${path}`,
    headers: { get: (name: string) => name.toLowerCase() === 'host' ? host : null },
  } as unknown as Request
}

describe('FUMA-050 central server Host composition', () => {
  it('dispatches hosted public authority before every legacy self-host route', async () => {
    const seen: string[] = []
    const freeHostPublic: FreeHostPublicBoundary = {
      async route(input) {
        seen.push(input.headers.get('host') ?? '')
        return new Response('host-owned', { status: 209 })
      },
    }
    const response = await handleServerRequest(request('tenant-a.trimly.co.ke', '/admin'), {
      db: {} as never,
      freeHostPublic,
    })
    expect(response.status).toBe(209)
    expect(await response.text()).toBe('host-owned')
    expect(seen).toEqual(['tenant-a.trimly.co.ke'])
  })

  it('does not expose a legacy default site on the hosted product Host', async () => {
    let calls = 0
    const response = await handleServerRequest(request('app.trimly.co.ke', '/'), {
      db: new Proxy({}, {
        get() { throw new Error('legacy database fallback reached') },
      }) as never,
      freeHostPublic: { async route() { calls += 1; return null } },
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(calls).toBe(1)
  })

  it('redirects the exact hosted product root to admin before tenant public routing', async () => {
    let publicRouteCalls = 0
    let authorityChecks = 0
    const runtime = {
      db: new Proxy({}, {
        get() { throw new Error('database should not be queried for the product root') },
      }) as never,
      hostedStaffAuth: {
        origin: 'https://app.trimly.co.ke',
        handlesProductRequest(input: Request) {
          authorityChecks += 1
          return input.headers.get('host') === 'app.trimly.co.ke'
        },
        async handle() { return new Response('not reached', { status: 500 }) },
      } as never,
      freeHostPublic: {
        async route() {
          publicRouteCalls += 1
          return new Response('tenant route should not own the product root', { status: 500 })
        },
      },
    }

    for (const method of ['GET', 'HEAD']) {
      const response = await handleServerRequest(request('app.trimly.co.ke', '/', method), runtime)
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/admin')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(authorityChecks).toBe(2)
    expect(publicRouteCalls).toBe(0)
  })

  it('keeps process health independent without selecting a default tenant', async () => {
    let calls = 0
    const response = await handleServerRequest(request('unknown.invalid', '/health'), {
      db: {} as never,
      freeHostPublic: { async route() { calls += 1; return new Response('wrong') } },
    })
    expect(response.status).toBe(200)
    expect(calls).toBe(0)
  })
})
