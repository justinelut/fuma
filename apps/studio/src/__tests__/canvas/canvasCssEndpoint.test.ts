/**
 * The canvas stylesheet endpoint.
 *
 * The security assertion matters most: the response discloses a site's design tokens and
 * costs the server real CPU to produce, so an unauthenticated caller must get nothing.
 */

import { describe, it, expect } from 'bun:test'
import { handleCanvasRoutes } from '../../../server/handlers/cms/canvas'
import type { DbClient } from '../../../server/db/client'

/**
 * A database that fails if touched.
 *
 * Every test here stops at the authentication boundary or the body check, so a query
 * would mean the handler did something before authorising — which is exactly the mistake
 * worth catching.
 */
const db = {
  query: () => { throw new Error('the handler queried the database before authorising') },
} as unknown as DbClient

const post = (body: unknown): Request => new Request(
  'http://localhost/admin/api/cms/canvas/tailwind',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  },
)

describe('routing', () => {
  it('does not claim an unrelated path', async () => {
    const response = await handleCanvasRoutes(
      new Request('http://localhost/admin/api/cms/fonts/google'),
      db,
    )
    expect(response).toBeNull()
  })

  it('rejects a GET on its own path as method not allowed', async () => {
    // POST is deliberate: a real candidate list is longer than a URL may safely be, and a
    // GET would put the site's whole class inventory in every access log. The route table
    // answers 405 rather than null once the path matches, so the request is not passed
    // down the chain to be misinterpreted by a later handler.
    const response = await handleCanvasRoutes(
      new Request('http://localhost/admin/api/cms/canvas/tailwind'),
      db,
    )
    expect(response?.status).toBe(405)
  })
})

describe('authorisation', () => {
  it('refuses a request with no session', async () => {
    const response = await handleCanvasRoutes(post({ theme: '', candidates: [] }), db)
    expect(response).not.toBeNull()
    expect([401, 403]).toContain(response?.status)
  })

  it('authorises before reading the body', async () => {
    // Otherwise a large body is buffered on behalf of a caller who is not allowed to ask.
    const response = await handleCanvasRoutes(
      post({ theme: 'x'.repeat(1000), candidates: ['p-4'] }),
      db,
    )
    expect([401, 403]).toContain(response?.status)
  })

  it('refuses before compiling, so no CPU is spent for an anonymous caller', async () => {
    const response = await handleCanvasRoutes(
      post({ theme: '@theme inline {\n --color-primary: #000;\n}', candidates: ['bg-primary'] }),
      db,
    )
    const payload = await response?.json() as { css?: string }
    expect(payload.css).toBeUndefined()
  })
})
