import { createHmac } from 'node:crypto'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { ExpertDiscoveryError, ExpertSiteScopeSchema, parseExpertContract, type ExpertSiteScope } from './contracts'
import type {
  ExpertCurrentAuthority,
  ExpertDiscoveryAuthority,
  ExpertDiscoveryInvalidationPort,
  ExpertInquiryAbuseAuthority,
  ExpertModerationAuthority,
  ExpertPluginReviewAuthority,
  ExpertTransferAuthority,
  TrustedExpertRequest,
} from './service'

const Id = Type.String({ minLength: 1, maxLength: 255 })
const Timestamp = Type.String({ minLength: 20, maxLength: 35 })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const AuthorityRowSchema = Type.Object({
  user_id: Id,
  session_id: Id,
  impersonated_by: Type.Union([Id, Type.Null()]),
  session_created_at: Timestamp,
  session_expires_at: Timestamp,
  role: Type.Union([Type.String({ maxLength: 255 }), Type.Null()]),
  banned: Type.Union([Type.Boolean(), Type.Null()]),
  ban_expires: Type.Union([Timestamp, Type.Null()]),
  staff_profile: Type.Boolean(),
}, { additionalProperties: false })
const MembershipRowSchema = Type.Object({ organization_id: Id, role: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false })
const AttributionRowSchema = Type.Object({
  exact_scope: Type.Boolean(),
  submitter_member: Type.Boolean(),
  expert_member: Type.Boolean(),
  site_owner: Type.Boolean(),
}, { additionalProperties: false })
const ModerationRowSchema = Type.Object({ event: Type.String({ minLength: 1, maxLength: 32 }) }, { additionalProperties: false })
const PluginReviewRowSchema = Type.Object({
  publisher_organization_id: Id,
  verification_hash_sha256: Hash,
  publisher_memberships: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
const TransferRowSchema = Type.Object({
  platform_id: Id,
  destination_organization_id: Id,
  destination_workspace_id: Id,
  destination_site_id: Id,
  owner_key: Id,
  owner_generation: Type.Union([Type.String(), Type.Number(), Type.BigInt()]),
}, { additionalProperties: false })
const InvalidationSchema = Type.Object({
  expertId: Id,
  publicRevision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  reason: Type.Union([Type.Literal('approved'), Type.Literal('visibility'), Type.Literal('moderation'), Type.Literal('plugin-link'), Type.Literal('transfer')]),
}, { additionalProperties: false })

type AuthorityRow = Static<typeof AuthorityRowSchema>
type MembershipRow = Static<typeof MembershipRowSchema>

function parseRow<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new ExpertDiscoveryError('authority-denied', `${label} is malformed.`)
  return parsed.value
}
function activeAccount(row: AuthorityRow, now: Date): boolean {
  if (Date.parse(row.session_expires_at) <= now.getTime()) return false
  if (!row.banned) return true
  return row.ban_expires !== null && Date.parse(row.ban_expires) <= now.getTime()
}
function roles(value: string | null): readonly string[] { return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [] }

/** Resolves only the current canonical Better Auth session and persisted memberships. */
export class PostgresExpertDiscoveryAuthority implements ExpertDiscoveryAuthority {
  readonly #db: DbClient
  readonly #now: () => Date
  constructor(input: Readonly<{ db: DbClient; now?: () => Date }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted expert authority requires PostgreSQL.')
    this.#db = input.db
    this.#now = input.now ?? (() => new Date())
  }

  async resolve(request: TrustedExpertRequest): Promise<ExpertCurrentAuthority> {
    const source = request.context.source
    if (source.kind !== 'staff-session') throw new ExpertDiscoveryError('authority-denied', 'A current Better Auth staff session is required.')
    const result = await this.#db<AuthorityRow>`
      select account.id user_id, session.id session_id, session.impersonated_by,
        session.created_at::text session_created_at, session.expires_at::text session_expires_at,
        account.role, account.banned, account.ban_expires::text ban_expires,
        exists(select 1 from auth_staff_profiles staff where staff.user_id=account.id) staff_profile
      from auth_users account join auth_sessions session on session.user_id=account.id
      where account.id=${source.userId} and session.id=${source.sessionId}
    `
    if (result.rows.length !== 1) throw new ExpertDiscoveryError('authority-denied', 'Current Better Auth session is unavailable.')
    const row = parseRow(AuthorityRowSchema, result.rows[0], 'Stored expert session authority')
    if (!activeAccount(row, this.#now()) || row.impersonated_by !== source.impersonatedBy) throw new ExpertDiscoveryError('authority-denied', 'Current Better Auth session is inactive or changed.')
    const memberships = await this.#db<MembershipRow>`select organization_id,role from auth_members where user_id=${row.user_id} order by organization_id`
    const parsedMemberships = memberships.rows.map((item) => parseRow(MembershipRowSchema, item, 'Stored expert membership authority'))
    const managedOrganizationIds = parsedMemberships.filter(({ role }) => role === 'owner' || role === 'admin').map(({ organization_id }) => organization_id)
    const internalReviewer = row.staff_profile && roles(row.role).includes('admin')
    return Object.freeze({
      actorId: row.user_id,
      sessionId: row.session_id,
      direct: row.impersonated_by === null,
      stepUpAt: new Date(row.session_created_at).toISOString(),
      managedOrganizationIds: Object.freeze(managedOrganizationIds),
      capabilities: Object.freeze([
        ...(managedOrganizationIds.includes(request.scope.organizationId) ? ['experts.manage'] : []),
        ...(internalReviewer ? ['internal.experts.approve', 'internal.experts.read'] : []),
      ]),
    })
  }

  async verifyAttribution(input: Parameters<ExpertDiscoveryAuthority['verifyAttribution']>[0]): Promise<void> {
    const scope = input.sourceScope
    const result = await this.#db<Static<typeof AttributionRowSchema>>`
      select
        exists(select 1 from fuma_tenant_owner_keys owner
          join fuma_sites site on site.organization_id=owner.organization_id and site.workspace_id=owner.workspace_id and site.id=owner.site_id
          where owner.platform_id=${scope.platformId} and owner.organization_id=${scope.organizationId}
            and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
            and owner.owner_key=${scope.ownerKey} and owner.generation=${scope.ownerGeneration}
            and owner.state='active' and site.status='active' and site.profile_id in ('website','publication')) exact_scope,
        exists(select 1 from auth_members member where member.organization_id=${scope.organizationId} and member.user_id=${input.submitterId}) submitter_member,
        exists(select 1 from auth_members member where member.organization_id=${scope.organizationId} and member.user_id=${input.expertConsentPartyId}) expert_member,
        (exists(select 1 from auth_members member where member.organization_id=${scope.organizationId} and member.user_id=${input.siteOwnerConsentPartyId} and member.role='owner')
          or exists(select 1 from fuma_organization_bootstrap_receipts receipt where receipt.organization_id=${scope.organizationId} and receipt.owner_user_id=${input.siteOwnerConsentPartyId})) site_owner
    `
    const row = parseRow(AttributionRowSchema, result.rows[0], 'Stored expert attribution authority')
    if (!row.exact_scope || !row.submitter_member || !row.expert_member || !row.site_owner) {
      throw new ExpertDiscoveryError('authority-denied', 'Current expert and site-owner attribution could not be revalidated.')
    }
  }
}

/** Reads the latest immutable FUMA-072 moderation transition for the globally unique expert ID. */
export class PostgresExpertModerationAuthority implements ExpertModerationAuthority {
  readonly #db: DbClient
  constructor(db: DbClient) { if (db.dialect !== 'postgres') throw new TypeError('Hosted expert moderation requires PostgreSQL.'); this.#db = db }
  async suspended(expertId: string): Promise<boolean> {
    const result = await this.#db<Static<typeof ModerationRowSchema>>`
      select event from fuma_moderation_evidence_v2
      where subject_kind='expert' and subject_id=${expertId}
      order by created_at desc,evidence_id desc limit 1
    `
    if (!result.rows[0]) return false
    return parseRow(ModerationRowSchema, result.rows[0], 'Stored expert moderation authority').event === 'suspended'
  }
}

/** Requires one current signed FUMA-068 plugin review and one unambiguous publisher membership. */
export class PostgresExpertPluginReviewAuthority implements ExpertPluginReviewAuthority {
  readonly #db: DbClient
  constructor(db: DbClient) { if (db.dialect !== 'postgres') throw new TypeError('Hosted expert plugin review requires PostgreSQL.'); this.#db = db }
  async approved(pluginId: string) {
    const result = await this.#db<Static<typeof PluginReviewRowSchema>>`
      select min(member.organization_id) publisher_organization_id,
        decision.signature_payload_hash_sha256 verification_hash_sha256,
        count(distinct member.organization_id)::integer publisher_memberships
      from fuma_artifact_review_submissions_v2 submission
      join fuma_artifact_review_decisions_v2 decision on decision.submission_id=submission.submission_id
        and decision.artifact_id=submission.artifact_id and decision.content_hash_sha256=submission.content_hash_sha256
      join auth_members member on member.user_id=submission.submitter_id and member.role in ('owner','admin')
      left join fuma_artifact_review_revocations_v2 revocation on revocation.decision_id=decision.decision_id
      where submission.artifact_kind='plugin' and submission.package_id=${pluginId} and submission.scan_state='clean'
        and decision.decision='approved' and decision.signature_payload_hash_sha256 is not null
        and decision.signature_value is not null and revocation.decision_id is null
      group by decision.decision_id,decision.signature_payload_hash_sha256,decision.decided_at
      order by decision.decided_at desc limit 1
    `
    if (!result.rows[0]) return null
    const row = parseRow(PluginReviewRowSchema, result.rows[0], 'Stored expert plugin review authority')
    return row.publisher_memberships === 1
      ? Object.freeze({ publisherOrganizationId: row.publisher_organization_id, verificationHashSha256: row.verification_hash_sha256 })
      : null
  }
}

/** Resolves only a completed FUMA-074 transfer and its current destination owner generation. */
export class PostgresExpertTransferAuthority implements ExpertTransferAuthority {
  readonly #db: DbClient
  constructor(db: DbClient) { if (db.dialect !== 'postgres') throw new TypeError('Hosted expert transfer requires PostgreSQL.'); this.#db = db }
  async resolveDestination(input: Parameters<ExpertTransferAuthority['resolveDestination']>[0]): Promise<ExpertSiteScope | null> {
    const source = input.source
    const result = await this.#db<Static<typeof TransferRowSchema>>`
      select proposal.platform_id,proposal.destination_organization_id,proposal.destination_workspace_id,
        proposal.destination_site_id,owner.owner_key,owner.generation owner_generation
      from fuma_site_transfer_proposals proposal
      join fuma_tenant_owner_keys owner on owner.platform_id=proposal.platform_id
        and owner.organization_id=proposal.destination_organization_id
        and owner.workspace_id=proposal.destination_workspace_id and owner.site_id=proposal.destination_site_id
      where proposal.platform_id=${source.platformId} and proposal.id=${input.transferId}
        and proposal.source_organization_id=${source.organizationId} and proposal.source_workspace_id=${source.workspaceId}
        and proposal.source_site_id=${source.siteId} and proposal.state='completed' and proposal.completed_at is not null
        and owner.state='active' and owner.generation>${source.ownerGeneration}
      order by owner.generation desc limit 1
    `
    if (!result.rows[0]) return null
    const row = parseRow(TransferRowSchema, result.rows[0], 'Stored expert transfer authority')
    const ownerGeneration = Number(row.owner_generation)
    return parseExpertContract(ExpertSiteScopeSchema, {
      platformId: row.platform_id,
      organizationId: row.destination_organization_id,
      workspaceId: row.destination_workspace_id,
      siteId: row.destination_site_id,
      ownerKey: row.owner_key,
      ownerGeneration,
    }, 'resolved expert transfer destination')
  }
}

/** Produces a secret-peppered sender digest and enforces a bounded PostgreSQL window. */
export class PostgresExpertInquiryAbuseAuthority implements ExpertInquiryAbuseAuthority {
  readonly #db: DbClient
  readonly #pepper: string
  constructor(input: Readonly<{ db: DbClient; pepper: string }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted expert inquiry abuse authority requires PostgreSQL.')
    if (Buffer.byteLength(input.pepper, 'utf8') < 32) throw new TypeError('Expert inquiry fingerprint pepper must contain at least 32 bytes.')
    this.#db = input.db; this.#pepper = input.pepper
  }
  async resolve(request: TrustedExpertRequest) {
    const source = request.context.source
    if (source.kind !== 'staff-session') return Object.freeze({ senderFingerprintSha256: '0'.repeat(64), blocked: true })
    const fingerprint = createHmac('sha256', this.#pepper).update(JSON.stringify([source.userId, request.scope.organizationId])).digest('hex')
    const result = await this.#db<{ count: string | number | bigint }>`select count(*) count from fuma_expert_inquiries where sender_fingerprint_sha256=${fingerprint} and created_at>current_timestamp-interval '15 minutes'`
    const count = Number(result.rows[0]?.count ?? Number.NaN)
    return Object.freeze({ senderFingerprintSha256: fingerprint, blocked: !Number.isSafeInteger(count) || count >= 5 })
  }
}

/** Emits bounded PostgreSQL notifications; expert/public-web paths are no-store and dynamically rendered. */
export class PostgresExpertDiscoveryInvalidationPort implements ExpertDiscoveryInvalidationPort {
  readonly #db: DbClient
  constructor(db: DbClient) { if (db.dialect !== 'postgres') throw new TypeError('Hosted expert invalidation requires PostgreSQL.'); this.#db = db }
  async publish(input: Parameters<ExpertDiscoveryInvalidationPort['publish']>[0]): Promise<void> {
    const value = parseRow(InvalidationSchema, input, 'Expert invalidation event')
    const result = await this.#db`select pg_notify('fuma_expert_discovery',${JSON.stringify(value)})`
    if (result.rowCount !== 1) throw new ExpertDiscoveryError('storage-denied', 'Expert invalidation could not be published.')
  }
}
