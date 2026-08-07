/**
 * HTTP access to the tenant's React IR module store.
 *
 * WHY THIS EXISTS: `createScopedModuleStore` had no HTTP surface at all, so a browser could not list a
 * module, read its source, or save one. Every piece of the React engine above it was therefore
 * unreachable from the product — the canvas mode built for task 51 had nothing to open.
 *
 * THE SCOPE IS RESOLVED PER REQUEST, NEVER TAKEN FROM THE URL. That is the task-20 lesson: the tenant
 * scope arrives as query parameters, so deriving a storage key from them directly would let any
 * signed-in staff user read and overwrite another tenant's source by editing `?siteId=`. The resolver
 * bridge below performs the same authorisation the storage-allowance bridge does, so a caller reaches
 * a module only after proving they may edit this site.
 */
import type { DbClient } from '../../db/client'
import { requireCapability } from '../../auth/authz'
import { CMS_API_PREFIX } from './shared'
import { runRouteTable, type Route } from './routeTable'
import { readValidatedBody } from '../../http'
import { Type } from '@core/utils/typeboxHelpers'

/** What a caller may do with one module. Reads and writes are separate so a read cannot write. */
export type ModuleHttpStore = Readonly<{
  list(): Promise<readonly string[]>
  read(path: string): Promise<Readonly<{ source: string, hash: string }> | null>
  write(input: Readonly<{ path: string, source: string, baseHash: string | null }>):
    Promise<Readonly<{ ok: boolean, hash?: string, reason?: string }>>
}>

/**
 * Resolves the store for THIS request, or null when the deployment has none.
 *
 * Null by default so a self-hosted install is byte-for-byte unchanged: it has no scoped editor
 * storage, and a route that pretends otherwise would fail in a way that reads as a broken product
 * rather than as a feature that is not present.
 */
export type ModuleStoreResolver = (request: Request) => Promise<ModuleHttpStore | null>

let resolver: ModuleStoreResolver | null = null

export function setModuleStoreResolver(next: ModuleStoreResolver | null): void {
  resolver = next
}

export function moduleStoreResolverRegistered(): boolean {
  return resolver !== null
}

/** 404 rather than 500: the deployment genuinely has no module store, which is not an error. */
function notAvailable(): Response {
  return new Response(JSON.stringify({ error: 'Module storage is not available on this deployment.' }), {
    status: 404,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    // A module's source is tenant content and reflects an authorisation decision, so it must never
    // land in a shared cache.
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

const WriteSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 400 }),
  source: Type.String({ maxLength: 400_000 }),
  /** Null means "this file should not already exist", which is how a create is distinguished. */
  baseHash: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
}, { additionalProperties: false })

async function handleList(req: Request, db: DbClient): Promise<Response> {
  // Capability is checked BEFORE the store is resolved, so an unauthorised caller costs no lookup and
  // learns nothing about whether the deployment has module storage.
  // requireCapability RETURNS a refusal Response rather than throwing, so the result MUST be checked
  // and returned. Ignoring it serves the request to an unauthenticated caller while the code reads as
  // though it authorised - the mistake this file's own tests caught.
  const user = await requireCapability(req, db, 'site.read')
  if (user instanceof Response) return user
  if (resolver === null) return notAvailable()
  const store = await resolver(req)
  if (store === null) return notAvailable()
  return json({ paths: await store.list() })
}

async function handleRead(req: Request, db: DbClient): Promise<Response> {
  const user = await requireCapability(req, db, 'site.read')
  if (user instanceof Response) return user
  if (resolver === null) return notAvailable()
  const path = new URL(req.url).searchParams.get('path')?.trim() ?? ''
  if (path === '') return json({ error: 'A path is required.' }, 400)
  const store = await resolver(req)
  if (store === null) return notAvailable()
  const found = await store.read(path)
  // 404 does NOT echo the requested path: echoing it back confirms to an unauthorised caller which
  // files exist, the same reasoning siteDocumentResolver's refusal follows.
  if (found === null) return json({ error: 'No such module.' }, 404)
  return json({ path, source: found.source, hash: found.hash })
}

async function handleWrite(req: Request, db: DbClient): Promise<Response> {
  // A WRITE demands the structure capability, not merely read: a module is the page's structure.
  const user = await requireCapability(req, db, 'site.structure.edit')
  if (user instanceof Response) return user
  if (resolver === null) return notAvailable()
  const body = await readValidatedBody(req, WriteSchema)
  if (body === null) return json({ error: 'Invalid module write.' }, 400)
  const store = await resolver(req)
  if (store === null) return notAvailable()
  const result = await store.write(body)
  // A refused write is 409, not 400: the request was well formed and the CONFLICT is the answer, so a
  // client can tell "your base is stale, read again" from "your request was malformed".
  if (!result.ok) return json({ error: result.reason ?? 'Refused.' }, 409)
  return json({ path: body.path, hash: result.hash })
}

const routes: readonly Route<[]>[] = [
  { method: 'GET', pattern: `${CMS_API_PREFIX}/editor/modules`, handler: handleList },
  { method: 'GET', pattern: `${CMS_API_PREFIX}/editor/module`, handler: handleRead },
  { method: 'POST', pattern: `${CMS_API_PREFIX}/editor/module`, handler: handleWrite },
]

export function handleEditorModuleRoutes(req: Request, db: DbClient): Promise<Response | null> {
  return runRouteTable(req, db, routes)
}
