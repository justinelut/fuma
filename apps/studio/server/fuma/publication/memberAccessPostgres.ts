import {
  PublicationMemberAccessSchema,
  PublicationMemberAccountSchema,
  PublicationMemberSegmentSchema,
  PublicationNewsletterConsentEventSchema,
  PublicationPrivacyRequestSchema,
  PublicationSegmentMembershipSnapshotSchema,
  parsePublicationContract,
  type PublicationMemberAccess,
  type PublicationMemberAccount,
  type PublicationMemberSegment,
  type PublicationNewsletterConsentEvent,
  type PublicationPrivacyRequest,
  type PublicationSegmentMembershipSnapshot,
} from '@core/fuma/publication'
import type { DbClient } from '../../db/client'
import type { PublicationRepositoryScope } from './scope'
import { PublicationScopeError } from './scope'
import type { PublicationMemberAccessRepository, PublicationMemberPage } from './memberAccess'

interface AccountRow {
  account_id: string
  member_identity_id: string
  member_id: string
  display_name: string
  locale: string
  timezone: string
  state: string
  created_at: string | Date
  updated_at: string | Date
  deleted_at: string | Date | null
}
interface ConsentRow {
  event_id: string
  account_id: string
  member_id: string
  newsletter_id: string | null
  action: string
  source: string
  notice_version: string
  source_receipt_id: string | null
  occurred_at: string | Date
}
interface SegmentRow {
  segment_id: string
  name: string
  kind: string
  match_kind: string
  rules_json: unknown
  explicit_member_ids_json: unknown
  version: string | number | bigint
  recalculated_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}
interface MembershipRow {
  segment_id: string
  member_id: string
  segment_version: string | number | bigint
  calculated_at: string | Date
}
interface AccessRow {
  access_id: string
  member_id: string
  source: string
  state: string
  resource_kind: string
  resource_id: string
  access: string
  starts_at: string | Date
  expires_at: string | Date | null
  grace_ends_at: string | Date | null
  payment_reference_sha256: string | null
  created_at: string | Date
  updated_at: string | Date
}
interface PrivacyRow {
  request_id: string
  account_id: string
  member_id: string
  kind: string
  state: string
  requested_by: string
  reason: string
  created_at: string | Date
  completed_at: string | Date | null
}

function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}
function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : structuredClone(value)
}
function integer(value: string | number | bigint): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('Stored member access version is invalid.')
  return parsed
}

class PublicationMemberAtomicConflict extends Error {}

export class PostgresPublicationMemberAccessRepository implements PublicationMemberAccessRepository {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }

  async #authorized<T>(scope: PublicationRepositoryScope, work: (db: DbClient) => Promise<T>): Promise<T> {
    return await this.#db.transaction(async (db) => {
      const authority = await db`select 1 from fuma_tenant_owner_keys where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and generation=${scope.generation} and state='active' and transfer_id is null and transfer_lock_id is null and transfer_fence is null for share`
      if (authority.rowCount !== 1) throw new PublicationScopeError()
      return await work(db)
    })
  }

  #account(row: AccountRow): PublicationMemberAccount {
    return parsePublicationContract('stored member account', PublicationMemberAccountSchema, {
      accountId: row.account_id,
      memberIdentityId: row.member_identity_id,
      memberId: row.member_id,
      displayName: row.display_name,
      locale: row.locale,
      timezone: row.timezone,
      state: row.state,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deletedAt: iso(row.deleted_at),
    })
  }

  #consent(row: ConsentRow): PublicationNewsletterConsentEvent {
    return parsePublicationContract('stored newsletter consent', PublicationNewsletterConsentEventSchema, {
      eventId: row.event_id,
      accountId: row.account_id,
      memberId: row.member_id,
      newsletterId: row.newsletter_id,
      action: row.action,
      source: row.source,
      noticeVersion: row.notice_version,
      sourceReceiptId: row.source_receipt_id,
      occurredAt: iso(row.occurred_at),
    })
  }

  #segment(row: SegmentRow): PublicationMemberSegment {
    return parsePublicationContract('stored member segment', PublicationMemberSegmentSchema, {
      segmentId: row.segment_id,
      name: row.name,
      kind: row.kind,
      match: row.match_kind,
      rules: json(row.rules_json),
      explicitMemberIds: json(row.explicit_member_ids_json),
      version: integer(row.version),
      recalculatedAt: iso(row.recalculated_at),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })
  }

  #access(row: AccessRow): PublicationMemberAccess {
    return parsePublicationContract('stored member access', PublicationMemberAccessSchema, {
      accessId: row.access_id,
      memberId: row.member_id,
      source: row.source,
      state: row.state,
      resourceKind: row.resource_kind,
      resourceId: row.resource_id,
      access: row.access,
      startsAt: iso(row.starts_at),
      expiresAt: iso(row.expires_at),
      graceEndsAt: iso(row.grace_ends_at),
      paymentReferenceSha256: row.payment_reference_sha256,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    })
  }

  #privacy(row: PrivacyRow): PublicationPrivacyRequest {
    return parsePublicationContract('stored privacy request', PublicationPrivacyRequestSchema, {
      requestId: row.request_id,
      accountId: row.account_id,
      memberId: row.member_id,
      kind: row.kind,
      state: row.state,
      requestedBy: row.requested_by,
      reason: row.reason,
      createdAt: iso(row.created_at),
      completedAt: iso(row.completed_at),
    })
  }

  async putAccount(scope: PublicationRepositoryScope, input: PublicationMemberAccount, expectedUpdatedAt: string | null): Promise<boolean> {
    const value = parsePublicationContract('member account', PublicationMemberAccountSchema, input)
    return await this.#authorized(scope, async (db) => expectedUpdatedAt === null
      ? (await db`insert into fuma_publication_member_accounts (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,account_id,member_identity_id,member_id,display_name,locale,timezone,state,created_at,updated_at,deleted_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.accountId},${value.memberIdentityId},${value.memberId},${value.displayName},${value.locale},${value.timezone},${value.state},${value.createdAt},${value.updatedAt},${value.deletedAt}) on conflict do nothing`).rowCount === 1
      : (await db`update fuma_publication_member_accounts set display_name=${value.displayName},locale=${value.locale},timezone=${value.timezone},state=${value.state},updated_at=${value.updatedAt},deleted_at=${value.deletedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and account_id=${value.accountId} and member_identity_id=${value.memberIdentityId} and member_id=${value.memberId} and updated_at=${expectedUpdatedAt}`).rowCount === 1)
  }

  async getAccount(scope: PublicationRepositoryScope, accountId: string): Promise<PublicationMemberAccount | null> {
    return await this.#authorized(scope, async (db) => {
      const row = (await db<AccountRow>`select account_id,member_identity_id,member_id,display_name,locale,timezone,state,created_at,updated_at,deleted_at from fuma_publication_member_accounts where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and account_id=${accountId}`).rows[0]
      return row ? this.#account(row) : null
    })
  }

  async getAccountByIdentity(scope: PublicationRepositoryScope, identityId: string): Promise<PublicationMemberAccount | null> {
    return await this.#authorized(scope, async (db) => {
      const row = (await db<AccountRow>`select account_id,member_identity_id,member_id,display_name,locale,timezone,state,created_at,updated_at,deleted_at from fuma_publication_member_accounts where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_identity_id=${identityId}`).rows[0]
      return row ? this.#account(row) : null
    })
  }

  async listAccounts(scope: PublicationRepositoryScope, page: PublicationMemberPage = { limit: 100, afterId: null }): Promise<readonly PublicationMemberAccount[]> {
    return await this.#authorized(scope, async (db) => (await db<AccountRow>`select account_id,member_identity_id,member_id,display_name,locale,timezone,state,created_at,updated_at,deleted_at from fuma_publication_member_accounts where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and (${page.afterId}::text is null or account_id>${page.afterId}) order by account_id limit ${page.limit}`).rows.map((row) => this.#account(row)))
  }

  async appendConsent(scope: PublicationRepositoryScope, input: PublicationNewsletterConsentEvent): Promise<boolean> {
    const value = parsePublicationContract('newsletter consent event', PublicationNewsletterConsentEventSchema, input)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_newsletter_consent_events (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,event_id,account_id,member_id,newsletter_id,action,source,notice_version,source_receipt_id,occurred_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.eventId},${value.accountId},${value.memberId},${value.newsletterId},${value.action},${value.source},${value.noticeVersion},${value.sourceReceiptId},${value.occurredAt}) on conflict do nothing`).rowCount === 1)
  }

  async listConsents(scope: PublicationRepositoryScope, memberId: string, limit = 1000): Promise<readonly PublicationNewsletterConsentEvent[]> {
    return await this.#authorized(scope, async (db) => (await db<ConsentRow>`select event_id,account_id,member_id,newsletter_id,action,source,notice_version,source_receipt_id,occurred_at from fuma_publication_newsletter_consent_events where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_id=${memberId} order by occurred_at,event_id limit ${limit}`).rows.map((row) => this.#consent(row)))
  }

  async putMemberSegment(scope: PublicationRepositoryScope, input: PublicationMemberSegment, expectedVersion: number | null): Promise<boolean> {
    const value = parsePublicationContract('member segment', PublicationMemberSegmentSchema, input)
    return await this.#authorized(scope, async (db) => expectedVersion === null
      ? (await db`insert into fuma_publication_member_segments (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,segment_id,name,kind,match_kind,rules_json,explicit_member_ids_json,version,recalculated_at,created_at,updated_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.segmentId},${value.name},${value.kind},${value.match},${JSON.stringify(value.rules)},${JSON.stringify(value.explicitMemberIds)},${value.version},${value.recalculatedAt},${value.createdAt},${value.updatedAt}) on conflict do nothing`).rowCount === 1
      : (await db`update fuma_publication_member_segments set name=${value.name},kind=${value.kind},match_kind=${value.match},rules_json=${JSON.stringify(value.rules)},explicit_member_ids_json=${JSON.stringify(value.explicitMemberIds)},version=${value.version},recalculated_at=${value.recalculatedAt},updated_at=${value.updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and segment_id=${value.segmentId} and version=${expectedVersion}`).rowCount === 1)
  }

  async getMemberSegment(scope: PublicationRepositoryScope, segmentId: string): Promise<PublicationMemberSegment | null> {
    return await this.#authorized(scope, async (db) => {
      const row = (await db<SegmentRow>`select segment_id,name,kind,match_kind,rules_json,explicit_member_ids_json,version,recalculated_at,created_at,updated_at from fuma_publication_member_segments where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and segment_id=${segmentId}`).rows[0]
      return row ? this.#segment(row) : null
    })
  }

  async listMemberSegments(scope: PublicationRepositoryScope, page: PublicationMemberPage = { limit: 100, afterId: null }): Promise<readonly PublicationMemberSegment[]> {
    return await this.#authorized(scope, async (db) => (await db<SegmentRow>`select segment_id,name,kind,match_kind,rules_json,explicit_member_ids_json,version,recalculated_at,created_at,updated_at from fuma_publication_member_segments where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and (${page.afterId}::text is null or segment_id>${page.afterId}) order by segment_id limit ${page.limit}`).rows.map((row) => this.#segment(row)))
  }

  async replaceSegmentSnapshot(scope: PublicationRepositoryScope, input: PublicationSegmentMembershipSnapshot): Promise<boolean> {
    const value = parsePublicationContract('segment snapshot', PublicationSegmentMembershipSnapshotSchema, input)
    return await this.#authorized(scope, async (db) => {
      const updated = await db`update fuma_publication_member_segments set recalculated_at=${value.calculatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and segment_id=${value.segmentId} and version=${value.segmentVersion}`
      if (updated.rowCount !== 1) return false
      await db`delete from fuma_publication_segment_memberships where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and segment_id=${value.segmentId}`
      for (const memberId of value.memberIds) {
        await db`insert into fuma_publication_segment_memberships (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,segment_id,member_id,segment_version,calculated_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.segmentId},${memberId},${value.segmentVersion},${value.calculatedAt})`
      }
      return true
    })
  }

  async listMemberSegmentSnapshots(scope: PublicationRepositoryScope, memberId: string, limit = 1000): Promise<readonly PublicationSegmentMembershipSnapshot[]> {
    return await this.#authorized(scope, async (db) => (await db<MembershipRow>`select segment_id,member_id,segment_version,calculated_at from fuma_publication_segment_memberships where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_id=${memberId} order by segment_id limit ${limit}`).rows.map((row) => parsePublicationContract('stored segment snapshot', PublicationSegmentMembershipSnapshotSchema, {
      segmentId: row.segment_id,
      segmentVersion: integer(row.segment_version),
      memberIds: [row.member_id],
      calculatedAt: iso(row.calculated_at),
    })))
  }

  async putAccess(scope: PublicationRepositoryScope, input: PublicationMemberAccess): Promise<boolean> {
    const value = parsePublicationContract('member access', PublicationMemberAccessSchema, input)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_member_access (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,access_id,member_id,source,state,resource_kind,resource_id,access,starts_at,expires_at,grace_ends_at,payment_reference_sha256,created_at,updated_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.accessId},${value.memberId},${value.source},${value.state},${value.resourceKind},${value.resourceId},${value.access},${value.startsAt},${value.expiresAt},${value.graceEndsAt},${value.paymentReferenceSha256},${value.createdAt},${value.updatedAt}) on conflict do nothing`).rowCount === 1)
  }

  async getAccess(scope: PublicationRepositoryScope, accessId: string): Promise<PublicationMemberAccess | null> {
    return await this.#authorized(scope, async (db) => {
      const row = (await db<AccessRow>`select access_id,member_id,source,state,resource_kind,resource_id,access,starts_at,expires_at,grace_ends_at,payment_reference_sha256,created_at,updated_at from fuma_publication_member_access where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and access_id=${accessId}`).rows[0]
      return row ? this.#access(row) : null
    })
  }

  async updateAccessState(scope: PublicationRepositoryScope, accessId: string, memberId: string, state: PublicationMemberAccess['state'], updatedAt: string): Promise<boolean> {
    return await this.#authorized(scope, async (db) => (await db`update fuma_publication_member_access set state=${state},updated_at=${updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and access_id=${accessId} and member_id=${memberId} and updated_at<=${updatedAt}`).rowCount === 1)
  }

  async listAccess(scope: PublicationRepositoryScope, memberId: string, limit = 1000): Promise<readonly PublicationMemberAccess[]> {
    return await this.#authorized(scope, async (db) => (await db<AccessRow>`select access_id,member_id,source,state,resource_kind,resource_id,access,starts_at,expires_at,grace_ends_at,payment_reference_sha256,created_at,updated_at from fuma_publication_member_access where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_id=${memberId} order by created_at,access_id limit ${limit}`).rows.map((row) => this.#access(row)))
  }

  async putPrivacyRequest(scope: PublicationRepositoryScope, input: PublicationPrivacyRequest): Promise<boolean> {
    const value = parsePublicationContract('privacy request', PublicationPrivacyRequestSchema, input)
    return await this.#authorized(scope, async (db) => (await db`insert into fuma_publication_privacy_requests (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,request_id,account_id,member_id,kind,state,requested_by,reason,created_at,completed_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.requestId},${value.accountId},${value.memberId},${value.kind},${value.state},${value.requestedBy},${value.reason},${value.createdAt},${value.completedAt}) on conflict do nothing`).rowCount === 1)
  }

  async getPrivacyRequest(scope: PublicationRepositoryScope, requestId: string): Promise<PublicationPrivacyRequest | null> {
    return await this.#authorized(scope, async (db) => {
      const row = (await db<PrivacyRow>`select request_id,account_id,member_id,kind,state,requested_by,reason,created_at,completed_at from fuma_publication_privacy_requests where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and request_id=${requestId}`).rows[0]
      return row ? this.#privacy(row) : null
    })
  }

  async beginDeletion(scope: PublicationRepositoryScope, input: PublicationPrivacyRequest, account: PublicationMemberAccount, expectedUpdatedAt: string): Promise<boolean> {
    const request = parsePublicationContract('privacy request', PublicationPrivacyRequestSchema, input)
    const pending = parsePublicationContract('member account', PublicationMemberAccountSchema, account)
    try {
      return await this.#authorized(scope, async (db) => {
        const inserted = await db`insert into fuma_publication_privacy_requests (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,request_id,account_id,member_id,kind,state,requested_by,reason,created_at,completed_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${request.requestId},${request.accountId},${request.memberId},${request.kind},${request.state},${request.requestedBy},${request.reason},${request.createdAt},${request.completedAt}) on conflict do nothing`
        if (inserted.rowCount !== 1) throw new PublicationMemberAtomicConflict()
        const changed = await db`update fuma_publication_member_accounts set state=${pending.state},updated_at=${pending.updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and account_id=${pending.accountId} and member_identity_id=${pending.memberIdentityId} and member_id=${pending.memberId} and state in ('active','disabled') and updated_at=${expectedUpdatedAt}`
        if (changed.rowCount !== 1) throw new PublicationMemberAtomicConflict()
        return true
      })
    } catch (error) {
      if (error instanceof PublicationMemberAtomicConflict) return false
      throw error
    }
  }

  async completeDeletion(scope: PublicationRepositoryScope, input: PublicationPrivacyRequest, account: PublicationMemberAccount): Promise<boolean> {
    const request = parsePublicationContract('privacy request', PublicationPrivacyRequestSchema, input)
    const deleted = parsePublicationContract('member account', PublicationMemberAccountSchema, account)
    try {
      return await this.#authorized(scope, async (db) => {
        const updated = await db`update fuma_publication_privacy_requests set state='completed',completed_at=${request.completedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and request_id=${request.requestId} and account_id=${request.accountId} and member_id=${request.memberId} and kind='deletion' and state in ('pending','processing')`
        if (updated.rowCount !== 1) throw new PublicationMemberAtomicConflict()
        const changed = await db`update fuma_publication_member_accounts set display_name='',locale='und',timezone='Etc/UTC',state='deleted',updated_at=${deleted.updatedAt},deleted_at=${deleted.deletedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and account_id=${deleted.accountId} and member_identity_id=${deleted.memberIdentityId} and member_id=${deleted.memberId} and state='deletion-pending'`
        if (changed.rowCount !== 1) throw new PublicationMemberAtomicConflict()
        await db`delete from fuma_publication_segment_memberships where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_id=${deleted.memberId}`
        await db`update fuma_publication_member_access set state='revoked',updated_at=${deleted.updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_id=${deleted.memberId}`
        const erasedEmail = `deleted-${deleted.accountId}@deleted.invalid`
        const erasedMember = await db`update fuma_publication_members set normalized_email=${erasedEmail},name='',status='blocked',account_id=null,attributes_json=${JSON.stringify({})},updated_at=${deleted.updatedAt} where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_id=${deleted.memberId}`
        if (erasedMember.rowCount !== 1) throw new PublicationMemberAtomicConflict()
        await db`update fuma_member_sessions set revoked_at=${deleted.updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_identity_id=${deleted.memberIdentityId} and revoked_at is null`
        const erasedIdentity = await db`update fuma_member_identities set normalized_email=${erasedEmail},display_name='',password_hash=case when origin='self-signup' then ${`erased:${deleted.accountId}:no-credential`} else null end,state=case when origin='staff-import' then 'activation-required' else 'disabled' end,updated_at=${deleted.updatedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_identity_id=${deleted.memberIdentityId}`
        if (erasedIdentity.rowCount !== 1) throw new PublicationMemberAtomicConflict()
        return true
      })
    } catch (error) {
      if (error instanceof PublicationMemberAtomicConflict) return false
      throw error
    }
  }
}
