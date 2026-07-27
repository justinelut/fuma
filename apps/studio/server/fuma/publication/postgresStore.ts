import {
  CampaignDeliverySchema,
  CampaignSnapshotSchema,
  DeliverabilitySummarySchema,
  EmailSettingsLayerSchema,
  NewsletterSchema,
  NewsletterVersionSchema,
  PublicationAccessGrantSchema,
  PublicationAnalyticsEventSchema,
  PublicationAnalyticsSummarySchema,
  PublicationMemberSchema,
  PublicationReaderAccountSchema,
  PublicationSegmentSchema,
  PublicationTemplateSchema,
  PublicationWorkflowTransitionSchema,
  SuppressionSchema,
  UnsubscribeTokenClaimsSchema,
  parsePublicationContract,
  type CampaignDelivery,
  type CampaignSnapshot,
  type DeliverabilitySummary,
  type EmailSettingsLayer,
  type Newsletter,
  type NewsletterVersion,
  type OciEmailProviderEvent,
  type PublicationAccessGrant,
  type PublicationAnalyticsEvent,
  type PublicationAnalyticsSummary,
  type PublicationAuthor,
  type PublicationContent,
  type PublicationContentImport,
  type PublicationMember,
  type PublicationReaderAccount,
  type PublicationSegment,
  type PublicationSettings,
  type PublicationTag,
  type PublicationTemplate,
  type PublicationWorkflowTransition,
  type Suppression,
  type UnsubscribeTokenClaims,
} from '@core/fuma/publication'
import type { DbClient } from '../../db/client'
import type { PublicationRepositoryScope } from './scope'
import { PublicationScopeError } from './scope'
import type { PublicationDomainStore } from './services'
import { PostgresPublicationUniversalStore } from './universalContentStore'

interface TemplateRow { template_id: string; name: string; applies_to: string; document_json: unknown; version: string | number | bigint; active: boolean; created_at: string | Date; updated_at: string | Date }
interface MemberRow { member_id: string; normalized_email: string; name: string; status: string; account_id: string | null; attributes_json: unknown; created_at: string | Date; updated_at: string | Date }
interface SegmentRow { segment_id: string; name: string; match_kind: string; rules_json: unknown; version: string | number | bigint; created_at: string | Date; updated_at: string | Date }
interface GrantRow { grant_id: string; member_id: string; resource_kind: string; resource_id: string; access: string; expires_at: string | Date | null; created_at: string | Date }
interface LayerRow { scope_kind: string; scope_id: string; values_json: unknown; version: string | number | bigint; updated_at: string | Date }
interface NewsletterRow { newsletter_id: string; name: string; slug: string; description: string; default_segment_id: string | null; status: string; created_at: string | Date; updated_at: string | Date }
interface VersionRow { version_id: string; newsletter_id: string; ordinal: string | number | bigint; subject: string; preview_text: string; document_json: unknown; created_by: string; created_at: string | Date; locked_at: string | Date | null }
interface CampaignRow { campaign_id: string; newsletter_id: string; version_id: string; segment_id: string; status: string; audience_member_ids_json: unknown; subject: string; html: string; plaintext: string; sender_json: unknown; audience_sha256: string; content_sha256: string; message_size_bytes: string | number | bigint; snapshot_sha256: string; scheduled_at: string | Date | null; created_at: string | Date }
interface DeliveryRow { delivery_id: string; campaign_id: string; member_id: string; recipient_email: string; status: string; provider_message_id: string | null; attempt: number; updated_at: string | Date }

class PublicationAtomicConflict extends Error {}
interface TokenRow { token_id: string; member_id: string; newsletter_id: string | null; issued_at: string | Date; expires_at: string | Date }
interface AnalyticsRow { views: string | number | bigint; unique_visitors: string | number | bigint; member_signups: string | number | bigint; newsletter_opens: string | number | bigint; newsletter_clicks: string | number | bigint }
interface TopContentRow { content_id: string; views: string | number | bigint }
interface DeliverySummaryRow { submitted: string | number | bigint; delivered: string | number | bigint; deferred: string | number | bigint; bounced: string | number | bigint; complained: string | number | bigint; suppressed: string | number | bigint }

function integer(value: string | number | bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Stored publication integer is invalid.')
  return result
}
function iso(value: string | Date | null): string | null { return value === null ? null : new Date(value).toISOString() }
function json(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : structuredClone(value) }
export class PostgresPublicationDomainStore implements PublicationDomainStore {
  readonly #db: DbClient
  readonly #universal: PostgresPublicationUniversalStore
  constructor(db: DbClient) { this.#db = db; this.#universal = new PostgresPublicationUniversalStore(db) }

  async #authorized<T>(scope: PublicationRepositoryScope, work: (db: DbClient) => Promise<T>): Promise<T> {
    return await this.#db.transaction(async (db) => {
      const authority = await db`select 1 from fuma_tenant_owner_keys where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and generation=${scope.generation} and state='active' and transfer_id is null and transfer_lock_id is null and transfer_fence is null for share`
      if (authority.rowCount !== 1) throw new PublicationScopeError()
      return await work(db)
    })
  }

  getContent(scope: PublicationRepositoryScope, contentId: string): Promise<PublicationContent | null> {
    return this.#universal.getContent(scope, contentId)
  }

  listContent(scope: PublicationRepositoryScope): Promise<readonly PublicationContent[]> {
    return this.#universal.listContent(scope)
  }

  putContent(scope: PublicationRepositoryScope, content: PublicationContent, expectedVersion: number | null): Promise<boolean> {
    return this.#universal.putContent(scope, content, expectedVersion)
  }

  importContent(scope: PublicationRepositoryScope, input: PublicationContentImport): Promise<boolean> {
    return this.#universal.importContent(scope, input)
  }

  deleteContent(scope: PublicationRepositoryScope, contentId: string, expectedVersion: number): Promise<boolean> {
    return this.#universal.deleteContent(scope, contentId, expectedVersion)
  }

  listAuthors(scope: PublicationRepositoryScope): Promise<readonly PublicationAuthor[]> {
    return this.#universal.listAuthors(scope)
  }

  getSettings(scope: PublicationRepositoryScope): Promise<PublicationSettings | null> {
    return this.#universal.getSettings(scope)
  }

  putSettings(scope: PublicationRepositoryScope, settings: PublicationSettings, expectedVersion: number | null): Promise<boolean> {
    return this.#universal.putSettings(scope, settings, expectedVersion)
  }

  putTag(scope: PublicationRepositoryScope, input: PublicationTag): Promise<boolean> {
    return this.#universal.putTag(scope, input)
  }

  listTags(scope: PublicationRepositoryScope): Promise<readonly PublicationTag[]> {
    return this.#universal.listTags(scope)
  }

  async appendWorkflowTransition(scope: PublicationRepositoryScope, input: PublicationWorkflowTransition): Promise<boolean> {
    const value = parsePublicationContract('workflow transition', PublicationWorkflowTransitionSchema, input)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_workflow_transitions (platform_id,owner_key,owner_generation,profile_id,transition_id,content_id,from_status,to_status,actor_id,expected_version,scheduled_at,note,created_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.transitionId},${value.contentId},${value.from},${value.to},${value.actorId},${value.expectedVersion},${value.scheduledAt},${value.note},${value.createdAt}) on conflict do nothing`).rowCount === 1)
  }

  commitWorkflowTransition(scope:PublicationRepositoryScope,next:PublicationContent,input:PublicationWorkflowTransition,expectedVersion:number):Promise<boolean>{
    return this.#universal.commitWorkflowTransition(scope,next,input,expectedVersion)
  }

  async putTemplate(scope: PublicationRepositoryScope, input: PublicationTemplate, expectedVersion: number | null): Promise<boolean> {
    const value = parsePublicationContract('template', PublicationTemplateSchema, input)
    return await this.#authorized(scope, async (db) => expectedVersion === null
      ? (await db`insert into fuma_publication_templates (platform_id,owner_key,owner_generation,profile_id,template_id,name,applies_to,document_json,version,active,created_at,updated_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.templateId},${value.name},${value.appliesTo},${JSON.stringify(value.document)},${value.version},${value.active},${value.createdAt},${value.updatedAt}) on conflict do nothing`).rowCount === 1
      : (await db`update fuma_publication_templates set name=${value.name},document_json=${JSON.stringify(value.document)},version=${value.version},active=${value.active},updated_at=${value.updatedAt} where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and template_id=${value.templateId} and version=${expectedVersion}`).rowCount === 1)
  }

  async listTemplates(scope: PublicationRepositoryScope): Promise<readonly PublicationTemplate[]> {
    return await this.#authorized(scope, async (db) => (await db<TemplateRow>`select template_id,name,applies_to,document_json,version,active,created_at,updated_at from fuma_publication_templates where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} order by name,template_id`).rows.map((row) => parsePublicationContract('stored template', PublicationTemplateSchema, { templateId: row.template_id, name: row.name, appliesTo: row.applies_to, document: json(row.document_json), version: integer(row.version), active: row.active, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })))
  }

  async putReaderAccount(scope: PublicationRepositoryScope, input: PublicationReaderAccount): Promise<boolean> {
    const value = parsePublicationContract('reader account', PublicationReaderAccountSchema, input)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_reader_accounts (platform_id,owner_key,owner_generation,profile_id,account_id,normalized_email_hash_sha256,verified_at,last_authenticated_at,disabled_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.accountId},${value.normalizedEmailHashSha256},${value.verifiedAt},${value.lastAuthenticatedAt},${value.disabledAt}) on conflict do nothing`).rowCount === 1)
  }


  async getMember(scope:PublicationRepositoryScope,memberId:string):Promise<PublicationMember|null>{return await this.#authorized(scope,async(db)=>{const row=(await db<MemberRow>`select member_id,normalized_email,name,status,account_id,attributes_json,created_at,updated_at from fuma_publication_members where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_id=${memberId}`).rows[0];return row?parsePublicationContract('stored member',PublicationMemberSchema,{memberId:row.member_id,email:row.normalized_email,name:row.name,status:row.status,accountId:row.account_id,attributes:json(row.attributes_json),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}):null})}
  async putMember(scope: PublicationRepositoryScope, input: PublicationMember): Promise<boolean> {
    const value = parsePublicationContract('member', PublicationMemberSchema, input)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_members (platform_id,owner_key,owner_generation,profile_id,member_id,normalized_email,name,status,account_id,attributes_json,created_at,updated_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.memberId},${value.email.trim().toLowerCase()},${value.name},${value.status},${value.accountId},${JSON.stringify(value.attributes)},${value.createdAt},${value.updatedAt}) on conflict (platform_id,owner_key,owner_generation,profile_id,member_id) do update set normalized_email=excluded.normalized_email,name=excluded.name,status=excluded.status,account_id=excluded.account_id,attributes_json=excluded.attributes_json,updated_at=excluded.updated_at`).rowCount === 1)
  }

  async listMembers(scope: PublicationRepositoryScope): Promise<readonly PublicationMember[]> {
    return await this.#authorized(scope, async (db) => {
      const { rows } = await db<MemberRow>`select member_id,normalized_email,name,status,account_id,attributes_json,created_at,updated_at from fuma_publication_members where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} order by member_id`
      return rows.map((row) => parsePublicationContract('stored member', PublicationMemberSchema, { memberId: row.member_id, email: row.normalized_email, name: row.name, status: row.status, accountId: row.account_id, attributes: json(row.attributes_json), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }))
    })
  }

  async putSegment(scope: PublicationRepositoryScope, input: PublicationSegment, expectedVersion: number | null): Promise<boolean> {
    const value = parsePublicationContract('segment', PublicationSegmentSchema, input)
    return await this.#authorized(scope, async (db) => expectedVersion === null
      ? (await db`insert into fuma_publication_segments (platform_id,owner_key,owner_generation,profile_id,segment_id,name,match_kind,rules_json,version,created_at,updated_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.segmentId},${value.name},${value.match},${JSON.stringify(value.rules)},${value.version},${value.createdAt},${value.updatedAt}) on conflict do nothing`).rowCount === 1
      : (await db`update fuma_publication_segments set name=${value.name},match_kind=${value.match},rules_json=${JSON.stringify(value.rules)},version=${value.version},updated_at=${value.updatedAt} where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and segment_id=${value.segmentId} and version=${expectedVersion}`).rowCount === 1)
  }

  async getSegment(scope: PublicationRepositoryScope, segmentId: string): Promise<PublicationSegment | null> {
    return await this.#authorized(scope, async (db) => {
      const { rows } = await db<SegmentRow>`select segment_id,name,match_kind,rules_json,version,created_at,updated_at from fuma_publication_segments where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and segment_id=${segmentId}`
      const row = rows[0]
      return row ? parsePublicationContract('stored segment', PublicationSegmentSchema, { segmentId: row.segment_id, name: row.name, match: row.match_kind, rules: json(row.rules_json), version: integer(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }) : null
    })
  }

  async listSegments(scope: PublicationRepositoryScope): Promise<readonly PublicationSegment[]> {
    return await this.#authorized(scope, async (db) => (await db<SegmentRow>`select segment_id,name,match_kind,rules_json,version,created_at,updated_at from fuma_publication_segments where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} order by name,segment_id`).rows.map((row) => parsePublicationContract('stored segment', PublicationSegmentSchema, { segmentId: row.segment_id, name: row.name, match: row.match_kind, rules: json(row.rules_json), version: integer(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })))
  }

  async putAccessGrant(scope: PublicationRepositoryScope, input: PublicationAccessGrant): Promise<boolean> {
    const value = parsePublicationContract('access grant', PublicationAccessGrantSchema, input)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_access_grants (platform_id,owner_key,owner_generation,profile_id,grant_id,member_id,resource_kind,resource_id,access,expires_at,created_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.grantId},${value.memberId},${value.resourceKind},${value.resourceId},${value.access},${value.expiresAt},${value.createdAt}) on conflict do nothing`).rowCount === 1)
  }

  async listAccessGrants(scope: PublicationRepositoryScope, memberId: string): Promise<readonly PublicationAccessGrant[]> {
    return await this.#authorized(scope, async (db) => (await db<GrantRow>`select grant_id,member_id,resource_kind,resource_id,access,expires_at,created_at from fuma_publication_access_grants where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_id=${memberId} order by grant_id`).rows.map((row) => parsePublicationContract('stored access grant', PublicationAccessGrantSchema, { grantId: row.grant_id, memberId: row.member_id, resourceKind: row.resource_kind, resourceId: row.resource_id, access: row.access, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at) })))
  }

  async appendAnalyticsEvent(scope: PublicationRepositoryScope, event: PublicationAnalyticsEvent): Promise<boolean> {
    const value = parsePublicationContract('analytics event', PublicationAnalyticsEventSchema, event)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_analytics_events (platform_id,owner_key,owner_generation,profile_id,event_id,occurred_at,kind,content_id,campaign_id,member_id,anonymous_visitor_hash_sha256,referrer_origin) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.eventId},${value.occurredAt},${value.kind},${value.contentId},${value.campaignId},${value.memberId},${value.anonymousVisitorHashSha256},${value.referrerOrigin}) on conflict do nothing`).rowCount === 1)
  }

  async analyticsSummary(scope: PublicationRepositoryScope, from: string, to: string): Promise<PublicationAnalyticsSummary> {
    return await this.#authorized(scope, async (db) => {
      const totals = await db<AnalyticsRow>`select count(*) filter (where kind in ('page-view','post-view')) as views,count(distinct coalesce(member_id,anonymous_visitor_hash_sha256)) as unique_visitors,count(*) filter (where kind='member-signup') as member_signups,count(*) filter (where kind='newsletter-open') as newsletter_opens,count(*) filter (where kind='newsletter-click') as newsletter_clicks from fuma_publication_analytics_events where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and occurred_at>=${from} and occurred_at<${to}`
      const top = await db<TopContentRow>`select content_id,count(*) as views from fuma_publication_analytics_events where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and occurred_at>=${from} and occurred_at<${to} and content_id is not null and kind in ('page-view','post-view') group by content_id order by views desc,content_id limit 100`
      const row = totals.rows[0] ?? { views: 0, unique_visitors: 0, member_signups: 0, newsletter_opens: 0, newsletter_clicks: 0 }
      return parsePublicationContract('analytics summary', PublicationAnalyticsSummarySchema, { from, to, views: integer(row.views), uniqueVisitors: integer(row.unique_visitors), memberSignups: integer(row.member_signups), newsletterOpens: integer(row.newsletter_opens), newsletterClicks: integer(row.newsletter_clicks), topContent: top.rows.map((item) => ({ contentId: item.content_id, views: integer(item.views) })) })
    })
  }

  async putEmailSettingsLayer(scope: PublicationRepositoryScope, input: EmailSettingsLayer, expectedVersion: number | null): Promise<boolean> {
    const value = parsePublicationContract('email settings layer', EmailSettingsLayerSchema, input)
    const authorityIds: Record<EmailSettingsLayer['scope'], string | null> = { platform: scope.platformId, organization: scope.organizationId, workspace: scope.workspaceId, site: scope.siteId, newsletter: value.scopeId }
    if (authorityIds[value.scope] !== value.scopeId) throw new PublicationScopeError()
    return await this.#authorized(scope, async (db) => expectedVersion === null
      ? (await db`insert into fuma_email_settings_layers (platform_id,organization_id,workspace_id,owner_key,owner_generation,profile_id,scope_kind,scope_id,values_json,version,updated_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.scope},${value.scopeId},${JSON.stringify(value.values)},${value.version},${value.updatedAt}) on conflict do nothing`).rowCount === 1
      : (await db`update fuma_email_settings_layers set values_json=${JSON.stringify(value.values)},version=${value.version},updated_at=${value.updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and scope_kind=${value.scope} and scope_id=${value.scopeId} and version=${expectedVersion}`).rowCount === 1)
  }

  async listEmailSettingsLayers(scope: PublicationRepositoryScope, newsletterId: string | null): Promise<readonly EmailSettingsLayer[]> {
    return await this.#authorized(scope, async (db) => {
      const ids = [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, newsletterId ?? '']
      const { rows } = await db<LayerRow>`select scope_kind,scope_id,values_json,version,updated_at from fuma_email_settings_layers where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and ((scope_kind='platform' and scope_id=${ids[0]}) or (scope_kind='organization' and scope_id=${ids[1]}) or (scope_kind='workspace' and scope_id=${ids[2]}) or (scope_kind='site' and scope_id=${ids[3]}) or (scope_kind='newsletter' and scope_id=${ids[4]})) order by case scope_kind when 'platform' then 1 when 'organization' then 2 when 'workspace' then 3 when 'site' then 4 else 5 end`
      return rows.map((row) => parsePublicationContract('stored email settings layer', EmailSettingsLayerSchema, { scope: row.scope_kind, scopeId: row.scope_id, values: json(row.values_json), version: integer(row.version), updatedAt: iso(row.updated_at) }))
    })
  }

  async putNewsletter(scope: PublicationRepositoryScope, input: Newsletter): Promise<boolean> {
    const value = parsePublicationContract('newsletter', NewsletterSchema, input)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_newsletters (platform_id,owner_key,owner_generation,profile_id,newsletter_id,name,slug,description,default_segment_id,status,created_at,updated_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.newsletterId},${value.name},${value.slug},${value.description},${value.defaultSegmentId},${value.status},${value.createdAt},${value.updatedAt}) on conflict (platform_id,owner_key,owner_generation,profile_id,newsletter_id) do update set name=excluded.name,slug=excluded.slug,description=excluded.description,default_segment_id=excluded.default_segment_id,status=excluded.status,updated_at=excluded.updated_at`).rowCount === 1)
  }
  async getNewsletter(scope: PublicationRepositoryScope, newsletterId: string): Promise<Newsletter | null> {
    return await this.#authorized(scope, async (db) => { const row=(await db<NewsletterRow>`select newsletter_id,name,slug,description,default_segment_id,status,created_at,updated_at from fuma_publication_newsletters where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and newsletter_id=${newsletterId}`).rows[0]; return row ? parsePublicationContract('stored newsletter', NewsletterSchema, { newsletterId: row.newsletter_id,name:row.name,slug:row.slug,description:row.description,defaultSegmentId:row.default_segment_id,status:row.status,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at) }) : null })
  }
  async listNewsletters(scope: PublicationRepositoryScope): Promise<readonly Newsletter[]> {
    return await this.#authorized(scope, async (db) => (await db<NewsletterRow>`select newsletter_id,name,slug,description,default_segment_id,status,created_at,updated_at from fuma_publication_newsletters where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} order by name,newsletter_id`).rows.map((row) => parsePublicationContract('stored newsletter', NewsletterSchema, { newsletterId: row.newsletter_id, name: row.name, slug: row.slug, description: row.description, defaultSegmentId: row.default_segment_id, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })))
  }
  async appendNewsletterVersion(scope: PublicationRepositoryScope, input: NewsletterVersion): Promise<boolean> {
    const value=parsePublicationContract('newsletter version',NewsletterVersionSchema,input)
    return await this.#authorized(scope,async(db)=>(await db`insert into fuma_publication_newsletter_versions (platform_id,owner_key,owner_generation,profile_id,version_id,newsletter_id,ordinal,subject,preview_text,document_json,created_by,created_at,locked_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.versionId},${value.newsletterId},${value.ordinal},${value.subject},${value.previewText},${JSON.stringify(value.document)},${value.createdBy},${value.createdAt},${value.lockedAt}) on conflict do nothing`).rowCount===1)
  }
  async getNewsletterVersion(scope: PublicationRepositoryScope, versionId: string): Promise<NewsletterVersion | null> {
    return await this.#authorized(scope,async(db)=>{const row=(await db<VersionRow>`select version_id,newsletter_id,ordinal,subject,preview_text,document_json,created_by,created_at,locked_at from fuma_publication_newsletter_versions where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and version_id=${versionId}`).rows[0];return row?parsePublicationContract('stored newsletter version',NewsletterVersionSchema,{versionId:row.version_id,newsletterId:row.newsletter_id,ordinal:integer(row.ordinal),subject:row.subject,previewText:row.preview_text,document:json(row.document_json),createdBy:row.created_by,createdAt:iso(row.created_at),lockedAt:iso(row.locked_at)}):null})
  }
  async listNewsletterVersions(scope: PublicationRepositoryScope, newsletterId: string | null): Promise<readonly NewsletterVersion[]> {
    return await this.#authorized(scope, async (db) => {
      const rows = newsletterId === null
        ? (await db<VersionRow>`select version_id,newsletter_id,ordinal,subject,preview_text,document_json,created_by,created_at,locked_at from fuma_publication_newsletter_versions where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} order by created_at desc,version_id`).rows
        : (await db<VersionRow>`select version_id,newsletter_id,ordinal,subject,preview_text,document_json,created_by,created_at,locked_at from fuma_publication_newsletter_versions where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and newsletter_id=${newsletterId} order by ordinal desc,version_id`).rows
      return rows.map((row) => parsePublicationContract('stored newsletter version', NewsletterVersionSchema, { versionId: row.version_id, newsletterId: row.newsletter_id, ordinal: integer(row.ordinal), subject: row.subject, previewText: row.preview_text, document: json(row.document_json), createdBy: row.created_by, createdAt: iso(row.created_at), lockedAt: iso(row.locked_at) }))
    })
  }
  async putCampaign(scope: PublicationRepositoryScope,input:CampaignSnapshot):Promise<boolean>{const value=parsePublicationContract('campaign',CampaignSnapshotSchema,input);return await this.#authorized(scope,async(db)=>(await db`insert into fuma_publication_campaigns (platform_id,owner_key,owner_generation,profile_id,campaign_id,newsletter_id,version_id,segment_id,status,audience_member_ids_json,subject,html,plaintext,sender_json,audience_sha256,content_sha256,message_size_bytes,snapshot_sha256,scheduled_at,created_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.campaignId},${value.newsletterId},${value.versionId},${value.segmentId},${value.status},${JSON.stringify(value.audienceMemberIds)},${value.subject},${value.html},${value.text},${JSON.stringify(value.sender)},${value.audienceSha256},${value.contentSha256},${value.messageSizeBytes},${value.snapshotSha256},${value.scheduledAt},${value.createdAt}) on conflict do nothing`).rowCount===1)}
  async putCampaignWithDeliveries(scope:PublicationRepositoryScope,input:CampaignSnapshot,deliveries:readonly CampaignDelivery[]):Promise<boolean>{
    const campaign=parsePublicationContract('campaign',CampaignSnapshotSchema,input)
    const values=deliveries.map(item=>parsePublicationContract('campaign delivery',CampaignDeliverySchema,item))
    if(values.some(item=>item.campaignId!==campaign.campaignId)||new Set(values.map(item=>item.memberId)).size!==values.length)throw new TypeError('Campaign deliveries do not match the immutable snapshot.')
    try{return await this.#authorized(scope,async(db)=>{
      const inserted=await db`insert into fuma_publication_campaigns (platform_id,owner_key,owner_generation,profile_id,campaign_id,newsletter_id,version_id,segment_id,status,audience_member_ids_json,subject,html,plaintext,sender_json,audience_sha256,content_sha256,message_size_bytes,snapshot_sha256,scheduled_at,created_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${campaign.campaignId},${campaign.newsletterId},${campaign.versionId},${campaign.segmentId},${campaign.status},${JSON.stringify(campaign.audienceMemberIds)},${campaign.subject},${campaign.html},${campaign.text},${JSON.stringify(campaign.sender)},${campaign.audienceSha256},${campaign.contentSha256},${campaign.messageSizeBytes},${campaign.snapshotSha256},${campaign.scheduledAt},${campaign.createdAt}) on conflict do nothing`
      if(inserted.rowCount!==1)throw new PublicationAtomicConflict()
      for(const value of values){const delivery=await db`insert into fuma_publication_campaign_deliveries (platform_id,owner_key,owner_generation,profile_id,delivery_id,campaign_id,member_id,recipient_email,status,provider_message_id,attempt,updated_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.deliveryId},${value.campaignId},${value.memberId},${value.recipientEmail},${value.status},${value.providerMessageId},${value.attempt},${value.updatedAt}) on conflict do nothing`;if(delivery.rowCount!==1)throw new PublicationAtomicConflict()}
      return true
    })}catch(error){if(error instanceof PublicationAtomicConflict)return false;throw error}
  }
  async getCampaign(scope:PublicationRepositoryScope,campaignId:string):Promise<CampaignSnapshot|null>{return await this.#authorized(scope,async(db)=>{const row=(await db<CampaignRow>`select campaign_id,newsletter_id,version_id,segment_id,status,audience_member_ids_json,subject,html,plaintext,sender_json,audience_sha256,content_sha256,message_size_bytes,snapshot_sha256,scheduled_at,created_at from fuma_publication_campaigns where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and campaign_id=${campaignId}`).rows[0];return row?parsePublicationContract('stored campaign',CampaignSnapshotSchema,{campaignId:row.campaign_id,newsletterId:row.newsletter_id,versionId:row.version_id,segmentId:row.segment_id,status:row.status,audienceMemberIds:json(row.audience_member_ids_json),subject:row.subject,html:row.html,text:row.plaintext,sender:json(row.sender_json),audienceSha256:row.audience_sha256,contentSha256:row.content_sha256,messageSizeBytes:integer(row.message_size_bytes),snapshotSha256:row.snapshot_sha256,scheduledAt:iso(row.scheduled_at),createdAt:iso(row.created_at)}):null})}
  async transitionCampaignStatus(scope:PublicationRepositoryScope,campaignId:string,from:CampaignSnapshot['status'],to:CampaignSnapshot['status']):Promise<boolean>{return await this.#authorized(scope,async(db)=>(await db`update fuma_publication_campaigns set status=${to} where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and campaign_id=${campaignId} and status=${from}`).rowCount===1)}
  async putDeliveries(scope:PublicationRepositoryScope,deliveries:readonly CampaignDelivery[]):Promise<void>{await this.#authorized(scope,async(db)=>{for(const item of deliveries){const value=parsePublicationContract('campaign delivery',CampaignDeliverySchema,item);await db`insert into fuma_publication_campaign_deliveries (platform_id,owner_key,owner_generation,profile_id,delivery_id,campaign_id,member_id,recipient_email,status,provider_message_id,attempt,updated_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.deliveryId},${value.campaignId},${value.memberId},${value.recipientEmail},${value.status},${value.providerMessageId},${value.attempt},${value.updatedAt}) on conflict (platform_id,owner_key,owner_generation,profile_id,delivery_id) do update set status=excluded.status,provider_message_id=excluded.provider_message_id,attempt=excluded.attempt,updated_at=excluded.updated_at`}})}
  async listDeliveries(scope:PublicationRepositoryScope,campaignId:string):Promise<readonly CampaignDelivery[]>{return await this.#authorized(scope,async(db)=>(await db<DeliveryRow>`select delivery_id,campaign_id,member_id,recipient_email,status,provider_message_id,attempt,updated_at from fuma_publication_campaign_deliveries where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and campaign_id=${campaignId} order by member_id`).rows.map(row=>parsePublicationContract('stored campaign delivery',CampaignDeliverySchema,{deliveryId:row.delivery_id,campaignId:row.campaign_id,memberId:row.member_id,recipientEmail:row.recipient_email,status:row.status,providerMessageId:row.provider_message_id,attempt:row.attempt,updatedAt:iso(row.updated_at)})))}
  async putSuppression(scope:PublicationRepositoryScope,input:Suppression):Promise<boolean>{const value=parsePublicationContract('suppression',SuppressionSchema,input);return await this.#authorized(scope,async(db)=>(await db`insert into fuma_publication_suppressions (platform_id,owner_key,owner_generation,profile_id,suppression_id,email_hash_sha256,reason,source_id,created_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.suppressionId},${value.emailHashSha256},${value.reason},${value.sourceId},${value.createdAt}) on conflict (platform_id,owner_key,owner_generation,profile_id,email_hash_sha256) do nothing`).rowCount===1)}
  async isSuppressed(scope:PublicationRepositoryScope,emailHashSha256:string):Promise<boolean>{return await this.#authorized(scope,async(db)=>(await db`select 1 from fuma_publication_suppressions where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and email_hash_sha256=${emailHashSha256}`).rowCount===1)}
  async issueUnsubscribeToken(scope:PublicationRepositoryScope,input:UnsubscribeTokenClaims):Promise<boolean>{const value=parsePublicationContract('unsubscribe claims',UnsubscribeTokenClaimsSchema,input);return await this.#authorized(scope,async(db)=>(await db`insert into fuma_publication_unsubscribe_tokens (platform_id,owner_key,owner_generation,profile_id,token_id,member_id,newsletter_id,issued_at,expires_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.tokenId},${value.memberId},${value.newsletterId},${value.issuedAt},${value.expiresAt}) on conflict do nothing`).rowCount===1)}
  async getUnsubscribeToken(scope:PublicationRepositoryScope,tokenId:string):Promise<UnsubscribeTokenClaims|null>{return await this.#authorized(scope,async(db)=>{const row=(await db<TokenRow>`select token_id,member_id,newsletter_id,issued_at,expires_at from fuma_publication_unsubscribe_tokens where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and token_id=${tokenId} and consumed_at is null`).rows[0];return row?parsePublicationContract('stored unsubscribe claims',UnsubscribeTokenClaimsSchema,{tokenId:row.token_id,memberId:row.member_id,newsletterId:row.newsletter_id,issuedAt:iso(row.issued_at),expiresAt:iso(row.expires_at)}):null})}
  async consumeUnsubscribeToken(scope:PublicationRepositoryScope,tokenId:string,consumedAt:string):Promise<UnsubscribeTokenClaims|null>{return await this.#authorized(scope,async(db)=>{const {rows}=await db<TokenRow>`update fuma_publication_unsubscribe_tokens set consumed_at=${consumedAt} where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and token_id=${tokenId} and consumed_at is null and expires_at>${consumedAt} returning token_id,member_id,newsletter_id,issued_at,expires_at`;const row=rows[0];return row?parsePublicationContract('stored unsubscribe claims',UnsubscribeTokenClaimsSchema,{tokenId:row.token_id,memberId:row.member_id,newsletterId:row.newsletter_id,issuedAt:iso(row.issued_at),expiresAt:iso(row.expires_at)}):null})}
  async consumeUnsubscribeAndSuppress(scope:PublicationRepositoryScope,tokenId:string,consumedAt:string,input:Suppression):Promise<UnsubscribeTokenClaims|null>{
    const suppression=parsePublicationContract('suppression',SuppressionSchema,input)
    return await this.#authorized(scope,async(db)=>{
      const {rows}=await db<TokenRow>`update fuma_publication_unsubscribe_tokens set consumed_at=${consumedAt} where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and token_id=${tokenId} and consumed_at is null and expires_at>${consumedAt} returning token_id,member_id,newsletter_id,issued_at,expires_at`
      const row=rows[0];if(!row)return null
      await db`insert into fuma_publication_suppressions (platform_id,owner_key,owner_generation,profile_id,suppression_id,email_hash_sha256,reason,source_id,created_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${suppression.suppressionId},${suppression.emailHashSha256},${suppression.reason},${suppression.sourceId},${suppression.createdAt}) on conflict (platform_id,owner_key,owner_generation,profile_id,email_hash_sha256) do nothing`
      await db`update fuma_publication_members set status='unsubscribed',updated_at=${consumedAt} where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_id=${row.member_id} and status not in ('blocked','unsubscribed')`
      return parsePublicationContract('stored unsubscribe claims',UnsubscribeTokenClaimsSchema,{tokenId:row.token_id,memberId:row.member_id,newsletterId:row.newsletter_id,issuedAt:iso(row.issued_at),expiresAt:iso(row.expires_at)})
    })
  }
  async appendProviderEvent(scope:PublicationRepositoryScope,event:OciEmailProviderEvent,payloadSha256:string):Promise<boolean>{return await this.#authorized(scope,async(db)=>(await db`insert into fuma_oci_email_provider_events (platform_id,owner_key,owner_generation,profile_id,event_id,event_type,provider_message_id,occurred_at,recipient_email,diagnostic_code,payload_sha256) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${event.eventId},${event.eventType},${event.providerMessageId},${event.occurredAt},${event.recipientEmail},${event.diagnosticCode},${payloadSha256}) on conflict do nothing`).rowCount===1)}
  async recordProviderEvent(scope:PublicationRepositoryScope,event:OciEmailProviderEvent,payloadSha256:string,input:Suppression|null):Promise<boolean>{
    const suppression=input===null?null:parsePublicationContract('suppression',SuppressionSchema,input)
    try{return await this.#authorized(scope,async(db)=>{
      const nextStatus=event.eventType==='accepted'?'submitted':event.eventType
      const delivery=await db`update fuma_publication_campaign_deliveries set status=case when status in ('bounced','complained','suppressed') then status when ${event.eventType}='accepted' and status in ('deferred','delivered') then status when ${event.eventType}='deferred' and status='delivered' then status else ${nextStatus} end,updated_at=greatest(updated_at,${event.occurredAt}) where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and provider_message_id=${event.providerMessageId} and lower(recipient_email)=lower(${event.recipientEmail})`
      if(delivery.rowCount!==1)throw new PublicationAtomicConflict()
      const created=await db`insert into fuma_oci_email_provider_events (platform_id,owner_key,owner_generation,profile_id,event_id,event_type,provider_message_id,occurred_at,recipient_email,diagnostic_code,payload_sha256) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${event.eventId},${event.eventType},${event.providerMessageId},${event.occurredAt},${event.recipientEmail},${event.diagnosticCode},${payloadSha256}) on conflict do nothing`
      if(created.rowCount!==1)throw new PublicationAtomicConflict()
      if(suppression)await db`insert into fuma_publication_suppressions (platform_id,owner_key,owner_generation,profile_id,suppression_id,email_hash_sha256,reason,source_id,created_at) values (${scope.platformId},${scope.ownerKey},${scope.generation},${scope.profileId},${suppression.suppressionId},${suppression.emailHashSha256},${suppression.reason},${suppression.sourceId},${suppression.createdAt}) on conflict (platform_id,owner_key,owner_generation,profile_id,email_hash_sha256) do nothing`
      return true
    })}catch(error){if(error instanceof PublicationAtomicConflict)return false;throw error}
  }
  async applyProviderEvent(scope:PublicationRepositoryScope,event:OciEmailProviderEvent):Promise<void>{const status=event.eventType==='accepted'?'submitted':event.eventType;await this.#authorized(scope,async(db)=>{await db`update fuma_publication_campaign_deliveries set status=${status},updated_at=${event.occurredAt} where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and provider_message_id=${event.providerMessageId}`})}
  async deliverabilitySummary(scope:PublicationRepositoryScope,from:string,to:string):Promise<DeliverabilitySummary>{return await this.#authorized(scope,async(db)=>{const row=(await db<DeliverySummaryRow>`select count(*) filter (where event_type='accepted') as submitted,count(*) filter (where event_type='delivered') as delivered,count(*) filter (where event_type='deferred') as deferred,count(*) filter (where event_type='bounced') as bounced,count(*) filter (where event_type='complained') as complained,(select count(*) from fuma_publication_campaign_deliveries d where d.platform_id=${scope.platformId} and d.owner_key=${scope.ownerKey} and d.owner_generation=${scope.generation} and d.profile_id=${scope.profileId} and d.status='suppressed' and d.updated_at>=${from} and d.updated_at<${to}) as suppressed from fuma_oci_email_provider_events where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and occurred_at>=${from} and occurred_at<${to}`).rows[0]??{submitted:0,delivered:0,deferred:0,bounced:0,complained:0,suppressed:0};const submitted=integer(row.submitted),delivered=integer(row.delivered),bounced=integer(row.bounced),complained=integer(row.complained);return parsePublicationContract('deliverability summary',DeliverabilitySummarySchema,{from,to,submitted,delivered,deferred:integer(row.deferred),bounced,complained,suppressed:integer(row.suppressed),deliveryRate:submitted===0?0:delivered/submitted,bounceRate:submitted===0?0:bounced/submitted,complaintRate:submitted===0?0:complained/submitted})})}
}
