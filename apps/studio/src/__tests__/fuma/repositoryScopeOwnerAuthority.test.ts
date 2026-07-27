import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import { freezeFumaRequestContext } from '../../../server/fuma/context'
import { PostgresFumaRepositoryScopeOwnerKeyAuthority } from '../../../server/fuma/tenancy/ownerKeyAuthority'
import {
  FumaRepositoryScopeResolutionError,
  deriveFumaRepositoryScope,
  type FumaRepositoryScopeCoordinate,
} from '../../../server/fuma/tenancy/repositoryScope'

const COORDINATE: FumaRepositoryScopeCoordinate = {
  platformId: 'platform-fuma',
  organizationId: 'organization-a',
  workspaceId: 'workspace-collision',
  siteId: 'site-collision',
}

interface OwnerKeyRowFixture {
  platform_id: string
  owner_key: string
  organization_id: string
  workspace_id: string
  site_id: string
  state: string
  generation: string | number | bigint
  transfer_id: string | null
  transfer_lock_id: string | null
  transfer_fence: string | number | bigint | null
  created_at: string | Date
  updated_at: string | Date
}

type CapturedCall = Readonly<{
  sql: string
  parameters: readonly unknown[]
}>

function row(changes: Partial<OwnerKeyRowFixture> = {}): OwnerKeyRowFixture {
  return {
    platform_id: COORDINATE.platformId,
    owner_key: 'owner-stable-01',
    organization_id: COORDINATE.organizationId,
    workspace_id: COORDINATE.workspaceId,
    site_id: COORDINATE.siteId,
    state: 'active',
    generation: '4',
    transfer_id: null,
    transfer_lock_id: null,
    transfer_fence: null,
    created_at: new Date('2026-07-25T12:00:00.000Z'),
    updated_at: new Date('2026-07-25T12:05:00.000Z'),
    ...changes,
  }
}

function recordingDb(rows: OwnerKeyRowFixture[] = []): Readonly<{
  db: DbClient
  calls: CapturedCall[]
}> {
  const calls: CapturedCall[] = []
  const db = (async <ResultRow = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<ResultRow>> => {
    calls.push({ sql: strings.join('?'), parameters: structuredClone(values) })
    const resultRows = structuredClone(rows) as unknown as ResultRow[]
    return { rows: resultRows, rowCount: resultRows.length }
  }) as DbClient
  db.unsafe = async () => {
    throw new Error('Owner-key authority must not require unsafe SQL.')
  }
  db.transaction = async <T>(work: (tx: DbClient) => Promise<T>): Promise<T> => (
    await work(db)
  )
  Object.defineProperty(db, 'dialect', { configurable: true, value: 'postgres' })
  return { db, calls }
}

function sqliteDb(): DbClient {
  const { db } = recordingDb()
  Object.defineProperty(db, 'dialect', { value: 'sqlite' })
  return db
}

function normalized(sql: string): string {
  return sql.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

function trustedContext() {
  return freezeFumaRequestContext({
    requestId: 'request-owner-authority',
    source: {
      kind: 'staff-session',
      correlationId: 'correlation-owner-authority',
      userId: 'staff-01',
      sessionId: 'session-01',
      impersonatedBy: null,
    },
    actor: {
      kind: 'staff',
      userId: 'staff-01',
      sessionId: 'session-01',
      impersonator: null,
    },
    scope: {
      platform: { id: COORDINATE.platformId, status: 'active' },
      organization: {
        id: COORDINATE.organizationId,
        platformId: COORDINATE.platformId,
        status: 'active',
      },
      workspace: {
        id: COORDINATE.workspaceId,
        platformId: COORDINATE.platformId,
        organizationId: COORDINATE.organizationId,
        status: 'active',
      },
      site: {
        id: COORDINATE.siteId,
        platformId: COORDINATE.platformId,
        organizationId: COORDINATE.organizationId,
        workspaceId: COORDINATE.workspaceId,
        profileId: 'website',
        status: 'active',
      },
    },
    profile: { id: 'website', status: 'active' },
    capabilities: ['site.home'],
    permissions: {
      subjectId: 'staff-01',
      allow: ['site.home.read'],
      deny: [],
    },
  })
}

describe('PostgresFumaRepositoryScopeOwnerKeyAuthority', () => {
  it('requires PostgreSQL and exposes only owner-key loading', () => {
    expect(() => new PostgresFumaRepositoryScopeOwnerKeyAuthority(sqliteDb()))
      .toThrow('Fuma repository scope owner keys require PostgreSQL authority.')
    expect(Object.getOwnPropertyNames(
      PostgresFumaRepositoryScopeOwnerKeyAuthority.prototype,
    )).toEqual(['constructor', 'loadOwnerKey'])
  })

  it('queries by every coordinate and maps the exact owner-key record', async () => {
    const capture = recordingDb([row()])
    const authority = new PostgresFumaRepositoryScopeOwnerKeyAuthority(capture.db)

    const record = await authority.loadOwnerKey(COORDINATE)

    expect(record).toEqual({
      ownerKey: 'owner-stable-01',
      coordinate: COORDINATE,
      state: 'active',
      generation: 4,
      transferId: null,
      transferLockId: null,
      transferFence: null,
      createdAt: '2026-07-25T12:00:00.000Z',
      updatedAt: '2026-07-25T12:05:00.000Z',
    })
    expect(Object.keys(record!)).toEqual([
      'ownerKey',
      'coordinate',
      'state',
      'generation',
      'transferId',
      'transferLockId',
      'transferFence',
      'createdAt',
      'updatedAt',
    ])
    expect(capture.calls).toHaveLength(1)
    const call = capture.calls[0]!
    expect(normalized(call.sql)).toContain(
      'select platform_id, owner_key, organization_id, workspace_id, site_id, state, generation, transfer_id, transfer_lock_id, transfer_fence, created_at, updated_at from fuma_tenant_owner_keys',
    )
    expect(normalized(call.sql)).toContain(
      'where platform_id = ? and organization_id = ? and workspace_id = ? and site_id = ?',
    )
    expect(call.parameters).toEqual([
      COORDINATE.platformId,
      COORDINATE.organizationId,
      COORDINATE.workspaceId,
      COORDINATE.siteId,
    ])
  })

  it('returns null when no complete-coordinate owner record exists', async () => {
    const authority = new PostgresFumaRepositoryScopeOwnerKeyAuthority(recordingDb().db)

    expect(await authority.loadOwnerKey(COORDINATE)).toBeNull()
  })

  it('maps PostgreSQL bigint representations without losing precision', async () => {
    const authority = new PostgresFumaRepositoryScopeOwnerKeyAuthority(recordingDb([row({
      state: 'transferring',
      generation: 9n,
      transfer_id: 'transfer-01',
      transfer_lock_id: 'lock-01',
      transfer_fence: '12',
    })]).db)

    expect(await authority.loadOwnerKey(COORDINATE)).toMatchObject({
      state: 'transferring',
      generation: 9,
      transferId: 'transfer-01',
      transferLockId: 'lock-01',
      transferFence: 12,
    })

    const unsafeAuthority = new PostgresFumaRepositoryScopeOwnerKeyAuthority(recordingDb([row({
      generation: '9007199254740992',
    })]).db)
    await expect(unsafeAuthority.loadOwnerKey(COORDINATE))
      .rejects.toThrow('Stored tenant owner-key generation is invalid.')
  })

  it('leaves owner-state invariant validation at repository-scope derivation', async () => {
    const authority = new PostgresFumaRepositoryScopeOwnerKeyAuthority(recordingDb([row({
      transfer_id: 'unexpected-transfer',
    })]).db)

    await expect(deriveFumaRepositoryScope({
      trustedContext: { kind: 'request', context: trustedContext() },
      ownerKeys: authority,
    })).rejects.toBeInstanceOf(FumaRepositoryScopeResolutionError)
  })
})
