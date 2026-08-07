/**
 * A `ModuleStore` backed by the tenant module endpoint, so the browser can open a real module.
 *
 * Until this existed the React editor store could only be attached to an in-memory store, which means
 * every module the canvas opened was one the page had just invented — nothing on disk, nothing that
 * survived a reload. This is what makes the React canvas mode reach a tenant's actual source.
 */
import type { ModuleStore } from '@core/react-ir/workspace'
import { activeBuilderScopeQuery } from '@core/fuma/builder/builderScope'

const BASE = '/admin/api/cms/editor'

/** Thrown rather than returned, because ModuleStore's methods have no failure channel of their own. */
export class ModuleTransportError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ModuleTransportError'
    this.status = status
  }
}

function scopeSuffix(separator: '?' | '&'): string {
  const query = activeBuilderScopeQuery()
  const parts = Object.entries(query).map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  return parts.length === 0 ? '' : `${separator}${parts.join('&')}`
}

/**
 * Creates the store.
 *
 * REMEMBERS THE HASH IT LAST READ per path, and sends it as the write's base. The ModuleStore
 * interface has no place for a base hash — `put` receives only the NEW hash — so without this the
 * server would have to accept every write and the only conflict detection would be the client's own.
 * That is not enough: two sessions editing one module each hold a base the other cannot see, so the
 * second write would silently overwrite the first. Remembering the observed hash lets the SERVER
 * refuse, which is the only side that sees both writes.
 */
export function createHttpModuleStore(fetchImpl: typeof fetch = fetch): ModuleStore {
  /** path -> the hash this session last saw on the server. */
  const observed = new Map<string, string>()

  async function readJson(response: Response): Promise<unknown> {
    const text = await response.text()
    if (text === '') return null
    try { return JSON.parse(text) as unknown } catch { return null }
  }

  return {
    async get(path) {
      const response = await fetchImpl(
        `${BASE}/module?path=${encodeURIComponent(path)}${scopeSuffix('&')}`,
        { credentials: 'same-origin' },
      )
      // ABSENT is not a failure: a module that does not exist yet is the ordinary state before the
      // first save, and throwing would make "new file" indistinguishable from "server is down".
      if (response.status === 404) return null
      if (!response.ok) {
        throw new ModuleTransportError(`Could not read ${path}.`, response.status)
      }
      const body = await readJson(response) as { source?: unknown, hash?: unknown } | null
      if (typeof body?.source !== 'string' || typeof body.hash !== 'string') {
        // A malformed payload is reported rather than coerced: treating it as absent would present a
        // module that exists as a blank new file, and the next save would erase it.
        throw new ModuleTransportError(`Unreadable response for ${path}.`, response.status)
      }
      observed.set(path, body.hash)
      // updatedAt is not carried by the endpoint. Returning the current instant would invent a fact,
      // so the empty string states that this store does not know it — the workspace uses it only as
      // an opaque record.
      return { source: body.source, hash: body.hash, updatedAt: '' }
    },

    async put(path, source, hash) {
      const response = await fetchImpl(`${BASE}/module${scopeSuffix('?')}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        // A path this session has never read carries a NULL base, which the server reads as "this
        // file should not already exist" — so a blind write cannot clobber a module somebody else
        // created between our list and our save.
        body: JSON.stringify({ path, source, baseHash: observed.get(path) ?? null }),
      })
      if (response.status === 409) {
        const body = await readJson(response) as { error?: unknown } | null
        throw new ModuleTransportError(
          typeof body?.error === 'string' ? body.error : `${path} changed since it was read.`,
          409,
        )
      }
      if (!response.ok) {
        throw new ModuleTransportError(`Could not save ${path}.`, response.status)
      }
      const body = await readJson(response) as { hash?: unknown } | null
      // Records the hash the SERVER assigned rather than the one passed in, so the next write's base
      // is what the server actually holds even if the two ever disagree.
      observed.set(path, typeof body?.hash === 'string' ? body.hash : hash)
    },

    async delete() {
      // REFUSES rather than pretending. There is no delete route, and a silent no-op would report a
      // module as removed while it stays on disk and reappears on the next list — worse than an error,
      // because the author would believe it was gone.
      throw new ModuleTransportError('Deleting a module is not supported yet.', 501)
    },

    async list() {
      const response = await fetchImpl(`${BASE}/modules${scopeSuffix('?')}`, { credentials: 'same-origin' })
      // An EMPTY list on failure would read as "this site has no modules", which is the state a new
      // tenant is in — so a failure must be distinguishable from an empty workspace.
      if (!response.ok) {
        throw new ModuleTransportError('Could not list modules.', response.status)
      }
      const body = await readJson(response) as { paths?: unknown } | null
      if (!Array.isArray(body?.paths)) {
        throw new ModuleTransportError('Unreadable module list.', response.status)
      }
      return body.paths.filter((entry): entry is string => typeof entry === 'string')
    },
  }
}
