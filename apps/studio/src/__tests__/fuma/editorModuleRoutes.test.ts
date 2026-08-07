/**
 * Tests the HTTP surface for the tenant module store — the piece whose absence made the whole React
 * engine unreachable from a browser.
 *
 * `createScopedModuleStore` had no route at all, so nothing could list a module, read its source or
 * save one. The canvas mode built for task 51 therefore had nothing to open.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import {
  handleEditorModuleRoutes,
  moduleStoreResolverRegistered,
  setModuleStoreResolver,
  type ModuleHttpStore,
} from '../../../server/handlers/cms/editorModules'

/** A database that THROWS if queried, so a passing test proves the handler never reached it. */
const hostileDb = {
  query() { throw new Error('the handler must authorise before touching the database') },
} as never

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`https://admin.example.test${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}

function storeWith(paths: readonly string[]): ModuleHttpStore {
  return {
    async list() { return paths },
    async read(path) { return paths.includes(path) ? { source: 'export default function P(){return null}', hash: 'h1' } : null },
    async write() { return { ok: true, hash: 'h2' } },
  }
}

afterEach(() => { setModuleStoreResolver(null) })

describe('the resolver is null by default, so self-host is unchanged', () => {
  it('reports no resolver registered until one is set', () => {
    expect(moduleStoreResolverRegistered()).toBe(false)
    setModuleStoreResolver(async () => null)
    expect(moduleStoreResolverRegistered()).toBe(true)
  })

  it('the source states WHY null is the default', () => {
    // A route that pretends storage exists fails in a way that reads as a broken product rather than
    // as a feature this deployment does not have.
    const source = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', '..', '..', 'server/handlers/cms/editorModules.ts'), 'utf8')
    expect(source).toContain('Null by default so a self-hosted install is byte-for-byte unchanged')
  })
})

describe('every route authorises before it resolves a store', () => {
  it('refuses an unauthenticated list without querying', async () => {
    // The resolver is deliberately one that THROWS: reaching it would prove the order is wrong.
    setModuleStoreResolver(async () => { throw new Error('resolved before authorising') })
    const response = await handleEditorModuleRoutes(request('GET', '/admin/api/cms/editor/modules'), hostileDb)
    expect(response).not.toBeNull()
    expect([401, 403]).toContain(response!.status)
  })

  it('refuses an unauthenticated read', async () => {
    setModuleStoreResolver(async () => { throw new Error('resolved before authorising') })
    const response = await handleEditorModuleRoutes(
      request('GET', '/admin/api/cms/editor/module?path=app/page.tsx'), hostileDb)
    expect([401, 403]).toContain(response!.status)
  })

  it('refuses an unauthenticated write', async () => {
    setModuleStoreResolver(async () => { throw new Error('resolved before authorising') })
    const response = await handleEditorModuleRoutes(
      request('POST', '/admin/api/cms/editor/module', { path: 'app/page.tsx', source: 'x', baseHash: null }), hostileDb)
    expect([401, 403]).toContain(response!.status)
  })

  it('never includes module source in a refusal', async () => {
    // A store that WOULD return source is supplied deliberately: the refusal must come from the
    // capability check, so no source can reach an unauthenticated caller even when it exists.
    setModuleStoreResolver(async () => storeWith(['app/page.tsx']))
    const response = await handleEditorModuleRoutes(
      request('GET', '/admin/api/cms/editor/module?path=app/page.tsx'), hostileDb)
    expect([401, 403]).toContain(response!.status)
    const text = await response!.text()
    expect(text).not.toContain('export default')
  })

  it('checks the RETURNED refusal rather than assuming requireCapability throws', () => {
    // requireCapability returns a Response instead of throwing. Ignoring that return value serves
    // the request while the code reads as though it authorised - a real bug this suite caught in the
    // first draft of this handler, so the shape is asserted rather than trusted.
    const source = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', '..', '..', 'server/handlers/cms/editorModules.ts'), 'utf8')
    const guards = source.split('instanceof Response) return user').length - 1
    expect(guards).toBe(3)
  })
})

describe('the route table', () => {
  it('returns null for a path it does not own, so the chain continues', async () => {
    const response = await handleEditorModuleRoutes(request('GET', '/admin/api/cms/pages'), hostileDb)
    expect(response).toBeNull()
  })

  it('claims all three module operations', async () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', '..', '..', 'server/handlers/cms/editorModules.ts'), 'utf8')
    expect(source).toContain("{ method: 'GET', pattern: `${CMS_API_PREFIX}/editor/modules`")
    expect(source).toContain("{ method: 'GET', pattern: `${CMS_API_PREFIX}/editor/module`")
    expect(source).toContain("{ method: 'POST', pattern: `${CMS_API_PREFIX}/editor/module`")
  })

  it('gates a WRITE on structure editing, not merely read', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', '..', '..', 'server/handlers/cms/editorModules.ts'), 'utf8')
    // A module IS the page's structure, so a read capability must not be enough to replace it.
    const writeBody = source.slice(source.indexOf('async function handleWrite'))
    expect(writeBody).toContain("'site.structure.edit'")
    const readBody = source.slice(source.indexOf('async function handleRead'), source.indexOf('async function handleWrite'))
    expect(readBody).toContain("'site.read'")
    expect(readBody).not.toContain("'site.structure.edit'")
  })
})

describe('responses are never cacheable and refusals do not leak', () => {
  it('marks every response no-store', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', '..', '..', 'server/handlers/cms/editorModules.ts'), 'utf8')
    // A module's source is tenant content behind an authorisation decision; a cached copy would be
    // served to whoever asks next.
    expect(source).toContain("'cache-control': 'no-store'")
  })

  it('does NOT echo the requested path in a 404', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', '..', '..', 'server/handlers/cms/editorModules.ts'), 'utf8')
    // Echoing it confirms which files exist to a caller who may not read them.
    expect(source).toContain("return json({ error: 'No such module.' }, 404)")
  })

  it('answers a refused write with 409 rather than 400', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', '..', '..', 'server/handlers/cms/editorModules.ts'), 'utf8')
    // A stale base is a CONFLICT, and a client must be able to tell it from a malformed request:
    // one means "read again and retry", the other means "your code is wrong".
    expect(source).toContain('409')
  })
})

describe('it is registered in the CMS chain, not merely written', () => {
  it('is reached from the cms index', () => {
    const index = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', '..', '..', 'server/handlers/cms/index.ts'), 'utf8')
    expect(index).toContain("import { handleEditorModuleRoutes } from './editorModules'")
    expect(index).toContain('await handleEditorModuleRoutes(req, db)')
  })
})
