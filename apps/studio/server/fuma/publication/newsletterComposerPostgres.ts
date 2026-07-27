import {
  NewsletterComposerDraftSchema,
  NewsletterSenderVerificationSchema,
  PublicationNewsletterProfileSchema,
  parseNewsletterComposerContract,
  type NewsletterComposerDraft,
  type NewsletterSenderVerification,
  type PublicationNewsletterProfile,
} from '@core/fuma/publication/newsletterComposerContracts'
import type { DbClient } from '../../db/client'
import type { PublicationRepositoryScope } from './scope'
import { PublicationScopeError } from './scope'
import type { NewsletterComposerRepository, NewsletterDraftSaveResult } from './newsletterComposer'

interface NewsletterRow {
  newsletter_id: string; name: string; slug: string; description: string; status: string
  default_segment_id: string | null; web_content_id: string | null; version: string | number | bigint
  created_by: string; created_at: string | Date; updated_by: string; updated_at: string | Date
}
interface DraftRow {
  draft_id: string; newsletter_id: string; sequence: string | number | bigint; subject: string; preview_text: string
  document_json: unknown; audience_json: unknown; updated_by: string; updated_at: string | Date
}
interface MutationRow { command_sha256: string; result_json: unknown }
interface VerificationRow {
  sender_email: string; state: string; provider_identity_id: string; verified_at: string | Date | null; checked_at: string | Date
}
class NewsletterWriteConflict extends Error {}

export class PostgresNewsletterComposerRepository implements NewsletterComposerRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Newsletter composer authority requires PostgreSQL.')
    this.#db = db
  }

  async list(scope: PublicationRepositoryScope, limit: number): Promise<readonly PublicationNewsletterProfile[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new TypeError('Newsletter list limit is invalid.')
    return await this.#authorized(scope, async (db) => Object.freeze((await db<NewsletterRow>`select newsletter_id,name,slug,description,status,default_segment_id,web_content_id,version,created_by,created_at,updated_by,updated_at from fuma_publication_newsletter_composers where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} order by name,newsletter_id limit ${limit}`).rows.map(mapNewsletter)))
  }

  async get(scope: PublicationRepositoryScope, newsletterId: string): Promise<PublicationNewsletterProfile | null> {
    return await this.#authorized(scope, async (db) => {
      const row = (await db<NewsletterRow>`select newsletter_id,name,slug,description,status,default_segment_id,web_content_id,version,created_by,created_at,updated_by,updated_at from fuma_publication_newsletter_composers where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and newsletter_id=${newsletterId}`).rows[0]
      return row ? mapNewsletter(row) : null
    })
  }

  async put(scope: PublicationRepositoryScope, input: PublicationNewsletterProfile, expectedVersion: number | null): Promise<boolean> {
    const value = parseNewsletterComposerContract('Newsletter profile', PublicationNewsletterProfileSchema, input)
    try {
      return await this.#authorized(scope, async (db) => {
        const result = expectedVersion === null
          ? await db`insert into fuma_publication_newsletter_composers (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id,name,slug,description,status,default_segment_id,web_content_id,version,created_by,created_at,updated_by,updated_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.newsletterId},${value.name},${value.slug},${value.description},${value.status},${value.defaultSegmentId},${value.webContentId},${value.version},${value.createdBy},${value.createdAt},${value.updatedBy},${value.updatedAt}) on conflict do nothing`
          : await db`update fuma_publication_newsletter_composers set name=${value.name},slug=${value.slug},description=${value.description},status=${value.status},default_segment_id=${value.defaultSegmentId},web_content_id=${value.webContentId},version=${value.version},updated_by=${value.updatedBy},updated_at=${value.updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and newsletter_id=${value.newsletterId} and version=${expectedVersion} and created_by=${value.createdBy} and created_at=${value.createdAt}`
        return result.rowCount === 1
      })
    } catch (error) {
      if (isUniqueConflict(error)) return false
      throw error
    }
  }

  async getDraft(scope: PublicationRepositoryScope, newsletterId: string): Promise<NewsletterComposerDraft | null> {
    return await this.#authorized(scope, async (db) => {
      const row = (await db<DraftRow>`select draft_id,newsletter_id,sequence,subject,preview_text,document_json,audience_json,updated_by,updated_at from fuma_publication_newsletter_drafts where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and newsletter_id=${newsletterId}`).rows[0]
      return row ? mapDraft(row) : null
    })
  }

  async saveDraft(scope: PublicationRepositoryScope, input: NewsletterComposerDraft, expectedSequence: number, mutationId: string, commandSha256: string): Promise<NewsletterDraftSaveResult> {
    const draft = parseNewsletterComposerContract('Newsletter composer draft', NewsletterComposerDraftSchema, input)
    try {
      return await this.#authorized(scope, async (db) => {
        const newsletter = await db`select 1 from fuma_publication_newsletter_composers where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and newsletter_id=${draft.newsletterId} and status<>'archived' for share`
        if (newsletter.rowCount !== 1) return Object.freeze({ kind: 'conflict' as const, draft: null })
        const replay = (await db<MutationRow>`select command_sha256,result_json from fuma_publication_newsletter_draft_mutations where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and newsletter_id=${draft.newsletterId} and mutation_id=${mutationId}`).rows[0]
        if (replay) {
          if (replay.command_sha256 !== commandSha256) return Object.freeze({ kind: 'conflict' as const, draft: null })
          return Object.freeze({ kind: 'replayed' as const, draft: parseNewsletterComposerContract('Replayed newsletter draft', NewsletterComposerDraftSchema, json(replay.result_json)) })
        }
        const currentRow = (await db<DraftRow>`select draft_id,newsletter_id,sequence,subject,preview_text,document_json,audience_json,updated_by,updated_at from fuma_publication_newsletter_drafts where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and newsletter_id=${draft.newsletterId} for update`).rows[0]
        const current = currentRow ? mapDraft(currentRow) : null
        if ((current?.sequence ?? 0) !== expectedSequence || draft.sequence !== expectedSequence + 1 || (current !== null && current.draftId !== draft.draftId)) {
          return Object.freeze({ kind: 'conflict' as const, draft: current })
        }
        const changed = current === null
          ? await db`insert into fuma_publication_newsletter_drafts (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id,draft_id,sequence,subject,preview_text,document_json,audience_json,updated_by,updated_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${draft.newsletterId},${draft.draftId},${draft.sequence},${draft.subject},${draft.previewText},${JSON.stringify(draft.document)}::text::jsonb,${JSON.stringify(draft.audience)}::text::jsonb,${draft.updatedBy},${draft.updatedAt}) on conflict do nothing`
          : await db`update fuma_publication_newsletter_drafts set sequence=${draft.sequence},subject=${draft.subject},preview_text=${draft.previewText},document_json=${JSON.stringify(draft.document)}::text::jsonb,audience_json=${JSON.stringify(draft.audience)}::text::jsonb,updated_by=${draft.updatedBy},updated_at=${draft.updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and newsletter_id=${draft.newsletterId} and draft_id=${draft.draftId} and sequence=${expectedSequence}`
        if (changed.rowCount !== 1) throw new NewsletterWriteConflict()
        const receipt = await db`insert into fuma_publication_newsletter_draft_mutations (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id,mutation_id,command_sha256,accepted_sequence,result_json,created_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${draft.newsletterId},${mutationId},${commandSha256},${draft.sequence},${JSON.stringify(draft)}::text::jsonb,${draft.updatedAt}) on conflict do nothing`
        if (receipt.rowCount !== 1) throw new NewsletterWriteConflict()
        return Object.freeze({ kind: 'saved' as const, draft })
      })
    } catch (error) {
      if (error instanceof NewsletterWriteConflict || isUniqueConflict(error)) return Object.freeze({ kind: 'conflict', draft: null })
      throw error
    }
  }

  async getSenderVerification(scope: PublicationRepositoryScope, senderEmail: string): Promise<NewsletterSenderVerification | null> {
    return await this.#authorized(scope, async (db) => {
      const row = (await db<VerificationRow>`select sender_email,state,provider_identity_id,verified_at,checked_at from fuma_publication_newsletter_sender_verifications where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and sender_email=${senderEmail.toLowerCase()}`).rows[0]
      return row ? mapVerification(row) : null
    })
  }

  async recordSenderVerification(scope: PublicationRepositoryScope, input: NewsletterSenderVerification): Promise<boolean> {
    const value = parseNewsletterComposerContract('Trusted sender verification', NewsletterSenderVerificationSchema, input)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_newsletter_sender_verifications (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,sender_email,state,provider_identity_id,verified_at,checked_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.senderEmail.toLowerCase()},${value.state},${value.providerIdentityId},${value.verifiedAt},${value.checkedAt}) on conflict (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,sender_email) do update set state=excluded.state,provider_identity_id=excluded.provider_identity_id,verified_at=excluded.verified_at,checked_at=excluded.checked_at where fuma_publication_newsletter_sender_verifications.checked_at<excluded.checked_at`).rowCount === 1)
  }

  async #authorized<T>(scope: PublicationRepositoryScope, work: (db: DbClient) => Promise<T>): Promise<T> {
    return await this.#db.transaction(async (db) => {
      const authority = await db`select 1 from fuma_tenant_owner_keys owner join fuma_sites site on site.organization_id=owner.organization_id and site.workspace_id=owner.workspace_id and site.id=owner.site_id where owner.platform_id=${scope.platformId} and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId} and owner.owner_key=${scope.ownerKey} and owner.generation=${scope.generation} and site.profile_id=${scope.profileId} and owner.state='active' and owner.transfer_id is null and owner.transfer_lock_id is null and owner.transfer_fence is null for share`
      if (authority.rowCount !== 1) throw new PublicationScopeError()
      return await work(db)
    })
  }
}

function mapNewsletter(row: NewsletterRow): PublicationNewsletterProfile {
  return parseNewsletterComposerContract('Stored newsletter profile', PublicationNewsletterProfileSchema, { newsletterId: row.newsletter_id, name: row.name, slug: row.slug, description: row.description, status: row.status, defaultSegmentId: row.default_segment_id, webContentId: row.web_content_id, version: integer(row.version), createdBy: row.created_by, createdAt: iso(row.created_at), updatedBy: row.updated_by, updatedAt: iso(row.updated_at) })
}
function mapDraft(row: DraftRow): NewsletterComposerDraft {
  return parseNewsletterComposerContract('Stored newsletter draft', NewsletterComposerDraftSchema, { draftId: row.draft_id, newsletterId: row.newsletter_id, sequence: integer(row.sequence), subject: row.subject, previewText: row.preview_text, document: json(row.document_json), audience: json(row.audience_json), updatedBy: row.updated_by, updatedAt: iso(row.updated_at) })
}
function mapVerification(row: VerificationRow): NewsletterSenderVerification {
  return parseNewsletterComposerContract('Stored sender verification', NewsletterSenderVerificationSchema, { senderEmail: row.sender_email, state: row.state, providerIdentityId: row.provider_identity_id, verifiedAt: nullableIso(row.verified_at), checkedAt: iso(row.checked_at) })
}
function integer(value: string | number | bigint): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error('Stored newsletter version is invalid.'); return result }
function iso(value: string | Date): string { return new Date(value).toISOString() }
function nullableIso(value: string | Date | null): string | null { return value === null ? null : iso(value) }
function json(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : structuredClone(value) }
function isUniqueConflict(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505' }
