import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createHostedModuleStoreResolver,
  type AuthorizedHostedModuleTarget,
} from '../../../server/fuma/editor/hostedModuleStoreResolver'
import {
  createMemoryModuleStore,
  hashSource,
  type ModuleStore,
} from '@core/react-ir/workspace'

const target: AuthorizedHostedModuleTarget = Object.freeze({
  scope: Object.freeze({
    platformId: 'fuma',
    organizationId: 'org-1',
    workspaceId: 'workspace-1',
    siteId: 'site-1',
    ownerKey: 'owner-1',
    generation: 1,
    state: 'active',
    transferFence: null,
  }),
  siteName: 'Existing Site',
})

const request = new Request(
  'https://app.example.test/admin/api/cms/editor/modules'
  + '?organizationId=org-1&workspaceId=workspace-1&siteId=site-1',
)

const authoredPage = 'export default function Page() { return <main data-fuma-id="root">Mine</main> }'
const starterPage = 'export default function Page() { return <main data-fuma-id="root">Starter</main> }'
const button = 'export function Button() { return <button data-fuma-id="button">Button</button> }\n'

async function put(store: ModuleStore, path: string, source: string): Promise<void> {
  await store.put(path, source, await hashSource(source), '2026-08-08T00:00:00.000Z')
}

function resolverFor(
  store: ModuleStore,
  ensureScaffold: (store: ModuleStore) => Promise<void>,
  authorize: () => Promise<AuthorizedHostedModuleTarget | null> = async () => target,
) {
  return createHostedModuleStoreResolver({
    authorize,
    createStore: () => store,
    ensureScaffold: async (_target, scopedStore) => await ensureScaffold(scopedStore),
  })
}

describe('hosted module resolver reachability', () => {
  it('does not construct or touch storage when exact site authorization refuses', async () => {
    let storesCreated = 0
    let scaffoldCalls = 0
    const resolver = createHostedModuleStoreResolver({
      authorize: async () => null,
      createStore: () => { storesCreated += 1; return createMemoryModuleStore() },
      ensureScaffold: async () => { scaffoldCalls += 1 },
    })

    expect(await resolver(request)).toBeNull()
    expect(storesCreated).toBe(0)
    expect(scaffoldCalls).toBe(0)
  })

  it('turns an empty pre-scaffold site into a list containing app/page.tsx', async () => {
    const store = createMemoryModuleStore()
    const resolver = resolverFor(store, async (scopedStore) => {
      await put(scopedStore, 'app/page.tsx', starterPage)
      await put(scopedStore, 'components/ui/button.tsx', button)
    })

    const httpStore = await resolver(request)
    expect(httpStore).not.toBeNull()
    expect(await httpStore!.list()).toEqual(['app/page.tsx', 'components/ui/button.tsx'])
    expect((await httpStore!.read('app/page.tsx'))?.source).toBe(starterPage)
  })

  it('fills missing scaffold modules without overwriting an authored home page', async () => {
    const store = createMemoryModuleStore()
    await put(store, 'app/page.tsx', authoredPage)
    const resolver = resolverFor(store, async (scopedStore) => {
      if (await scopedStore.get('app/page.tsx') === null) {
        await put(scopedStore, 'app/page.tsx', starterPage)
      }
      if (await scopedStore.get('components/ui/button.tsx') === null) {
        await put(scopedStore, 'components/ui/button.tsx', button)
      }
    })

    const httpStore = (await resolver(request))!
    expect(await httpStore.list()).toContain('components/ui/button.tsx')
    expect((await httpStore.read('app/page.tsx'))?.source).toBe(authoredPage)
  })

  it('runs one scaffold for concurrent lists and retries after a transient failure', async () => {
    const store = createMemoryModuleStore()
    let attempts = 0
    const resolver = resolverFor(store, async (scopedStore) => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary storage outage')
      await put(scopedStore, 'app/page.tsx', starterPage)
    })
    const first = (await resolver(request))!
    await expect(first.list()).rejects.toThrow('temporary storage outage')

    const second = (await resolver(request))!
    expect(await second.list()).toEqual(['app/page.tsx'])
    expect(attempts).toBe(2)
    await Promise.all([second.list(), second.list()])
    expect(attempts).toBe(2)
  })

  it('keeps writes inside React IR validation and refuses unscannable Tailwind source', async () => {
    const store = createMemoryModuleStore()
    const resolver = resolverFor(store, async () => {})
    const httpStore = (await resolver(request))!
    const source = [
      'export default function Page({ tone }: { tone: string }) {',
      '  return <main data-fuma-id="root" className={`bg-${tone}`}>Broken</main>',
      '}',
    ].join('\n')

    const result = await httpStore.write({ path: 'app/page.tsx', source, baseHash: null })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Tailwind|runtime|scannable|expression/i)
    expect(await store.get('app/page.tsx')).toBeNull()
  })

  it('treats a null base hash as create-only instead of overwriting unseen source', async () => {
    const store = createMemoryModuleStore()
    await put(store, 'app/page.tsx', authoredPage)
    const resolver = resolverFor(store, async () => {})
    const result = await (await resolver(request))!.write({
      path: 'app/page.tsx',
      source: starterPage,
      baseHash: null,
    })
    expect(result.ok).toBe(false)
    expect((await store.get('app/page.tsx'))?.source).toBe(authoredPage)
  })
})

describe('the production bootstrap registers the bridge that the deployed server executes', () => {
  it('registers under hosted config and derives owner generation only after exact authorization', () => {
    const studio = join(import.meta.dir, '..', '..', '..')
    const source = readFileSync(join(studio, 'server/index.ts'), 'utf8')
    const hostedGuard = source.indexOf('if (hostedFumaConfig) {\n  const editorStorage')
    const registration = source.indexOf('setModuleStoreResolver(createHostedModuleStoreResolver({')
    const exactAuthorization = source.indexOf('.loadExactSiteAuthorization({', registration)
    const ownerAuthority = source.indexOf('transaction.loadScopeAuthorityForUpdate(', registration)
    const storeConstruction = source.indexOf('createStore: (scope) => createScopedModuleStore', registration)

    expect(hostedGuard).toBeGreaterThan(-1)
    expect(registration).toBeGreaterThan(hostedGuard)
    expect(exactAuthorization).toBeGreaterThan(registration)
    expect(ownerAuthority).toBeGreaterThan(exactAuthorization)
    expect(storeConstruction).toBeGreaterThan(ownerAuthority)
  })

  it('wires non-destructive existing-site scaffold repair into module listing', () => {
    const studio = join(import.meta.dir, '..', '..', '..')
    const source = readFileSync(join(studio, 'server/index.ts'), 'utf8')
    const registration = source.slice(source.indexOf('setModuleStoreResolver('))
    expect(registration).toContain('scaffoldTenantWorkspace(scaffoldStudioRoot(), target.siteName)')
    expect(registration).toContain('persistScaffold(')
    expect(registration).toContain("store.get('app/page.tsx')")
  })
})
