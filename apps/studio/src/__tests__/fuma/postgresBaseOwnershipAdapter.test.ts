import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import {
  PostgresBaseOwnershipAdapter,
  createBaseOwnershipReceipt,
  type BaseOwnershipOperationInput,
  type TransferManifest,
} from '../../../server/fuma/transfers'

const NOW = '2026-07-25T05:40:35.111Z'

function manifest(): TransferManifest {
  return {
    schemaVersion: 1,
    transferId: 'transfer-adapter',
    source: {
      platformId: 'platform-fuma',
      organizationId: 'organization-source',
      workspaceId: 'workspace-source',
      siteId: 'site-primary',
    },
    destination: {
      platformId: 'platform-fuma',
      organizationId: 'organization-destination',
      workspaceId: 'workspace-destination',
      siteId: 'site-primary',
    },
    siteProfileId: 'website',
    siteCapabilityOverrides: {
      grant: ['publication.editorial'],
      revoke: ['website.analytics'],
    },
    siteCapabilityIds: ['publication.editorial'],
    snapshotChecksum: 'b'.repeat(64),
    resources: ['site-record'],
    collaborators: [
      {
        userId: 'user-editor',
        sourceRole: 'editor',
        intent: 'preserve',
        destinationRole: 'editor',
      },
      {
        userId: 'user-viewer',
        sourceRole: 'viewer',
        intent: 'remove',
        destinationRole: null,
      },
    ],
    capturedAt: NOW,
  }
}

function operation(): BaseOwnershipOperationInput {
  return {
    manifest: manifest(),
    saga: {
      transferId: 'transfer-adapter',
      lockId: 'lock-adapter',
      fence: 11,
    },
  }
}

interface FakeSiteRow {
  organization_id: string
  workspace_id: string
  id: string
  profile_id: string
  capability_overrides_json: unknown
}

interface FakeOwnerKeyRow {
  platform_id: string
  owner_key: string
  organization_id: string
  workspace_id: string
  site_id: string
  state: 'active' | 'transferring'
  generation: number
  transfer_id: string | null
  transfer_lock_id: string | null
  transfer_fence: number | null
}

interface FakeIntentRow {
  id: string
  platform_id: string
  transfer_id: string
  user_id: string
  source_role: string
  intent: string
  destination_role: string | null
  state: string
}

interface FakeState {
  proposalManifest: TransferManifest
  proposalPresent: boolean
  lockId: string
  lockFence: number
  lockActive: boolean
  destinationOrganizationId: string
  destinationWorkspaceId: string
  destinationWorkspaceStatus: 'active' | 'archived'
  sites: FakeSiteRow[]
  ownerKeys: FakeOwnerKeyRow[]
  intents: FakeIntentRow[]
  siteUpdates: number
  ownerKeyUpdates: number
}

function initialState(): FakeState {
  const value = manifest()
  return {
    proposalManifest: structuredClone(value),
    proposalPresent: true,
    lockId: 'lock-adapter',
    lockFence: 11,
    lockActive: true,
    destinationOrganizationId: value.destination.organizationId,
    destinationWorkspaceId: value.destination.workspaceId,
    destinationWorkspaceStatus: 'active',
    sites: [{
      organization_id: value.source.organizationId,
      workspace_id: value.source.workspaceId,
      id: value.source.siteId,
      profile_id: value.siteProfileId,
      capability_overrides_json: structuredClone(value.siteCapabilityOverrides),
    }],
    ownerKeys: [{
      platform_id: value.source.platformId,
      owner_key: 'owner-key-stable',
      organization_id: value.source.organizationId,
      workspace_id: value.source.workspaceId,
      site_id: value.source.siteId,
      state: 'active',
      generation: 3,
      transfer_id: null,
      transfer_lock_id: null,
      transfer_fence: null,
    }],
    intents: [],
    siteUpdates: 0,
    ownerKeyUpdates: 0,
  }
}

function normalizedSql(strings: TemplateStringsArray): string {
  return strings.join('?').replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

class TransactionalDbFake {
  state = initialState()
  failNextSiteUpdate = false
  failNextOwnerKeyUpdate = false
  rejectNextOwnerGeneration = false
  transactionCount = 0
  rollbackCount = 0
  readonly client: DbClient

  constructor() {
    this.client = this.createClient(false)
  }

  private createClient(inTransaction: boolean): DbClient {
    const query = (async <Row = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<DbResult<Row>> => this.execute<Row>(normalizedSql(strings), values)) as DbClient
    query.unsafe = async () => {
      throw new Error('The base ownership adapter must not require unsafe SQL.')
    }
    query.transaction = async <T>(work: (tx: DbClient) => Promise<T>): Promise<T> => {
      if (inTransaction) return await work(query)
      this.transactionCount += 1
      const snapshot = structuredClone(this.state)
      try {
        return await work(this.createClient(true))
      } catch (error) {
        this.state = snapshot
        this.rollbackCount += 1
        throw error
      }
    }
    return Object.assign(query, { dialect: 'postgres' as const })
  }

  private async execute<Row>(sql: string, values: unknown[]): Promise<DbResult<Row>> {
    if (sql.startsWith('select manifest_json from fuma_site_transfer_proposals')) {
      const expected = manifest()
      const exactAncestry = values[0] === expected.source.platformId
        && values[1] === expected.transferId
        && values[2] === expected.source.organizationId
        && values[3] === expected.source.workspaceId
        && values[4] === expected.source.siteId
        && values[5] === expected.destination.organizationId
        && values[6] === expected.destination.workspaceId
        && values[7] === expected.destination.siteId
      const rows = this.state.proposalPresent && exactAncestry
        ? [{ manifest_json: structuredClone(this.state.proposalManifest) }]
        : []
      return { rows: rows as Row[], rowCount: rows.length }
    }
    if (sql.startsWith('select id from fuma_site_transfer_locks')) {
      const expected = manifest().source
      const matches = this.state.lockActive
        && values[0] === expected.platformId
        && values[1] === this.state.lockId
        && values[2] === manifest().transferId
        && values[3] === expected.organizationId
        && values[4] === expected.workspaceId
        && values[5] === expected.siteId
        && values[6] === this.state.lockFence
      const rows = matches ? [{ id: this.state.lockId }] : []
      return { rows: rows as Row[], rowCount: rows.length }
    }
    if (sql.startsWith('select organization_id, id, status from fuma_workspaces')) {
      const matches = values[0] === this.state.destinationOrganizationId
        && values[1] === this.state.destinationWorkspaceId
      const rows = matches ? [{
        organization_id: this.state.destinationOrganizationId,
        id: this.state.destinationWorkspaceId,
        status: this.state.destinationWorkspaceStatus,
      }] : []
      return { rows: rows as Row[], rowCount: rows.length }
    }
    if (sql.startsWith('select organization_id, workspace_id, id, profile_id,')) {
      const rows = this.state.sites
        .filter(({ id }) => id === values[0])
        .map((row) => structuredClone(row))
      return { rows: rows as Row[], rowCount: rows.length }
    }
    if (sql.startsWith('select owner_key, organization_id, workspace_id, site_id, state,')) {
      const rows = this.state.ownerKeys
        .filter(({ platform_id, site_id }) => (
          platform_id === values[0] && site_id === values[1]
        ))
        .toSorted((left, right) => left.owner_key.localeCompare(right.owner_key))
        .map((row) => structuredClone(row))
      return { rows: rows as Row[], rowCount: rows.length }
    }
    if (sql.startsWith('select user_id, source_role, intent, destination_role, state')) {
      const rows = this.state.intents
        .filter(({ platform_id, transfer_id }) => (
          platform_id === values[0] && transfer_id === values[1]
        ))
        .toSorted((left, right) => left.user_id.localeCompare(right.user_id))
        .map(({ user_id, source_role, intent, destination_role, state }) => ({
          user_id,
          source_role,
          intent,
          destination_role,
          state,
        }))
      return { rows: rows as Row[], rowCount: rows.length }
    }
    if (sql.startsWith('insert into fuma_site_transfer_collaborator_intents')) {
      this.state.intents.push({
        platform_id: String(values[0]),
        id: String(values[1]),
        transfer_id: String(values[2]),
        user_id: String(values[3]),
        source_role: String(values[4]),
        intent: String(values[5]),
        destination_role: values[6] === null ? null : String(values[6]),
        state: 'pending',
      })
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('delete from fuma_site_transfer_collaborator_intents')) {
      const before = this.state.intents.length
      this.state.intents = this.state.intents.filter(({ platform_id, transfer_id, state }) => (
        platform_id !== values[0] || transfer_id !== values[1] || state !== 'pending'
      ))
      return { rows: [], rowCount: before - this.state.intents.length }
    }
    if (sql.startsWith('update fuma_tenant_owner_keys')) {
      if (this.failNextOwnerKeyUpdate) {
        this.failNextOwnerKeyUpdate = false
        throw new Error('injected owner-key update fault')
      }
      if (this.rejectNextOwnerGeneration) {
        this.rejectNextOwnerGeneration = false
        return { rows: [], rowCount: 0 }
      }
      const publishing = sql.startsWith(
        "update fuma_tenant_owner_keys set organization_id = ?, workspace_id = ?, state = 'transferring'",
      )
      const owner = publishing
        ? this.state.ownerKeys.find((candidate) => (
          candidate.platform_id === values[5]
          && candidate.owner_key === values[6]
          && candidate.organization_id === values[7]
          && candidate.workspace_id === values[8]
          && candidate.site_id === values[9]
          && candidate.state === 'active'
          && candidate.generation === values[10]
          && candidate.transfer_id === null
          && candidate.transfer_lock_id === null
          && candidate.transfer_fence === null
        ))
        : this.state.ownerKeys.find((candidate) => (
          candidate.platform_id === values[2]
          && candidate.owner_key === values[3]
          && candidate.organization_id === values[4]
          && candidate.workspace_id === values[5]
          && candidate.site_id === values[6]
          && candidate.state === 'transferring'
          && candidate.transfer_id === values[7]
          && candidate.transfer_lock_id === values[8]
          && candidate.transfer_fence === values[9]
          && candidate.generation === values[10]
        ))
      if (!owner) return { rows: [], rowCount: 0 }
      owner.organization_id = String(values[0])
      owner.workspace_id = String(values[1])
      owner.generation += 1
      owner.state = publishing ? 'transferring' : 'active'
      owner.transfer_id = publishing ? String(values[2]) : null
      owner.transfer_lock_id = publishing ? String(values[3]) : null
      owner.transfer_fence = publishing ? Number(values[4]) : null
      this.state.ownerKeyUpdates += 1
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('update fuma_sites set organization_id')) {
      if (this.failNextSiteUpdate) {
        this.failNextSiteUpdate = false
        throw new Error('injected site update fault')
      }
      const site = this.state.sites.find((candidate) => (
        candidate.organization_id === values[2]
        && candidate.workspace_id === values[3]
        && candidate.id === values[4]
        && candidate.profile_id === values[5]
      ))
      if (!site) return { rows: [], rowCount: 0 }
      site.organization_id = String(values[0])
      site.workspace_id = String(values[1])
      this.state.siteUpdates += 1
      return { rows: [], rowCount: 1 }
    }
    throw new Error(`Unexpected adapter SQL: ${sql}`)
  }
}

describe('PostgresBaseOwnershipAdapter', () => {
  it('requires PostgreSQL and exposes no independent content or object API', () => {
    const fake = new TransactionalDbFake()
    const sqlite = Object.assign(fake.client, { dialect: 'sqlite' as const })

    expect(() => new PostgresBaseOwnershipAdapter(sqlite)).toThrow('PostgreSQL authority')
    expect(Object.getOwnPropertyNames(PostgresBaseOwnershipAdapter.prototype)).toEqual([
      'constructor',
      'inspectBaseOwnership',
      'publishBaseOwnership',
      'restoreBaseOwnership',
    ])
  })

  it('rolls back owner key and pending intent when site authority faults', async () => {
    const fake = new TransactionalDbFake()
    const adapter = new PostgresBaseOwnershipAdapter(fake.client)
    fake.failNextSiteUpdate = true

    await expect(adapter.publishBaseOwnership(operation()))
      .rejects.toThrow('injected site update fault')
    expect(fake.rollbackCount).toBe(1)
    expect(fake.state.sites[0]).toMatchObject({
      organization_id: manifest().source.organizationId,
      workspace_id: manifest().source.workspaceId,
    })
    expect(fake.state.ownerKeys[0]).toMatchObject({
      owner_key: 'owner-key-stable',
      organization_id: manifest().source.organizationId,
      workspace_id: manifest().source.workspaceId,
      state: 'active',
      generation: 3,
      transfer_id: null,
    })
    expect(fake.state.intents).toEqual([])

    const applied = await adapter.publishBaseOwnership(operation())
    expect(applied.status).toBe('applied')
    expect(applied.inspection.sites[0]?.coordinate).toEqual(manifest().destination)
    expect(applied.inspection.collaboratorIntents).toHaveLength(2)
    expect(fake.state.ownerKeys[0]).toMatchObject({
      owner_key: 'owner-key-stable',
      organization_id: manifest().destination.organizationId,
      workspace_id: manifest().destination.workspaceId,
      state: 'transferring',
      generation: 4,
      transfer_id: operation().saga.transferId,
      transfer_lock_id: operation().saga.lockId,
      transfer_fence: operation().saga.fence,
    })
  })

  it('rolls back intent before owner-key mutation and rejects a stale generation CAS', async () => {
    const faulted = new TransactionalDbFake()
    faulted.failNextOwnerKeyUpdate = true
    await expect(new PostgresBaseOwnershipAdapter(faulted.client)
      .publishBaseOwnership(operation()))
      .rejects.toThrow('injected owner-key update fault')
    expect(faulted.state.intents).toEqual([])
    expect(faulted.state.siteUpdates).toBe(0)

    const stale = new TransactionalDbFake()
    stale.rejectNextOwnerGeneration = true
    await expect(new PostgresBaseOwnershipAdapter(stale.client)
      .publishBaseOwnership(operation()))
      .rejects.toThrow('lost its owner-key generation')
    expect(stale.state).toEqual(initialState())
  })

  it('rolls back owner-key restore and intent discard when site restore faults', async () => {
    const fake = new TransactionalDbFake()
    const adapter = new PostgresBaseOwnershipAdapter(fake.client)
    await expect(adapter.publishBaseOwnership(operation())).resolves.toMatchObject({
      status: 'applied',
    })
    const destinationSnapshot = structuredClone(fake.state)
    fake.failNextSiteUpdate = true

    await expect(adapter.restoreBaseOwnership(operation()))
      .rejects.toThrow('injected site update fault')
    expect(fake.rollbackCount).toBe(1)
    expect(fake.state).toEqual(destinationSnapshot)

    const restored = await adapter.restoreBaseOwnership(operation())
    expect(restored.status).toBe('compensated')
    expect(restored.inspection.sites[0]?.coordinate).toEqual(manifest().source)
    expect(restored.inspection.collaboratorIntents).toEqual([])
    expect(fake.state.ownerKeys[0]).toMatchObject({
      owner_key: 'owner-key-stable',
      organization_id: manifest().source.organizationId,
      workspace_id: manifest().source.workspaceId,
      state: 'active',
      generation: 5,
      transfer_id: null,
      transfer_lock_id: null,
      transfer_fence: null,
    })
  })

  it('derives receipt from the exact owner-key fence and replays without another effect', async () => {
    const fake = new TransactionalDbFake()
    const adapter = new PostgresBaseOwnershipAdapter(fake.client)
    const first = await adapter.publishBaseOwnership(operation())
    const replay = await adapter.publishBaseOwnership(operation())

    expect(first.inspection.sites[0]?.ownershipReceipt).toEqual(
      createBaseOwnershipReceipt(operation().manifest, operation().saga),
    )
    expect(replay.status).toBe('replayed')
    expect(replay.inspection.sites[0]?.ownershipReceipt)
      .toEqual(first.inspection.sites[0]?.ownershipReceipt)
    expect(fake.state.siteUpdates).toBe(1)
    expect(fake.state.ownerKeyUpdates).toBe(1)
  })

  it('rejects stale lock and owner-key fences, ancestry drift, snapshot drift, and collisions', async () => {
    const staleFake = new TransactionalDbFake()
    staleFake.state.lockFence = 12
    await expect(new PostgresBaseOwnershipAdapter(staleFake.client)
      .publishBaseOwnership(operation()))
      .resolves.toMatchObject({ status: 'stale-fence' })

    const ownerFenceFake = new TransactionalDbFake()
    const ownerFenceAdapter = new PostgresBaseOwnershipAdapter(ownerFenceFake.client)
    await ownerFenceAdapter.publishBaseOwnership(operation())
    ownerFenceFake.state.ownerKeys[0]!.transfer_fence = 12
    await expect(ownerFenceAdapter.publishBaseOwnership(operation()))
      .resolves.toMatchObject({ status: 'stale-fence' })

    const ancestryFake = new TransactionalDbFake()
    ancestryFake.state.proposalManifest = {
      ...ancestryFake.state.proposalManifest,
      destination: {
        ...ancestryFake.state.proposalManifest.destination,
        workspaceId: 'workspace-other',
      },
    }
    await expect(new PostgresBaseOwnershipAdapter(ancestryFake.client)
      .publishBaseOwnership(operation()))
      .resolves.toMatchObject({ status: 'ancestry-conflict' })

    const missingOwnerFake = new TransactionalDbFake()
    missingOwnerFake.state.ownerKeys = []
    await expect(new PostgresBaseOwnershipAdapter(missingOwnerFake.client)
      .publishBaseOwnership(operation()))
      .resolves.toMatchObject({ status: 'ownership-conflict' })

    const profileFake = new TransactionalDbFake()
    profileFake.state.sites[0]!.profile_id = 'publication'
    await expect(new PostgresBaseOwnershipAdapter(profileFake.client)
      .publishBaseOwnership(operation()))
      .resolves.toMatchObject({ status: 'ownership-conflict' })

    const overridesFake = new TransactionalDbFake()
    overridesFake.state.sites[0]!.capability_overrides_json = { grant: [], revoke: [] }
    await expect(new PostgresBaseOwnershipAdapter(overridesFake.client)
      .publishBaseOwnership(operation()))
      .resolves.toMatchObject({ status: 'ownership-conflict' })

    const collisionFake = new TransactionalDbFake()
    collisionFake.state.sites.push({
      ...structuredClone(collisionFake.state.sites[0]!),
      organization_id: manifest().destination.organizationId,
      workspace_id: manifest().destination.workspaceId,
    })
    collisionFake.state.ownerKeys.push({
      ...structuredClone(collisionFake.state.ownerKeys[0]!),
      owner_key: 'owner-key-collision',
      organization_id: manifest().destination.organizationId,
      workspace_id: manifest().destination.workspaceId,
    })
    const collision = await new PostgresBaseOwnershipAdapter(collisionFake.client)
      .publishBaseOwnership(operation())
    expect(collision.status).toBe('ownership-conflict')
    expect(collision.inspection.sites).toHaveLength(2)
    expect(collisionFake.state.intents).toEqual([])
  })

  it('rejects intent drift without changing destination ownership or owner key', async () => {
    const fake = new TransactionalDbFake()
    const adapter = new PostgresBaseOwnershipAdapter(fake.client)
    await adapter.publishBaseOwnership(operation())
    fake.state.intents[0]!.destination_role = 'viewer'
    const snapshot = structuredClone(fake.state)

    await expect(adapter.restoreBaseOwnership(operation()))
      .resolves.toMatchObject({ status: 'intent-conflict' })
    expect(fake.state).toEqual(snapshot)
  })
})
