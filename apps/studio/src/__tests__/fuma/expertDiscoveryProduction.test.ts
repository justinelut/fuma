import type { DbClient, DbResult } from '../../../server/db/client'
import {
  PostgresExpertDiscoveryInvalidationPort,
  PostgresExpertInquiryAbuseAuthority,
  PostgresExpertModerationAuthority,
  PostgresExpertPluginReviewAuthority,
  PostgresExpertTransferAuthority,
  readHostedExpertInquiryKey,
} from '../../../server/fuma/expertDiscovery'

function dbWith(...results: DbResult[]): DbClient {
  let index = 0
  const query = async (): Promise<DbResult> => results[index++] ?? { rows: [], rowCount: 0 }
  return Object.assign(query, {
    dialect: 'postgres' as const,
    unsafe: async () => await query(),
    transaction: async <T>(work: (tx: DbClient) => Promise<T>) => await work(db),
  }) as DbClient
}

const source = {
  platformId: 'platform', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 2,
}

describe('FUMA-073 production authorities', () => {
  it('reads the latest FUMA-072 moderation transition', async () => {
    const authority = new PostgresExpertModerationAuthority(dbWith({ rows: [{ event: 'suspended' }], rowCount: 1 }))
    expect(await authority.suspended('expert-a')).toBe(true)
  })

  it('accepts only one unambiguous publisher on a current signed FUMA-068 review', async () => {
    const approved = new PostgresExpertPluginReviewAuthority(dbWith({ rows: [{ publisher_organization_id: 'publisher-a', verification_hash_sha256: 'a'.repeat(64), publisher_memberships: 1 }], rowCount: 1 }))
    expect(await approved.approved('plugin-a')).toEqual({ publisherOrganizationId: 'publisher-a', verificationHashSha256: 'a'.repeat(64) })
    const ambiguous = new PostgresExpertPluginReviewAuthority(dbWith({ rows: [{ publisher_organization_id: 'publisher-a', verification_hash_sha256: 'a'.repeat(64), publisher_memberships: 2 }], rowCount: 1 }))
    expect(await ambiguous.approved('plugin-a')).toBeNull()
  })

  it('derives the destination only from a completed FUMA-074 transfer and current owner generation', async () => {
    const authority = new PostgresExpertTransferAuthority(dbWith({ rows: [{ platform_id: 'platform', destination_organization_id: 'org-b', destination_workspace_id: 'workspace-b', destination_site_id: 'site-a', owner_key: 'owner-b', owner_generation: '3' }], rowCount: 1 }))
    expect(await authority.resolveDestination({ transferId: 'transfer-a', expertId: 'expert-a', source })).toEqual({ platformId: 'platform', organizationId: 'org-b', workspaceId: 'workspace-b', siteId: 'site-a', ownerKey: 'owner-b', ownerGeneration: 3 })
  })

  it('uses a secret-peppered sender fingerprint, bounded inquiry window, and PostgreSQL invalidation event', async () => {
    const abuse = new PostgresExpertInquiryAbuseAuthority({ db: dbWith({ rows: [{ count: '4' }], rowCount: 1 }), pepper: 'p'.repeat(32) })
    const request = {
      context: { source: { kind: 'staff-session', userId: 'user-a', sessionId: 'session-a', impersonatedBy: null } },
      scope: { organizationId: 'org-a' },
    } as Parameters<typeof abuse.resolve>[0]
    const result = await abuse.resolve(request)
    expect(result.blocked).toBe(false); expect(result.senderFingerprintSha256).toMatch(/^[a-f0-9]{64}$/)
    const invalidation = new PostgresExpertDiscoveryInvalidationPort(dbWith({ rows: [{}], rowCount: 1 }))
    await expect(invalidation.publish({ expertId: 'expert-a', publicRevision: 2, reason: 'visibility' })).resolves.toBeUndefined()
  })

  it('accepts only canonical base64url 256-bit hosted inquiry keys', () => {
    const encoded = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url')
    expect(readHostedExpertInquiryKey({ FUMA_EXPERT_INQUIRY_KEY: encoded, FUMA_EXPERT_INQUIRY_KEY_ID: 'key-1' })).toMatchObject({ keyId: 'key-1' })
    expect(() => readHostedExpertInquiryKey({ FUMA_EXPERT_INQUIRY_KEY: 'short' })).toThrow('256-bit key')
  })
})
