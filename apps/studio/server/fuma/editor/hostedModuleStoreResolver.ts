/**
 * Request-scoped bridge from an authorized hosted tenant to the React module HTTP surface.
 *
 * Authorization and persistence construction are injected deliberately: this module can never
 * derive a tenant key from query parameters, and tests can prove a denied request creates no store.
 * The first list for each owner generation also repairs pre-scaffold sites. Repair is idempotent and
 * non-destructive because the supplied scaffolder writes only missing module paths.
 */
import { ModuleWorkspace, type ModuleStore } from '@core/react-ir/workspace'
import type { FumaRepositoryScope } from '../tenancy'
import type { ModuleHttpStore, ModuleStoreResolver } from '../../handlers/cms/editorModules'

export type AuthorizedHostedModuleTarget = Readonly<{
  scope: FumaRepositoryScope
  siteName: string
}>

export type HostedModuleStoreResolverInput = Readonly<{
  authorize(request: Request): Promise<AuthorizedHostedModuleTarget | null>
  createStore(scope: FumaRepositoryScope): ModuleStore
  ensureScaffold(target: AuthorizedHostedModuleTarget, store: ModuleStore): Promise<void>
}>

function scopeKey(scope: FumaRepositoryScope): string {
  return [scope.platformId, scope.ownerKey, scope.generation].join('\u0000')
}

function refusalReason(problems: readonly Readonly<{ message: string }>[]): string {
  return problems.map(({ message }) => message).join(' ') || 'The module write was refused.'
}

/**
 * Build the resolver registered by the running server.
 *
 * Scaffold completion is cached only after success. A transient filesystem or database failure is
 * retried on the next list instead of permanently pinning the site to an empty Explorer. Concurrent
 * lists share one promise, while different tenants remain independent.
 */
export function createHostedModuleStoreResolver(
  input: HostedModuleStoreResolverInput,
): ModuleStoreResolver {
  const scaffolded = new Set<string>()
  const scaffolding = new Map<string, Promise<void>>()

  async function ensureOnce(
    target: AuthorizedHostedModuleTarget,
    store: ModuleStore,
  ): Promise<void> {
    const key = scopeKey(target.scope)
    if (scaffolded.has(key)) return

    let pending = scaffolding.get(key)
    if (pending === undefined) {
      pending = input.ensureScaffold(target, store)
        .then(() => { scaffolded.add(key) })
        .finally(() => { scaffolding.delete(key) })
      scaffolding.set(key, pending)
    }
    await pending
  }

  return async (request) => {
    const target = await input.authorize(request)
    if (target === null) return null

    const store = input.createStore(target.scope)
    const workspace = new ModuleWorkspace(store)
    const httpStore: ModuleHttpStore = Object.freeze({
      async list() {
        // Existing sites may predate tenant scaffolding. Re-running it is intentional: missing paths
        // are added, while tenant-authored paths are skipped and can never be overwritten.
        await ensureOnce(target, store)
        return await workspace.list()
      },

      async read(path) {
        const found = await workspace.read(path)
        return found === null
          ? null
          : Object.freeze({ source: found.source, hash: found.hash })
      },

      async write({ path, source, baseHash }) {
        // Null means "create only". Treating it as no concurrency check would let a blind browser
        // write replace a module it never read.
        if (baseHash === null && await workspace.read(path) !== null) {
          return Object.freeze({
            ok: false,
            reason: `${path} already exists. Read it before applying an edit.`,
          })
        }

        const result = await workspace.write(
          path,
          source,
          baseHash === null ? {} : { baseHash },
        )
        return result.written
          ? Object.freeze({ ok: true, hash: result.module!.hash })
          : Object.freeze({ ok: false, reason: refusalReason(result.problems) })
      },
    })
    return httpStore
  }
}
