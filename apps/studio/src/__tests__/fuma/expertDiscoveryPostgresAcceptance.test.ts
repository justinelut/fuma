import { createPostgresClient } from '../../../server/db/postgres'
import { operationsExpertsTransferMigration } from '../../../server/fuma/db/migrations/000037_operations_experts_transfer'
import {
  PostgresExpertDiscoveryRepository,
  type ExpertProfileRecord,
} from '../../../server/fuma/expertDiscovery'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const timestamp = '2026-07-31T05:56:14.754Z'
const hash = 'a'.repeat(64)

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

function profile(index: number, publicId: string, slug: string): ExpertProfileRecord {
  return {
    expertId: `expert-pg-${index}`,
    organizationId: 'organization-pg',
    sourceScope: {
      platformId: 'platform-pg',
      organizationId: 'organization-pg',
      workspaceId: 'workspace-pg',
      siteId: 'site-pg',
      ownerKey: 'owner-pg',
      ownerGeneration: 3,
    },
    supportedProfiles: ['website', 'publication'],
    public: {
      id: publicId,
      slug,
      publicName: `Expert ${index}`,
      summary: 'Native PostgreSQL expert discovery acceptance profile.',
      expertType: 'developer',
      location: 'Nairobi',
      skills: ['fuma'],
      services: ['implementation'],
      showcaseIds: [],
      mediatedInquiryAvailable: true,
      imageUrl: null,
      approvedAt: timestamp,
    },
    availability: 'available',
    approvedReleaseId: `release-pg-${index}`,
    optedIn: false,
    consentVersion: 2,
    publicRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function approval(value: ExpertProfileRecord): Parameters<PostgresExpertDiscoveryRepository['approve']>[0] {
  return {
    profile: value,
    artifactObjectKey: `experts/releases/${value.approvedReleaseId}.json`,
    artifactHashSha256: hash,
    submittedByActorId: 'submitter-pg',
    approvedByActorId: 'reviewer-pg',
    expertConsent: { actorId: 'expert-owner-pg', version: 2, consentedAt: timestamp },
    siteOwnerConsent: { actorId: 'site-owner-pg', version: 3, consentedAt: timestamp },
  }
}

describe('FUMA-073 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('serializes public IDs, slugs, revisions, plugin links, and inquiry identities on 000037', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_experts_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(operationsExpertsTransferMigration.sql)
      const repository = new PostgresExpertDiscoveryRepository(db)

      const sameId = await Promise.all(Array.from({ length: 8 }, (_, index) => (
        repository.approve(approval(profile(index, 'public-shared-id', `expert-shared-id-${index}`)))
      )))
      expect(sameId.filter(Boolean)).toHaveLength(1)

      const sameSlug = await Promise.all(Array.from({ length: 8 }, (_, offset) => {
        const index = offset + 20
        return repository.approve(approval(profile(index, `public-shared-slug-${index}`, 'expert-shared-slug')))
      }))
      expect(sameSlug.filter(Boolean)).toHaveLength(1)

      const candidates = await repository.listCandidates()
      expect(candidates).toHaveLength(2)
      const selected = candidates.find((item) => item.public.id === 'public-shared-id')
      expect(selected).toBeDefined()
      if (!selected) throw new Error('Serialized expert winner is unavailable.')

      const visible = { ...selected, optedIn: true, publicRevision: 2, updatedAt: '2026-07-31T05:57:14.754Z' }
      expect(await repository.replace(visible, 1)).toBe(true)
      expect(await repository.replace({ ...visible, publicRevision: 3 }, 1)).toBe(false)

      const links = await Promise.all(Array.from({ length: 8 }, (_, index) => repository.putPluginLink({
        expertId: selected.expertId,
        pluginId: `plugin-pg-${index}`,
        publisherOrganizationId: 'publisher-pg',
        verificationHashSha256: hash,
        verifiedAt: '2026-07-31T05:58:14.754Z',
        revokedAt: null,
      }, 2)))
      expect(links.filter(Boolean)).toHaveLength(1)

      const receipt = {
        inquiryId: 'inquiry-pg',
        expertId: selected.expertId,
        sourceProfile: 'website' as const,
        state: 'queued' as const,
        messageBytes: 48,
        encryptedObjectKey: 'experts/inquiries/inquiry-pg.json',
        consentVersion: selected.consentVersion,
        createdAt: '2026-07-31T05:59:14.754Z',
        expiresAt: '2026-08-07T05:59:14.754Z',
      }
      const inquiries = await Promise.all(Array.from({ length: 8 }, () => repository.putInquiry(receipt, hash)))
      expect(inquiries.filter(Boolean)).toHaveLength(1)
      expect(await repository.inquiryCount(selected.expertId)).toBe(1)

      const counts = await db<{ profiles: string; releases: string; consents: string; links: string; inquiries: string }>`
        select
          (select count(*) from fuma_expert_profiles)::text profiles,
          (select count(*) from fuma_expert_public_releases)::text releases,
          (select count(*) from fuma_expert_attribution_consents)::text consents,
          (select count(*) from fuma_expert_plugin_links)::text links,
          (select count(*) from fuma_expert_inquiries)::text inquiries
      `
      expect(counts.rows[0]).toEqual({ profiles: '2', releases: '2', consents: '4', links: '1', inquiries: '1' })
      process.stdout.write('[FUMA-073 PostgreSQL] contention=8 profiles=2 releases=2 consents=4 links=1 inquiries=1 publicIdentityUnique=true revisionFenced=true\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
    }
  }, 120_000)
})
