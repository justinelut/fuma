/**
 * The HTTP-backed ModuleStore — what lets the React canvas open a tenant's REAL source.
 *
 * Before this the editor store could only attach an in-memory store, so every module the canvas opened
 * was one the page had just invented: nothing on disk, nothing surviving a reload.
 */
import { describe, expect, it } from 'bun:test'
import { createHttpModuleStore, ModuleTransportError } from '@site/canvas/httpModuleStore'

type Call = Readonly<{ url: string, method: string, body: unknown }>

function fakeFetch(
  reply: (call: Call) => Readonly<{ status: number, body?: unknown }>,
  calls: Call[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null,
    }
    calls.push(call)
    const { status, body } = reply(call)
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

describe('reading a module', () => {
  it('returns the source and hash the server holds', async () => {
    const store = createHttpModuleStore(fakeFetch(() => ({
      status: 200, body: { path: 'app/page.tsx', source: 'export default function P(){}', hash: 'h1' },
    })))
    const found = await store.get('app/page.tsx')
    expect(found?.source).toBe('export default function P(){}')
    expect(found?.hash).toBe('h1')
  })

  it('treats 404 as ABSENT rather than as a failure', async () => {
    // A module that does not exist yet is the ordinary state before the first save. Throwing would
    // make "new file" indistinguishable from "the server is down".
    const store = createHttpModuleStore(fakeFetch(() => ({ status: 404, body: { error: 'No such module.' } })))
    expect(await store.get('app/new/page.tsx')).toBeNull()
  })

  it('THROWS on a server error rather than reporting absent', async () => {
    // Reporting a 500 as absent would present an existing module as a blank new file, and the next
    // save would erase it.
    const store = createHttpModuleStore(fakeFetch(() => ({ status: 500 })))
    await expect(store.get('app/page.tsx')).rejects.toBeInstanceOf(ModuleTransportError)
  })

  it('THROWS on a malformed payload rather than coercing it', async () => {
    const store = createHttpModuleStore(fakeFetch(() => ({ status: 200, body: { source: 42 } })))
    await expect(store.get('app/page.tsx')).rejects.toBeInstanceOf(ModuleTransportError)
  })

  it('encodes the path, so a nested module is requested correctly', async () => {
    const calls: Call[] = []
    const store = createHttpModuleStore(fakeFetch(
      () => ({ status: 200, body: { source: 'x', hash: 'h' } }), calls))
    await store.get('app/blog/[slug]/page.tsx')
    // Unencoded brackets and slashes would address a different resource than the one asked for.
    expect(calls[0]!.url).toContain(encodeURIComponent('app/blog/[slug]/page.tsx'))
  })
})

describe('the write carries the hash this session OBSERVED, so the server can refuse a conflict', () => {
  it('sends the hash from the preceding read as the base', async () => {
    const calls: Call[] = []
    const store = createHttpModuleStore(fakeFetch((call) => (
      call.method === 'GET'
        ? { status: 200, body: { source: 'old', hash: 'server-hash-1' } }
        : { status: 200, body: { hash: 'server-hash-2' } }
    ), calls))
    await store.get('app/page.tsx')
    await store.put('app/page.tsx', 'new', 'client-hash', '')
    const write = calls.find((call) => call.method === 'POST')!
    // ModuleStore.put has no base-hash parameter, so without remembering the read the server would
    // have to accept every write and two sessions would silently overwrite each other.
    expect((write.body as { baseHash?: unknown }).baseHash).toBe('server-hash-1')
  })

  it('sends NULL for a path this session never read', async () => {
    const calls: Call[] = []
    const store = createHttpModuleStore(fakeFetch(() => ({ status: 200, body: { hash: 'h' } }), calls))
    await store.put('app/fresh/page.tsx', 'source', 'client-hash', '')
    // Null means "this should not already exist", so a blind write cannot clobber a module somebody
    // else created between our list and our save.
    expect((calls[0]!.body as { baseHash?: unknown }).baseHash).toBeNull()
  })

  it('records the SERVER hash after a write, so the next base is what the server holds', async () => {
    const calls: Call[] = []
    const store = createHttpModuleStore(fakeFetch((call) => (
      call.method === 'POST' ? { status: 200, body: { hash: 'assigned-by-server' } } : { status: 404 }
    ), calls))
    await store.put('app/page.tsx', 'a', 'client-hash', '')
    await store.put('app/page.tsx', 'b', 'client-hash-2', '')
    const second = calls.filter((call) => call.method === 'POST')[1]!
    expect((second.body as { baseHash?: unknown }).baseHash).toBe('assigned-by-server')
  })

  it('reports a 409 with the server reason so a client can retry rather than guess', async () => {
    const store = createHttpModuleStore(fakeFetch(() => ({ status: 409, body: { error: 'stale-base' } })))
    await expect(store.put('app/page.tsx', 'x', 'h', '')).rejects.toThrow('stale-base')
  })
})

describe('listing', () => {
  it('returns the paths the server reports', async () => {
    const store = createHttpModuleStore(fakeFetch(() => ({
      status: 200, body: { paths: ['app/page.tsx', 'components/Hero.tsx'] },
    })))
    expect(await store.list()).toEqual(['app/page.tsx', 'components/Hero.tsx'])
  })

  it('THROWS on failure rather than returning an empty list', async () => {
    // An empty list reads as "this site has no modules", which is exactly the state a new tenant is
    // in - so a failure must be distinguishable from an empty workspace.
    const store = createHttpModuleStore(fakeFetch(() => ({ status: 500 })))
    await expect(store.list()).rejects.toBeInstanceOf(ModuleTransportError)
  })

  it('drops non-string entries rather than trusting the payload', async () => {
    const store = createHttpModuleStore(fakeFetch(() => ({
      status: 200, body: { paths: ['app/page.tsx', 7, null] },
    })))
    expect(await store.list()).toEqual(['app/page.tsx'])
  })
})

describe('delete refuses instead of pretending', () => {
  it('throws, because a silent no-op would report a module gone while it stays on disk', async () => {
    const store = createHttpModuleStore(fakeFetch(() => ({ status: 200 })))
    await expect(store.delete('app/page.tsx')).rejects.toBeInstanceOf(ModuleTransportError)
  })
})

describe('every request carries credentials', () => {
  it('would otherwise be anonymous and refused', async () => {
    // The session is a cookie; without same-origin credentials every call is unauthenticated.
    const source = readSource()
    const occurrences = source.split("credentials: 'same-origin'").length - 1
    expect(occurrences).toBe(3)
  })
})

function readSource(): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  return readFileSync(
    join(import.meta.dir, '..', '..', 'admin/pages/site/canvas/httpModuleStore.ts'), 'utf8')
}
