import { describe, expect, it } from 'bun:test'
import {
  OrganizationBootstrapError,
  OrganizationBootstrapService,
  PLATFORM_ORGANIZATION_BOOTSTRAP_KEY,
  PLATFORM_ORGANIZATION_ID,
  PLATFORM_ORGANIZATION_LAUNCH_LIMITS,
  PLATFORM_ORGANIZATION_PLACEMENT_KEY,
  PLATFORM_OWNER_MEMBERSHIP_ID,
  type OrganizationBootstrapReceiptRecord,
  type OrganizationBootstrapRepository,
  type OrganizationBootstrapTransaction,
  type OrganizationBootstrapUser,
  type OrganizationLimitsRecord,
  type OrganizationMembershipRecord,
  type OrganizationPlacementRecord,
  type OrganizationProfileRecord,
  type OrganizationRecord,
} from '../../../server/fuma/organizations'

interface StoredUser extends OrganizationBootstrapUser {
  name: string
  passwordHash: string
  banReason: string | null
}

interface MemoryState {
  users: StoredUser[]
  organizations: Map<string, OrganizationRecord>
  memberships: Map<string, OrganizationMembershipRecord>
  profiles: Map<string, OrganizationProfileRecord>
  limits: Map<string, OrganizationLimitsRecord>
  placements: Map<string, OrganizationPlacementRecord>
  receipts: Map<string, OrganizationBootstrapReceiptRecord>
}

function emptyState(users: StoredUser[]): MemoryState {
  return {
    users,
    organizations: new Map(),
    memberships: new Map(),
    profiles: new Map(),
    limits: new Map(),
    placements: new Map(),
    receipts: new Map(),
  }
}

class InMemoryOrganizationBootstrapRepository
implements OrganizationBootstrapRepository, OrganizationBootstrapTransaction {
  state: MemoryState
  transactionCount = 0
  lockCount = 0

  constructor(users: StoredUser[]) {
    this.state = emptyState(users)
  }

  async transaction<T>(work: (tx: OrganizationBootstrapTransaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1
    const snapshot = structuredClone(this.state)
    try {
      return await work(this)
    } catch (error) {
      this.state = snapshot
      throw error
    }
  }

  acquireBootstrapLock(): Promise<void> {
    this.lockCount += 1
    return Promise.resolve()
  }

  findUsersByNormalizedEmail(normalizedEmail: string): Promise<readonly OrganizationBootstrapUser[]> {
    return Promise.resolve(this.state.users.filter(({ email }) => email.trim().toLowerCase() === normalizedEmail))
  }

  enforceProtectedAdmin(userId: string): Promise<void> {
    const user = this.state.users.find(({ id }) => id === userId)
    if (!user) throw new Error('owner disappeared')
    user.role = 'admin'
    user.banned = false
    user.banReason = null
    return Promise.resolve()
  }

  findPlatformOrganizations(id: string, slug: string): Promise<readonly OrganizationRecord[]> {
    return Promise.resolve([...this.state.organizations.values()].filter((row) => row.id === id || row.slug === slug))
  }

  insertOrganization(record: OrganizationRecord): Promise<void> {
    this.state.organizations.set(record.id, structuredClone(record))
    return Promise.resolve()
  }

  findPlatformMemberships(
    id: string,
    organizationId: string,
    userId: string,
  ): Promise<readonly OrganizationMembershipRecord[]> {
    return Promise.resolve([...this.state.memberships.values()].filter((row) => (
      row.id === id || (row.organizationId === organizationId && row.userId === userId)
    )))
  }

  insertMembership(record: OrganizationMembershipRecord): Promise<void> {
    this.state.memberships.set(record.id, structuredClone(record))
    return Promise.resolve()
  }

  findOrganizationProfile(organizationId: string): Promise<OrganizationProfileRecord | null> {
    return Promise.resolve(this.state.profiles.get(organizationId) ?? null)
  }

  insertOrganizationProfile(record: OrganizationProfileRecord): Promise<void> {
    this.state.profiles.set(record.organizationId, structuredClone(record))
    return Promise.resolve()
  }

  findOrganizationLimits(organizationId: string): Promise<OrganizationLimitsRecord | null> {
    return Promise.resolve(this.state.limits.get(organizationId) ?? null)
  }

  insertOrganizationLimits(record: OrganizationLimitsRecord): Promise<void> {
    this.state.limits.set(record.organizationId, structuredClone(record))
    return Promise.resolve()
  }

  findOrganizationPlacement(organizationId: string): Promise<OrganizationPlacementRecord | null> {
    return Promise.resolve(this.state.placements.get(organizationId) ?? null)
  }

  insertOrganizationPlacement(record: OrganizationPlacementRecord): Promise<void> {
    this.state.placements.set(record.organizationId, structuredClone(record))
    return Promise.resolve()
  }

  findBootstrapReceipts(
    bootstrapKey: string,
    organizationId: string,
  ): Promise<readonly OrganizationBootstrapReceiptRecord[]> {
    return Promise.resolve([...this.state.receipts.values()].filter((record) => (
      record.bootstrapKey === bootstrapKey || record.organizationId === organizationId
    )))
  }

  insertBootstrapReceipt(record: OrganizationBootstrapReceiptRecord): Promise<void> {
    this.state.receipts.set(record.bootstrapKey, structuredClone(record))
    return Promise.resolve()
  }
}

function owner(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: 'user-protected-owner',
    name: 'Protected Owner',
    email: '  Owner@Fuma.Co.Ke ',
    passwordHash: 'preserved-argon2id-hash',
    role: 'member',
    banned: true,
    banReason: 'must be cleared by bootstrap',
    ...overrides,
  }
}

function service(repository: InMemoryOrganizationBootstrapRepository): OrganizationBootstrapService {
  return new OrganizationBootstrapService({
    repository,
    now: () => new Date('2026-07-24T17:20:09.425Z'),
  })
}

function expectBootstrapError(code: OrganizationBootstrapError['code']) {
  return expect.objectContaining({ name: 'OrganizationBootstrapError', code })
}

describe('FUMA-014 organization bootstrap', () => {
  it('bootstraps twice with stable IDs, one row per concern, and preserved owner identity and password', async () => {
    const repository = new InMemoryOrganizationBootstrapRepository([owner()])
    const bootstrap = service(repository)

    const first = await bootstrap.bootstrap({ protectedOwnerEmail: ' OWNER@fuma.co.ke ' })
    const second = await bootstrap.bootstrap({ protectedOwnerEmail: 'owner@fuma.co.ke' })

    expect(second).toEqual(first)
    expect(first).toEqual({
      ownerUserId: 'user-protected-owner',
      organizationId: PLATFORM_ORGANIZATION_ID,
      membershipId: PLATFORM_OWNER_MEMBERSHIP_ID,
      bootstrapKey: PLATFORM_ORGANIZATION_BOOTSTRAP_KEY,
      placementClass: 'shared',
      placementKey: PLATFORM_ORGANIZATION_PLACEMENT_KEY,
      limits: PLATFORM_ORGANIZATION_LAUNCH_LIMITS,
    })
    expect(repository.transactionCount).toBe(2)
    expect(repository.lockCount).toBe(2)
    expect(repository.state.organizations.size).toBe(1)
    expect(repository.state.memberships.size).toBe(1)
    expect(repository.state.profiles.size).toBe(1)
    expect(repository.state.limits.size).toBe(1)
    expect(repository.state.placements.size).toBe(1)
    expect(repository.state.receipts.size).toBe(1)

    const protectedOwner = repository.state.users[0]
    expect(protectedOwner).toMatchObject({
      id: 'user-protected-owner',
      name: 'Protected Owner',
      email: '  Owner@Fuma.Co.Ke ',
      passwordHash: 'preserved-argon2id-hash',
      role: 'admin',
      banned: false,
      banReason: null,
    })
    expect(repository.state.memberships.get(PLATFORM_OWNER_MEMBERSHIP_ID)?.role).toBe('owner')
    expect(repository.state.placements.get(PLATFORM_ORGANIZATION_ID)).toEqual({
      organizationId: PLATFORM_ORGANIZATION_ID,
      placementClass: 'shared',
      placementKey: 'shared:launch',
    })
    for (const value of Object.values(first.limits)) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }

    process.stdout.write(
      `[FUMA-014 demo] first=${first.organizationId}/${first.ownerUserId} second=${second.organizationId}/${second.ownerUserId} rows=1 placement=${second.placementKey}\n`,
    )
  })

  it('fails closed when the normalized protected-owner email is absent or ambiguous', async () => {
    const missing = new InMemoryOrganizationBootstrapRepository([])
    await expect(service(missing).bootstrap({ protectedOwnerEmail: 'owner@fuma.co.ke' }))
      .rejects.toEqual(expectBootstrapError('owner-missing'))
    expect(missing.state.organizations.size).toBe(0)

    const ambiguous = new InMemoryOrganizationBootstrapRepository([
      owner({ id: 'owner-a' }),
      owner({ id: 'owner-b', email: 'owner@FUMA.CO.KE' }),
    ])
    await expect(service(ambiguous).bootstrap({ protectedOwnerEmail: ' owner@fuma.co.ke ' }))
      .rejects.toEqual(expectBootstrapError('owner-ambiguous'))
    expect(ambiguous.state.organizations.size).toBe(0)
  })

  it('rolls back protected-admin enforcement when fixed platform identity conflicts', async () => {
    const initialOwner = owner()
    const repository = new InMemoryOrganizationBootstrapRepository([initialOwner])
    repository.state.organizations.set(PLATFORM_ORGANIZATION_ID, {
      id: PLATFORM_ORGANIZATION_ID,
      name: 'Conflicting Organization',
      slug: 'fuma-platform',
    })

    await expect(service(repository).bootstrap({ protectedOwnerEmail: 'owner@fuma.co.ke' }))
      .rejects.toEqual(expectBootstrapError('platform-conflict'))
    expect(repository.state.users[0]).toEqual(initialOwner)
    expect(repository.state.memberships.size).toBe(0)
    expect(repository.state.receipts.size).toBe(0)
  })

  it('rejects conflicting owner membership, finite limits, shared placement, and receipt data', async () => {
    const cases: Array<(repository: InMemoryOrganizationBootstrapRepository) => void> = [
      (repository) => repository.state.memberships.set(PLATFORM_OWNER_MEMBERSHIP_ID, {
        id: PLATFORM_OWNER_MEMBERSHIP_ID,
        organizationId: PLATFORM_ORGANIZATION_ID,
        userId: 'different-user',
        role: 'owner',
      }),
      (repository) => repository.state.limits.set(PLATFORM_ORGANIZATION_ID, {
        organizationId: PLATFORM_ORGANIZATION_ID,
        maxWorkspaces: 0,
        maxSites: 10,
        maxStaff: 25,
      }),
      (repository) => repository.state.placements.set(PLATFORM_ORGANIZATION_ID, {
        organizationId: PLATFORM_ORGANIZATION_ID,
        placementClass: 'dedicated',
        placementKey: 'customer-isolated',
      }),
      (repository) => repository.state.receipts.set('conflicting-bootstrap-key', {
        bootstrapKey: 'conflicting-bootstrap-key',
        organizationId: PLATFORM_ORGANIZATION_ID,
        ownerUserId: 'different-user',
      }),
    ]

    for (const arrangeConflict of cases) {
      const repository = new InMemoryOrganizationBootstrapRepository([owner()])
      arrangeConflict(repository)
      await expect(service(repository).bootstrap({ protectedOwnerEmail: 'owner@fuma.co.ke' }))
        .rejects.toEqual(expectBootstrapError('platform-conflict'))
      expect(repository.state.receipts.size).toBeLessThanOrEqual(1)
    }
  })

  it('exposes no tenant infrastructure allocation or request hook', async () => {
    const productionFiles = [
      'contracts.ts',
      'repository.ts',
      'bootstrap.ts',
      'index.ts',
    ]
    const source = (await Promise.all(productionFiles.map(async (file) => (
      await Bun.file(new URL(`../../../server/fuma/organizations/${file}`, import.meta.url)).text()
    )))).join('\n')

    expect(source).not.toMatch(/(?:allocate|provision|request)\w*[^\n]*(?:database|redis|minio|edge|web|worker|scheduler)/i)
    expect(Object.getOwnPropertyNames(InMemoryOrganizationBootstrapRepository.prototype)).not.toEqual(
      expect.arrayContaining(['allocateDatabase', 'requestRedis', 'provisionMinio', 'allocateWorker']),
    )
  })
})
