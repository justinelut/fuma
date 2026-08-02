import type { DbClient } from '../../db/client'
import { ExpertInquiryReceiptSchema, ExpertPluginLinkSchema, ExpertProfileRecordSchema, parseExpertContract, type ExpertInquiryReceipt, type ExpertPluginLink, type ExpertProfileRecord } from './contracts'
import type { ExpertDiscoveryRepository } from './service'

type ProfileRow = Readonly<{ profile_json: unknown }>
type LinkRow = Readonly<{ expert_id: string; plugin_id: string; publisher_organization_id: string; verification_hash_sha256: string; verified_at: string | Date; revoked_at: string | Date | null }>
const json = (value: unknown) => JSON.stringify(value)
function raw(value: unknown): unknown { if (typeof value !== 'string') return value; try { return JSON.parse(value) as unknown } catch { return null } }
function domain(row: ProfileRow): ExpertProfileRecord {
  const value = raw(row.profile_json); const candidate = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).domain : null
  return parseExpertContract(ExpertProfileRecordSchema, candidate, 'stored expert profile')
}
function document(profile: ExpertProfileRecord) {
  const { id, slug, summary, location, skills, services, showcaseIds, mediatedInquiryAvailable, imageUrl } = profile.public
  return { domain: profile, public: { id, slug, summary, location, skills, services, showcaseIds, mediatedInquiryAvailable, imageUrl, showcases: [] } }
}
function instant(value: string | Date | null): string | null { return value === null ? null : new Date(value).toISOString() }
class ExpertRepositoryConflict extends Error {}
function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === '23505'
}

export class PostgresExpertDiscoveryRepository implements ExpertDiscoveryRepository {
  readonly #db: DbClient
  constructor(db: DbClient) { if (db.dialect !== 'postgres') throw new TypeError('Hosted expert discovery requires PostgreSQL.'); this.#db = db }

  async approve(input: Parameters<ExpertDiscoveryRepository['approve']>[0]): Promise<boolean> {
    try {
      return await this.#db.transaction(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${'expert-public-id:' + input.profile.public.id},0))`
        await tx`select pg_advisory_xact_lock(hashtextextended(${'expert-public-slug:' + input.profile.public.slug},0))`
        const identity = await tx<{ duplicate: boolean }>`select exists(select 1 from fuma_expert_profiles where profile_json->'public'->>'id'=${input.profile.public.id} or profile_json->'public'->>'slug'=${input.profile.public.slug}) duplicate`
        if (identity.rows[0]?.duplicate !== false) throw new ExpertRepositoryConflict()
        const release = await tx`insert into fuma_expert_public_releases (release_id,expert_id,artifact_object_key,artifact_hash_sha256,submitted_by,approved_by,approved_at,withdrawn_at) values (${input.profile.approvedReleaseId},${input.profile.expertId},${input.artifactObjectKey},${input.artifactHashSha256},${input.submittedByActorId},${input.approvedByActorId},${input.profile.public.approvedAt},null) on conflict do nothing`
        if (release.rowCount !== 1) throw new ExpertRepositoryConflict()
        const expertConsent = await tx`insert into fuma_expert_attribution_consents (release_id,party_kind,actor_id,consent_version,consented_at,revoked_at) values (${input.profile.approvedReleaseId},${'expert'},${input.expertConsent.actorId},${input.expertConsent.version},${input.expertConsent.consentedAt},null)`
        const siteConsent = await tx`insert into fuma_expert_attribution_consents (release_id,party_kind,actor_id,consent_version,consented_at,revoked_at) values (${input.profile.approvedReleaseId},${'site-owner'},${input.siteOwnerConsent.actorId},${input.siteOwnerConsent.version},${input.siteOwnerConsent.consentedAt},null)`
        if (expertConsent.rowCount !== 1 || siteConsent.rowCount !== 1) throw new ExpertRepositoryConflict()
        const profile = await tx`insert into fuma_expert_profiles (expert_id,organization_id,kind,display_name,profile_json,approved_release_id,opted_in,suspended,consent_version,public_revision,updated_at) values (${input.profile.expertId},${input.profile.organizationId},${input.profile.public.expertType},${input.profile.public.publicName},${json(document(input.profile))}::text::jsonb,${input.profile.approvedReleaseId},${input.profile.optedIn},false,${input.profile.consentVersion},${input.profile.publicRevision},${input.profile.updatedAt}) on conflict do nothing`
        if (profile.rowCount !== 1) throw new ExpertRepositoryConflict()
        return true
      })
    } catch (error) {
      if (error instanceof ExpertRepositoryConflict || isUniqueConflict(error)) return false
      throw error
    }
  }
  async get(expertId: string): Promise<ExpertProfileRecord | null> { const row = (await this.#db<ProfileRow>`select profile_json from fuma_expert_profiles where expert_id=${expertId}`).rows[0]; return row ? domain(row) : null }
  async listCandidates(): Promise<readonly ExpertProfileRecord[]> { return (await this.#db<ProfileRow>`select profile_json from fuma_expert_profiles order by public_revision desc,expert_id`).rows.map(domain) }
  async replace(profile: ExpertProfileRecord, expectedPublicRevision: number): Promise<boolean> {
    const result = await this.#db`update fuma_expert_profiles set organization_id=${profile.organizationId},kind=${profile.public.expertType},display_name=${profile.public.publicName},profile_json=${json(document(profile))}::text::jsonb,approved_release_id=${profile.approvedReleaseId},opted_in=${profile.optedIn},consent_version=${profile.consentVersion},public_revision=${profile.publicRevision},updated_at=${profile.updatedAt} where expert_id=${profile.expertId} and public_revision=${expectedPublicRevision}`
    return result.rowCount === 1
  }
  async putPluginLink(link: ExpertPluginLink, expectedPublicRevision: number): Promise<boolean> {
    try {
      return await this.#db.transaction(async (tx) => {
        const row = (await tx<ProfileRow>`select profile_json from fuma_expert_profiles where expert_id=${link.expertId} and public_revision=${expectedPublicRevision} for update`).rows[0]
        if (!row) throw new ExpertRepositoryConflict()
        const inserted = await tx`insert into fuma_expert_plugin_links (expert_id,plugin_id,publisher_organization_id,verification_hash_sha256,verified_at,revoked_at) values (${link.expertId},${link.pluginId},${link.publisherOrganizationId},${link.verificationHashSha256},${link.verifiedAt},null) on conflict do nothing`
        if (inserted.rowCount !== 1) throw new ExpertRepositoryConflict()
        const profile = domain(row); const next = { ...profile, publicRevision: profile.publicRevision + 1, updatedAt: link.verifiedAt }
        const updated = await tx`update fuma_expert_profiles set profile_json=${json(document(next))}::text::jsonb,public_revision=${next.publicRevision},updated_at=${next.updatedAt} where expert_id=${next.expertId} and public_revision=${expectedPublicRevision}`
        if (updated.rowCount !== 1) throw new ExpertRepositoryConflict()
        return true
      })
    } catch (error) {
      if (error instanceof ExpertRepositoryConflict || isUniqueConflict(error)) return false
      throw error
    }
  }
  async listPluginLinks(expertId: string): Promise<readonly ExpertPluginLink[]> {
    const rows = (await this.#db<LinkRow>`select expert_id,plugin_id,publisher_organization_id,verification_hash_sha256,verified_at,revoked_at from fuma_expert_plugin_links where expert_id=${expertId} order by plugin_id`).rows
    return rows.map((row) => parseExpertContract(ExpertPluginLinkSchema, { expertId: row.expert_id, pluginId: row.plugin_id, publisherOrganizationId: row.publisher_organization_id, verificationHashSha256: row.verification_hash_sha256, verifiedAt: instant(row.verified_at), revokedAt: instant(row.revoked_at) }, 'stored expert plugin link'))
  }
  async putInquiry(receipt: ExpertInquiryReceipt, senderFingerprintSha256: string): Promise<boolean> {
    const value = parseExpertContract(ExpertInquiryReceiptSchema, receipt, 'stored inquiry receipt')
    const result = await this.#db`insert into fuma_expert_inquiries (inquiry_id,expert_id,sender_fingerprint_sha256,encrypted_object_key,consent_version,state,created_at) values (${value.inquiryId},${value.expertId},${senderFingerprintSha256},${value.encryptedObjectKey},${value.consentVersion},${value.state},${value.createdAt}) on conflict do nothing`
    return result.rowCount === 1
  }
  async inquiryCount(expertId: string): Promise<number> { const row = (await this.#db<{ count: string | number | bigint }>`select count(*) as count from fuma_expert_inquiries where expert_id=${expertId}`).rows[0]; return Number(row?.count ?? 0) }
}
