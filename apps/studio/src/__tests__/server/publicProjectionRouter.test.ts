import { describe, expect, test } from 'bun:test'
import type { DbClient } from '../../../server/db'
import type { PublicProjectionBoundary } from '../../../server/fuma/publicProjections'
import { handleServerRequest } from '../../../server/router'

const db = (async () => ({ rows: [], rowCount: 0 })) as unknown as DbClient

describe('public projection router composition', () => {
  test('dispatches the complete private namespace to the hosted projection boundary', async () => {
    let handled = 0
    const publicProjections: PublicProjectionBoundary = {
      handles: () => true,
      handle: async () => {
        handled += 1
        return new Response(JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'Public data is temporarily unavailable.' } }), {
          status: 503,
          headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
        })
      },
    }
    const response = await handleServerRequest(new Request(
      'http://studio-internal.service/_fuma/private/public/v1/product-facts',
    ), { db, publicProjections })
    expect(response.status).toBe(503)
    expect(handled).toBe(1)
  })

  test('absorbs the private namespace when hosted projection composition is absent', async () => {
    const response = await handleServerRequest(new Request(
      'http://studio-internal.service/_fuma/private/public/v1/product-facts',
    ), { db })
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Resource not found.' } })
  })
})
