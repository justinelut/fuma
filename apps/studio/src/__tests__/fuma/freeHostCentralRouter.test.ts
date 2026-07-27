import { describe, expect, it } from 'bun:test'
import { handleServerRequest } from '../../../server/router'
import type { FreeHostPublicBoundary } from '../../../server/fuma/freeHosts'

function request(host: string, path: string): Request {
  return {
    method: 'GET',
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
    const response = await handleServerRequest(request('tenant-a.fuma.co.ke', '/admin'), {
      db: {} as never,
      freeHostPublic,
    })
    expect(response.status).toBe(209)
    expect(await response.text()).toBe('host-owned')
    expect(seen).toEqual(['tenant-a.fuma.co.ke'])
  })

  it('does not expose a legacy default site on the hosted product Host', async () => {
    let calls = 0
    const response = await handleServerRequest(request('app.fuma.co.ke', '/'), {
      db: new Proxy({}, {
        get() { throw new Error('legacy database fallback reached') },
      }) as never,
      freeHostPublic: { async route() { calls += 1; return null } },
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(calls).toBe(1)
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
