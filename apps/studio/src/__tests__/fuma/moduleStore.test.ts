import { describe, it, expect } from 'bun:test'
import {
  createScopedModuleStore,
  resourceKindForPath,
} from '../../../server/fuma/editor/moduleStore'
import type {
  EditorScopedStorage,
  EditorScopedStorageTransaction,
} from '../../../server/fuma/editor/storage'
import { ModuleWorkspace } from '@core/react-ir/workspace'
import type { FumaRepositoryScope } from '../../../server/fuma/tenancy'

/**
 * A storage double that keys exactly the way the real adapter does.
 *
 * Written to include every scope field in the key, because the whole point of these
 * tests is that two sites cannot reach each other's modules — a double that ignored
 * the scope would make the isolation tests pass for the wrong reason.
 */
function memoryStorage(): EditorScopedStorage & { size: () => number } {
  const rows = new Map<string, unknown>()
  const keyOf = (key: {
    platformId: string, ownerKey: string, generation: number,
    resourceKind: string, logicalId: string,
  }): string =>
    [key.platformId, key.ownerKey, String(key.generation), key.resourceKind, key.logicalId]
      .join('\u0000')

  const transaction = {
    async get(key) {
      return rows.get(keyOf(key)) ?? null
    },
    async put(key, value) {
      rows.set(keyOf(key), value)
    },
    async delete(key) {
      rows.delete(keyOf(key))
    },
    async list(prefix) {
      const head = [prefix.platformId, prefix.ownerKey, String(prefix.generation), prefix.resourceKind]
        .join('\u0000')
      const entries: { key: Record<string, unknown>, value: unknown }[] = []
      for (const [composite, value] of rows) {
        if (!composite.startsWith(`${head}\u0000`)) continue
        const parts = composite.split('\u0000')
        entries.push({
          key: {
            platformId: parts[0], ownerKey: parts[1], generation: Number(parts[2]),
            resourceKind: parts[3], logicalId: parts[4],
          },
          value,
        })
      }
      return entries
    },
    async deletePrefix() { /* unused here */ },
    async loadScopeAuthorityForUpdate() { return null },
    async lockDraftSequence() { return 0 },
    async setDraftSequence() { /* unused */ },
    async getDraftMutationReceipt() { return null },
    async putDraftMutationReceipt() { /* unused */ },
  } as unknown as EditorScopedStorageTransaction

  return {
    async transaction(work) {
      return await work(transaction)
    },
    size: () => rows.size,
  }
}

const scopeFor = (siteId: string, generation = 1): FumaRepositoryScope => ({
  platformId: 'platform-1',
  organizationId: 'org-1',
  workspaceId: 'workspace-1',
  siteId,
  ownerKey: `owner-${siteId}`,
  generation,
  state: 'active',
  transferFence: null,
} as unknown as FumaRepositoryScope)

const page = `export default function Page() {
  return <section /* @fuma root */ className="grid">Hello</section>
}
`

describe('resource kind from a module path', () => {
  it('derives the kind from Next’s own file conventions', () => {
    // Derived rather than asked for separately, so the stored kind cannot disagree
    // with what the file actually is.
    expect(resourceKindForPath('app/page.tsx')).toBe('page')
    expect(resourceKindForPath('app/blog/page.tsx')).toBe('page')
    expect(resourceKindForPath('app/layout.tsx')).toBe('layout')
    expect(resourceKindForPath('app/blog/layout.tsx')).toBe('layout')
    expect(resourceKindForPath('components/Hero.tsx')).toBe('component')
  })

  it('handles a path with no directory', () => {
    expect(resourceKindForPath('page.tsx')).toBe('page')
    expect(resourceKindForPath('layout.tsx')).toBe('layout')
  })
})

describe('storing and reading a module', () => {
  it('round-trips source, hash and timestamp', async () => {
    const store = createScopedModuleStore(memoryStorage(), scopeFor('site-a'))
    await store.put('app/page.tsx', page, 'a'.repeat(64), '2026-01-01T00:00:00.000Z')
    const read = await store.get('app/page.tsx')
    expect(read).toEqual({
      source: page, hash: 'a'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('returns null for a module that was never written', async () => {
    const store = createScopedModuleStore(memoryStorage(), scopeFor('site-a'))
    expect(await store.get('app/page.tsx')).toBeNull()
  })

  it('treats an unrecognised stored shape as absent', async () => {
    // A partial write or an older format must not be served as source.
    const storage = memoryStorage()
    const store = createScopedModuleStore(storage, scopeFor('site-a'))
    await storage.transaction(async (transaction) => {
      await transaction.put({
        platformId: 'platform-1', ownerKey: 'owner-site-a', generation: 1,
        resourceKind: 'page', logicalId: 'app/page.tsx',
      } as never, { unexpected: true })
    })
    expect(await store.get('app/page.tsx')).toBeNull()
  })

  it('deletes a module', async () => {
    const store = createScopedModuleStore(memoryStorage(), scopeFor('site-a'))
    await store.put('app/page.tsx', page, 'a'.repeat(64), '2026-01-01T00:00:00.000Z')
    await store.delete('app/page.tsx')
    expect(await store.get('app/page.tsx')).toBeNull()
  })
})

describe('listing across kinds', () => {
  it('finds pages, layouts and components together', async () => {
    // A module's kind comes from its path, so listing one prefix would miss two
    // thirds of the workspace.
    const store = createScopedModuleStore(memoryStorage(), scopeFor('site-a'))
    for (const path of ['app/page.tsx', 'app/layout.tsx', 'components/Hero.tsx']) {
      await store.put(path, page, 'a'.repeat(64), '2026-01-01T00:00:00.000Z')
    }
    expect(await store.list())
      .toEqual(['app/layout.tsx', 'app/page.tsx', 'components/Hero.tsx'])
  })

  it('returns an empty list for a fresh site', async () => {
    const store = createScopedModuleStore(memoryStorage(), scopeFor('site-a'))
    expect(await store.list()).toEqual([])
  })
})

describe('tenant isolation', () => {
  it('keeps two sites’ modules at the same path separate', async () => {
    // The failure this prevents: the old builder wrote to one literal document id,
    // so two sites shared a document and editing either overwrote the other.
    const storage = memoryStorage()
    const siteA = createScopedModuleStore(storage, scopeFor('site-a'))
    const siteB = createScopedModuleStore(storage, scopeFor('site-b'))

    await siteA.put('app/page.tsx', 'A source', 'a'.repeat(64), '2026-01-01T00:00:00.000Z')
    await siteB.put('app/page.tsx', 'B source', 'b'.repeat(64), '2026-01-01T00:00:00.000Z')

    expect((await siteA.get('app/page.tsx'))?.source).toBe('A source')
    expect((await siteB.get('app/page.tsx'))?.source).toBe('B source')
    expect(storage.size()).toBe(2)
  })

  it('does not list another site’s modules', async () => {
    const storage = memoryStorage()
    const siteA = createScopedModuleStore(storage, scopeFor('site-a'))
    const siteB = createScopedModuleStore(storage, scopeFor('site-b'))
    await siteA.put('app/page.tsx', 'A', 'a'.repeat(64), '2026-01-01T00:00:00.000Z')
    expect(await siteB.list()).toEqual([])
  })

  it('does not let one site delete another’s module', async () => {
    const storage = memoryStorage()
    const siteA = createScopedModuleStore(storage, scopeFor('site-a'))
    const siteB = createScopedModuleStore(storage, scopeFor('site-b'))
    await siteA.put('app/page.tsx', 'A', 'a'.repeat(64), '2026-01-01T00:00:00.000Z')
    await siteB.delete('app/page.tsx')
    expect((await siteA.get('app/page.tsx'))?.source).toBe('A')
  })

  it('separates owner-key generations', async () => {
    // A generation bump is how ownership transfer fences old data; reading across it
    // would leak the previous owner's content.
    const storage = memoryStorage()
    const first = createScopedModuleStore(storage, scopeFor('site-a', 1))
    const second = createScopedModuleStore(storage, scopeFor('site-a', 2))
    await first.put('app/page.tsx', 'gen one', 'a'.repeat(64), '2026-01-01T00:00:00.000Z')
    expect(await second.get('app/page.tsx')).toBeNull()
  })
})

describe('through the workspace', () => {
  it('validates before persisting, so storage holds only openable modules', async () => {
    const workspace = new ModuleWorkspace(
      createScopedModuleStore(memoryStorage(), scopeFor('site-a')))

    const refused = await workspace.write('app/page.tsx',
      `export default function Page(props: { rest: object }) {
  return <section {...props.rest} />
}
`)
    expect(refused.written).toBe(false)
    expect(await workspace.read('app/page.tsx')).toBeNull()

    const accepted = await workspace.write('app/page.tsx', page)
    expect(accepted.written).toBe(true)
    expect((await workspace.read('app/page.tsx'))?.source).toBe(page)
  })

  it('detects a concurrent change through the scoped store', async () => {
    const workspace = new ModuleWorkspace(
      createScopedModuleStore(memoryStorage(), scopeFor('site-a')))
    await workspace.write('app/page.tsx', page)
    const stale = await workspace.write('app/page.tsx',
      page.replace('Hello', 'Overwritten'), { baseHash: 'f'.repeat(64) })
    expect(stale.written).toBe(false)
    expect((await workspace.read('app/page.tsx'))?.source).toContain('Hello')
  })
})
