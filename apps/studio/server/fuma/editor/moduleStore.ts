/**
 * Tenant-scoped persistence for authored TSX modules.
 *
 * Modules live in the same scoped storage the hosted editor already uses, keyed by
 * `{platformId, ownerKey, generation, resourceKind, logicalId}`. That matters more
 * than it looks: the old builder wrote to a single literal document id, so two sites
 * on one deployment shared one document and editing either overwrote the other.
 * Anchoring modules to the scope coordinate from the start means the engine cannot
 * inherit that bug.
 *
 * The mapping onto the existing storage needed no schema change, because the resource
 * kinds it already recognises — `page`, `component`, `layout` — are exactly the three
 * kinds of module the React engine has. The module path is the logical id.
 *
 * Every write goes through the same `ModuleWorkspace` validation the canvas and the
 * AI use, so a module that reaches storage is one the canvas can definitely open.
 * There is no path that persists something unreadable.
 */

import type { FumaRepositoryScope } from '../tenancy'
import type {
  EditorResourceKind,
  EditorScopedStorageKey,
  EditorScopedStoragePrefix,
} from './contracts'
import type { EditorScopedStorage } from './storage'
import type { ModuleStore } from '@core/react-ir/workspace'

/** What is persisted for one module. */
type StoredModule = Readonly<{
  source: string
  hash: string
  updatedAt: string
}>

/**
 * The resource kind a module path implies.
 *
 * Derived from Next's own file conventions rather than asked for separately, so the
 * stored kind cannot disagree with what the file actually is.
 */
export function resourceKindForPath(path: string): EditorResourceKind {
  if (path.endsWith('/layout.tsx') || path === 'layout.tsx') return 'layout'
  if (path.endsWith('/page.tsx') || path === 'page.tsx') return 'page'
  return 'component'
}

/** Every kind a module can be stored under, for listing across all of them. */
const MODULE_KINDS: readonly EditorResourceKind[] = ['page', 'layout', 'component']

function isStoredModule(value: unknown): value is StoredModule {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate['source'] === 'string'
    && typeof candidate['hash'] === 'string'
    && typeof candidate['updatedAt'] === 'string'
}

/**
 * A `ModuleStore` bound to one tenant scope.
 *
 * The scope is supplied once at construction rather than per call, so no caller can
 * accidentally read one site's module while writing another's.
 */
export function createScopedModuleStore(
  storage: EditorScopedStorage,
  scope: FumaRepositoryScope,
): ModuleStore {
  const keyFor = (path: string): EditorScopedStorageKey => ({
    platformId: scope.platformId,
    ownerKey: scope.ownerKey,
    generation: scope.generation,
    resourceKind: resourceKindForPath(path),
    logicalId: path,
  }) as EditorScopedStorageKey

  const prefixFor = (resourceKind: EditorResourceKind): EditorScopedStoragePrefix => ({
    platformId: scope.platformId,
    ownerKey: scope.ownerKey,
    generation: scope.generation,
    resourceKind,
  }) as EditorScopedStoragePrefix

  return {
    async get(path) {
      return await storage.transaction(async (transaction) => {
        const value = await transaction.get(keyFor(path))
        // A stored shape that no longer matches is treated as absent rather than
        // trusted, so a partial write or an older format cannot be served as source.
        if (!isStoredModule(value)) return null
        return { source: value.source, hash: value.hash, updatedAt: value.updatedAt }
      })
    },

    async put(path, source, hash, updatedAt) {
      await storage.transaction(async (transaction) => {
        await transaction.put(keyFor(path), { source, hash, updatedAt } satisfies StoredModule)
      })
    },

    async delete(path) {
      await storage.transaction(async (transaction) => {
        await transaction.delete(keyFor(path))
      })
    },

    async list() {
      return await storage.transaction(async (transaction) => {
        const paths: string[] = []
        // Listed per kind because the storage prefix includes the kind. A module's
        // kind is derived from its path, so a single prefix would miss two thirds
        // of the workspace.
        for (const resourceKind of MODULE_KINDS) {
          const entries = await transaction.list(prefixFor(resourceKind))
          for (const entry of entries) {
            if (isStoredModule(entry.value)) paths.push(entry.key.logicalId)
          }
        }
        // Sorted so callers get a stable order without each remembering to sort.
        return paths.sort()
      })
    },
  }
}
