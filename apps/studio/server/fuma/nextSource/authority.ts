import type { NextSourceAdaptationAuthorityPort, NextSourceOwnerConfirmationPort } from '@core/siteImport/nextSourceAdaptation'
import type { NextSourceFixAuthority } from '@core/siteImport'
import { FUMA_STAFF_FRESH_SESSION_SECONDS, type HostedResolvedSession } from '../../auth/hosted/auth'
import type { DbClient } from '../../db/client'
import type { FumaRequestContext } from '../context'
import type { NextSourceScope } from './postgres'

type ReplayRow = Readonly<{ receipt_id: string }>
type AuthorityRow = Readonly<{ accepted: boolean }>
type OwnerRow = Readonly<{
  generation: string | number | bigint
  organization_role: string | null
  workspace_access: string | null
  workspace_role: string | null
}>

function exact(authority: NextSourceFixAuthority, scope: NextSourceScope): boolean {
  return authority.destination.organizationId === scope.organizationId
    && authority.destination.workspaceId === scope.workspaceId
    && authority.destination.siteId === scope.siteId
    && authority.ownerGeneration === scope.ownerGeneration
}

/** Reads existing FUMA-065/FUMA-066 durable authority; it creates no parallel AI or MCP session. */
export class PostgresNextSourceAdaptationAuthority implements NextSourceAdaptationAuthorityPort {
  readonly #db: DbClient
  readonly #scope: NextSourceScope

  constructor(input: Readonly<{ db: DbClient; scope: NextSourceScope }>) {
    this.#db = input.db
    this.#scope = input.scope
  }

  async authorize(authority: NextSourceFixAuthority) {
    if (!exact(authority, this.#scope) || authority.capability !== 'source.mutate') {
      return Object.freeze({ replayReceiptId: null, active: false, meteringAccepted: false })
    }
    const replay = await this.#db.unsafe<ReplayRow>(`select receipt_id from fuma_next_source_fixes_v1 where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4 and owner_key=$5 and owner_generation=$6 and profile_id=$7 and operation_id=$8`, [
      this.#scope.platformId,
      this.#scope.organizationId,
      this.#scope.workspaceId,
      this.#scope.siteId,
      this.#scope.ownerKey,
      this.#scope.ownerGeneration,
      this.#scope.profileId,
      authority.operationId,
    ])
    if (replay.rows[0]) {
      return Object.freeze({ replayReceiptId: replay.rows[0].receipt_id, active: true, meteringAccepted: true })
    }
    if (authority.kind === 'deterministic') {
      const active = authority.actorId === 'fuma-next-source-policy' && authority.meteringReservationId === null
      return Object.freeze({ replayReceiptId: null, active, meteringAccepted: active })
    }
    if (authority.meteringReservationId === null) {
      return Object.freeze({ replayReceiptId: null, active: false, meteringAccepted: false })
    }

    const result = authority.kind === 'ai'
      ? await this.#db.unsafe<AuthorityRow>(`
          select true accepted
          from fuma_site_ai_tool_receipts tool
          join fuma_site_ai_turn_jobs job on job.job_id=tool.job_id
          join fuma_tenant_owner_keys owner
            on owner.platform_id=job.platform_id and owner.owner_key=job.owner_key
            and owner.organization_id=job.organization_id and owner.workspace_id=job.workspace_id
            and owner.site_id=job.site_id and owner.generation=job.owner_generation
          where tool.tool_call_id=$1 and job.actor_id=$2
            and job.platform_id=$3 and job.organization_id=$4 and job.workspace_id=$5
            and job.site_id=$6 and job.owner_key=$7 and job.owner_generation=$8 and job.profile_id=$9
            and tool.tool_name='site_propose_source_fix' and tool.mutates=true and tool.state='started'
            and job.state='running' and job.required_capability='ai.tools.write' and job.reservation_id=$10
            and owner.state='active' and owner.transfer_id is null and owner.transfer_fence is null
        `, [
          authority.operationId,
          authority.actorId,
          this.#scope.platformId,
          this.#scope.organizationId,
          this.#scope.workspaceId,
          this.#scope.siteId,
          this.#scope.ownerKey,
          this.#scope.ownerGeneration,
          this.#scope.profileId,
          authority.meteringReservationId,
        ])
      : await this.#db.unsafe<AuthorityRow>(`
          select true accepted
          from fuma_mcp_tool_receipts_v2 receipt
          join fuma_mcp_sessions_v2 session on session.session_id=receipt.session_id
          join fuma_mcp_connector_bindings_v2 binding on binding.connector_id=receipt.connector_id
          join fuma_tenant_owner_keys owner
            on owner.platform_id=binding.platform_id and owner.owner_key=binding.owner_key
            and owner.organization_id=binding.organization_id and owner.workspace_id=binding.workspace_id
            and owner.site_id=binding.site_id and owner.generation=binding.owner_generation
          where receipt.operation_id=$1 and binding.actor_id=$2
            and binding.platform_id=$3 and binding.organization_id=$4 and binding.workspace_id=$5
            and binding.site_id=$6 and binding.owner_key=$7 and binding.owner_generation=$8 and binding.profile_id=$9
            and receipt.tool_name='site_propose_source_fix' and receipt.capability='mutate'
            and receipt.reservation_id=$10 and receipt.state='started'
            and session.state='active' and session.expires_at>current_timestamp and binding.state='active'
            and owner.state='active' and owner.transfer_id is null and owner.transfer_fence is null
        `, [
          authority.operationId,
          authority.actorId,
          this.#scope.platformId,
          this.#scope.organizationId,
          this.#scope.workspaceId,
          this.#scope.siteId,
          this.#scope.ownerKey,
          this.#scope.ownerGeneration,
          this.#scope.profileId,
          authority.meteringReservationId,
        ])
    const active = result.rows.length === 1 && result.rows[0]?.accepted === true
    return Object.freeze({ replayReceiptId: null, active, meteringAccepted: active })
  }

  async settle(): Promise<void> {
    // Existing Site AI/MCP tool authorities settle their own reservations after
    // the server-resolved tool result is durably recorded. Import object bytes
    // are independently attributed through the canonical MeteringCollector.
  }
}

export class BetterAuthNextSourceOwnerConfirmation implements NextSourceOwnerConfirmationPort {
  readonly #db: DbClient
  readonly #context: FumaRequestContext
  readonly #headers: Headers
  readonly #resolve: (headers: Headers) => Promise<HostedResolvedSession | null>
  readonly #scope: NextSourceScope

  constructor(input: Readonly<{
    db: DbClient
    context: FumaRequestContext
    requestHeaders: Headers
    resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
    scope: NextSourceScope
  }>) {
    this.#db = input.db
    this.#context = input.context
    this.#headers = new Headers(input.requestHeaders)
    this.#resolve = input.resolveSession
    this.#scope = input.scope
  }

  async verifyOwner(input: Readonly<{
    receiptId: string
    actorId: string
    destination: { organizationId: string; workspaceId: string; siteId: string }
    expectedOwnerGeneration: number
  }>) {
    const actor = this.#context.actor
    const source = this.#context.source
    if (actor.kind !== 'staff' || source.kind !== 'staff-session') {
      return Object.freeze({ active: false, direct: false, impersonating: false, ownerGeneration: 0 })
    }
    const current = await this.#resolve(this.#headers)
    const direct = Boolean(
      current
      && actor.impersonator === null
      && source.impersonatedBy === null
      && current.impersonatedBy === null
      && source.userId === actor.userId
      && source.sessionId === actor.sessionId
      && current.userId === actor.userId
      && current.sessionId === actor.sessionId
      && input.actorId === actor.userId,
    )
    const sessionCreatedAt = current?.createdAt.getTime() ?? Number.NaN
    const sessionAgeMs = Date.now() - sessionCreatedAt
    const fresh = Number.isFinite(sessionCreatedAt)
      && sessionAgeMs >= 0
      && sessionAgeMs <= FUMA_STAFF_FRESH_SESSION_SECONDS * 1_000
    if (
      !direct
      || !fresh
      || input.destination.organizationId !== this.#scope.organizationId
      || input.destination.workspaceId !== this.#scope.workspaceId
      || input.destination.siteId !== this.#scope.siteId
    ) {
      return Object.freeze({
        active: false,
        direct,
        impersonating: Boolean(actor.impersonator || source.impersonatedBy || current?.impersonatedBy),
        ownerGeneration: 0,
      })
    }
    const rows = await this.#db.unsafe<OwnerRow>(`
      select owner.generation,membership.role organization_role,
        override.access workspace_access,override.role workspace_role
      from fuma_next_source_revisions_v1 revision
      join fuma_tenant_owner_keys owner
        on owner.platform_id=revision.platform_id and owner.owner_key=revision.owner_key
        and owner.organization_id=revision.organization_id and owner.workspace_id=revision.workspace_id
        and owner.site_id=revision.site_id and owner.generation=revision.owner_generation
      join fuma_sites site
        on site.organization_id=owner.organization_id and site.workspace_id=owner.workspace_id and site.id=owner.site_id
      join auth_sessions current_session on current_session.id=$2 and current_session.user_id=$1
      join auth_users current_user on current_user.id=current_session.user_id
      left join auth_members membership on membership.organization_id=owner.organization_id and membership.user_id=$1
      left join fuma_workspace_membership_overrides override on override.workspace_id=owner.workspace_id and override.user_id=$1
      where revision.revision_id=(select source_revision_id from fuma_next_source_fixes_v1 where receipt_id=$3)
        and owner.platform_id=$4 and owner.organization_id=$5 and owner.workspace_id=$6
        and owner.site_id=$7 and owner.owner_key=$8 and owner.generation=$9
        and owner.state='active' and owner.transfer_id is null and owner.transfer_fence is null
        and site.status='active' and site.profile_id=$10
        and current_session.expires_at>current_timestamp and current_session.impersonated_by is null
        and (current_user.banned is not true or (current_user.ban_expires is not null and current_user.ban_expires<=current_timestamp))
    `, [
      actor.userId,
      actor.sessionId,
      input.receiptId,
      this.#scope.platformId,
      this.#scope.organizationId,
      this.#scope.workspaceId,
      this.#scope.siteId,
      this.#scope.ownerKey,
      input.expectedOwnerGeneration,
      this.#scope.profileId,
    ])
    const row = rows.rows[0]
    const isOwner = row?.organization_role === 'owner'
      || (row?.workspace_access === 'grant' && row.workspace_role === 'owner')
    const generation = row ? Number(row.generation) : 0
    return Object.freeze({
      active: rows.rows.length === 1 && isOwner && generation === input.expectedOwnerGeneration,
      direct: true,
      impersonating: false,
      ownerGeneration: generation,
    })
  }
}
