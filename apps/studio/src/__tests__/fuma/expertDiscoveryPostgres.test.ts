import type { DbClient, DbResult } from '../../../server/db/client'
import { PostgresExpertDiscoveryRepository, type ExpertProfileRecord } from '../../../server/fuma/expertDiscovery'

const hash = 'a'.repeat(64)
const timestamp = '2026-07-30T15:00:00.000Z'
const profile: ExpertProfileRecord = {
  expertId: 'expert-a',
  organizationId: 'org-a',
  sourceScope: { platformId: 'platform', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 1 },
  supportedProfiles: ['website', 'publication'],
  public: {
    id: 'expert_public_a', slug: 'expert-a', publicName: 'Expert A', summary: 'Accessible Fuma sites for Kenyan teams.',
    expertType: 'developer', location: 'Nairobi', skills: ['fuma'], services: ['design'], showcaseIds: [],
    mediatedInquiryAvailable: true, imageUrl: null, approvedAt: timestamp,
  },
  availability: 'available', approvedReleaseId: 'release-a', optedIn: false,
  consentVersion: 2, publicRevision: 1, createdAt: timestamp, updatedAt: timestamp,
}

function scriptedDb(results: readonly DbResult[]): Readonly<{ db: DbClient; rolledBack: () => boolean; calls: () => number }> {
  let index = 0
  let didRollback = false
  const query = async (): Promise<DbResult> => {
    const result = results[index]
    index += 1
    if (!result) throw new Error(`Unexpected query ${index}`)
    return result
  }
  const db = Object.assign(query, {
    dialect: 'postgres' as const,
    unsafe: async () => await query(),
    transaction: async <T>(work: (tx: DbClient) => Promise<T>): Promise<T> => {
      try { return await work(db) } catch (error) { didRollback = true; throw error }
    },
  }) as DbClient
  return { db, rolledBack: () => didRollback, calls: () => index }
}

describe('FUMA-073 PostgreSQL serialization', () => {
  it('rolls back release and consent rows when the profile identity conflicts', async () => {
    const scripted = scriptedDb([
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [{ duplicate: false }], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ])
    const repository = new PostgresExpertDiscoveryRepository(scripted.db)
    expect(await repository.approve({
      profile,
      artifactObjectKey: 'experts/releases/release-a.json',
      artifactHashSha256: hash,
      submittedByActorId: 'submitter-a',
      approvedByActorId: 'reviewer-a',
      expertConsent: { actorId: 'expert-owner-a', version: 2, consentedAt: timestamp },
      siteOwnerConsent: { actorId: 'site-owner-a', version: 3, consentedAt: timestamp },
    })).toBe(false)
    expect(scripted.calls()).toBe(7)
    expect(scripted.rolledBack()).toBe(true)
  })

  it('rolls back a plugin link when the paired public revision update loses its fence', async () => {
    const scripted = scriptedDb([
      { rows: [{ profile_json: { domain: profile } }], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ])
    const repository = new PostgresExpertDiscoveryRepository(scripted.db)
    expect(await repository.putPluginLink({
      expertId: 'expert-a', pluginId: 'plugin-a', publisherOrganizationId: 'publisher-a',
      verificationHashSha256: hash, verifiedAt: timestamp, revokedAt: null,
    }, 1)).toBe(false)
    expect(scripted.calls()).toBe(3)
    expect(scripted.rolledBack()).toBe(true)
  })
})
