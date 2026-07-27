import { describe, expect, it, spyOn } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db'
import type { FumaScopedRouteBoundary } from '../../../server/fuma/context'
import { createFumaEditorScopedApiBoundary } from '../../../server/fuma/editor/composition'
import type {
  EditorScopedStorage,
  EditorScopedStorageTransaction,
} from '../../../server/fuma/editor'
import { handleServerRequest } from '../../../server/router'

const SCOPED_EDITOR_URL = 'https://hosted.fuma.test/api/fuma/organizations/org-a/workspaces/workspace-a/sites/site-a/editor/document'

function selfHostDb(): DbClient {
  const query = async <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<DbResult<Row>> => {
    const sql = strings.join(' ').toLowerCase()
    if (sql.includes('count(*) as count') && sql.includes('from site')) {
      return { rows: [{ count: 0 } as Row], rowCount: 1 }
    }
    if (sql.includes('from users') && sql.includes('role_id')) {
      return { rows: [{ count: 0 } as Row], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }
  query.transaction = async <T>(work: (transaction: DbClient) => Promise<T>) => (
    work(query as DbClient)
  )
  return query as DbClient
}

function noLegacyAccessDb(): DbClient {
  const query = async (): Promise<never> => {
    throw new Error('FUMA request reached legacy/self-host persistence.')
  }
  query.transaction = async (): Promise<never> => {
    throw new Error('FUMA request reached a legacy/self-host transaction.')
  }
  return query as unknown as DbClient
}

function boundary(
  implementation: Partial<FumaScopedRouteBoundary> = {},
): FumaScopedRouteBoundary {
  return {
    handles: implementation.handles ?? (() => true),
    handle: implementation.handle ?? (() => Promise.resolve(
      new Response('fuma-owned', { status: 209 }),
    )),
  }
}

describe('FUMA-027 central scoped API mount', () => {
  it('dispatches the scoped boundary before legacy CMS and owns the entire namespace', async () => {
    const source = await Bun.file(new URL('../../../server/router.ts', import.meta.url)).text()
    const table = source.slice(source.indexOf('const routes:'), source.indexOf('export async function handleServerRequest'))
    expect(table.indexOf('tryServeFumaScopedApi')).toBeGreaterThan(-1)
    expect(table.indexOf('tryServeFumaScopedApi')).toBeLessThan(table.indexOf('tryServeCmsApi'))

    const calls: string[] = []
    const mounted = boundary({
      handles() {
        calls.push('handles')
        return true
      },
      handle() {
        calls.push('handle')
        return Promise.resolve(new Response('scoped', { status: 209 }))
      },
    })
    const owned = await handleServerRequest(
      new Request(SCOPED_EDITOR_URL),
      { db: noLegacyAccessDb(), fumaScopedApi: mounted },
    )
    expect(owned.status).toBe(209)
    expect(await owned.text()).toBe('scoped')
    expect(calls).toEqual(['handles', 'handle'])

    const unregistered = await handleServerRequest(
      new Request('https://hosted.fuma.test/api/fuma/not-a-scoped-route'),
      {
        db: noLegacyAccessDb(),
        fumaScopedApi: boundary({
          handles: () => false,
          handle: () => {
            throw new Error('unmatched route must not invoke the boundary handler')
          },
        }),
      },
    )
    expect(unregistered.status).toBe(404)
    expect(await unregistered.json()).toEqual({ error: 'Resource not found.' })
  })

  it('keeps boundary failures inside the FUMA namespace', async () => {
    const errorLog = spyOn(console, 'error').mockImplementation(() => {})
    const response = await handleServerRequest(
      new Request(SCOPED_EDITOR_URL),
      {
        db: noLegacyAccessDb(),
        fumaScopedApi: boundary({
          handle: () => Promise.reject(new Error('boundary failure')),
        }),
      },
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error.' })
    expect(errorLog).toHaveBeenCalledWith(
      '[fuma-router] scoped API failed:',
      expect.any(Error),
    )
    errorLog.mockRestore()
  })

  it('does not consult the scoped boundary for non-FUMA requests', async () => {
    const response = await handleServerRequest(
      new Request('http://localhost/health'),
      {
        db: selfHostDb(),
        fumaScopedApi: boundary({
          handles: () => {
            throw new Error('non-FUMA request consulted scoped boundary')
          },
        }),
      },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok' })
  })

  it('preserves self-host CMS routing when no hosted boundary is injected', async () => {
    const response = await handleServerRequest(
      new Request('http://localhost/admin/api/cms/setup/status'),
      { db: selfHostDb() },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ needsSetup: true })

    const scoped = await handleServerRequest(
      new Request(SCOPED_EDITOR_URL),
      { db: noLegacyAccessDb() },
    )
    expect(scoped.status).toBe(404)
    expect(await scoped.json()).toEqual({ error: 'Resource not found.' })
  })

  it('composes editor declarations only from supplied FUMA-026 authorities', async () => {
    const transaction: EditorScopedStorageTransaction = {
      loadScopeAuthorityForUpdate: () => Promise.reject(new Error('unused')),
      get: () => Promise.reject(new Error('unused')),
      list: () => Promise.reject(new Error('unused')),
      put: () => Promise.reject(new Error('unused')),
      delete: () => Promise.reject(new Error('unused')),
      deletePrefix: () => Promise.reject(new Error('unused')),
    }
    const storage: EditorScopedStorage = {
      transaction: <T>(work: (value: EditorScopedStorageTransaction) => Promise<T>) => work(transaction),
    }
    const composed = createFumaEditorScopedApiBoundary({
      boundary: {
        ports: {
          sessions: {
            authenticateSameOriginHostedSession: () => Promise.reject(new Error('unused')),
          },
          authorization: {
            loadExactSiteAuthorization: () => Promise.reject(new Error('unused')),
          },
        },
        ownerKeys: {
          loadOwnerKey: () => Promise.reject(new Error('unused')),
        },
        allowsMutationOrigin: () => false,
      },
      storage,
      sessions: {
        resolveEditorSessionKey: () => Promise.reject(new Error('unused')),
      },
    })

    const response = await composed.handle(new Request(SCOPED_EDITOR_URL, { method: 'PUT' }))
    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({ error: 'Origin not allowed.' })
  })
})
