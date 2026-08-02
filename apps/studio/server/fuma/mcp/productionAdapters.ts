import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import type { McpCreditAccountBinding, McpCreditAccountLocator } from './creditAdapter'
import type { McpConnector, McpScope } from './contracts'
import type { McpLiveAuthorityPort } from './service'

const LiveRowSchema = Type.Object({
  platform_id: Type.String({ minLength: 1 }),
  organization_id: Type.String({ minLength: 1 }),
  workspace_id: Type.String({ minLength: 1 }),
  site_id: Type.String({ minLength: 1 }),
  owner_key: Type.String({ minLength: 1 }),
  owner_generation: Type.Union([Type.String(), Type.Number(), Type.BigInt()]),
  profile_id: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
  owner_state: Type.String(),
  transfer_id: Type.Union([Type.String(), Type.Null()]),
  transfer_lock_id: Type.Union([Type.String(), Type.Null()]),
  transfer_fence: Type.Union([Type.String(), Type.Number(), Type.BigInt(), Type.Null()]),
  organization_status: Type.String(),
  workspace_status: Type.String(),
  site_status: Type.String(),
  membership_id: Type.Union([Type.String(), Type.Null()]),
  override_access: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false })

type LiveRow = typeof LiveRowSchema.static

function positiveInteger(value: string | number | bigint): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function scopeFrom(row: LiveRow): McpScope | null {
  const ownerGeneration = positiveInteger(row.owner_generation)
  if (ownerGeneration === null) return null
  return Object.freeze({
    platformId: row.platform_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    ownerKey: row.owner_key,
    ownerGeneration,
    profileId: row.profile_id,
  })
}

/** Revalidates current owner generation, transfer state, site state, and actor membership on every MCP phase. */
export class PostgresMcpLiveAuthority implements McpLiveAuthorityPort {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted MCP live authority requires PostgreSQL.')
    this.#db = db
  }

  async load(connector: McpConnector): Promise<Readonly<{
    active: boolean
    actorId: string
    scope: McpScope
    revision: number
  }> | null> {
    const expected = connector.scope
    const result = await this.#db.unsafe<LiveRow>(`
      select owner.platform_id, owner.organization_id, owner.workspace_id,
        owner.site_id, owner.owner_key, owner.generation as owner_generation,
        site.profile_id, owner.state as owner_state, owner.transfer_id,
        owner.transfer_lock_id, owner.transfer_fence,
        organization.status as organization_status,
        workspace.status as workspace_status, site.status as site_status,
        membership.id as membership_id, workspace_override.access as override_access
      from fuma_tenant_owner_keys owner
      join fuma_sites site
        on site.organization_id=owner.organization_id
        and site.workspace_id=owner.workspace_id and site.id=owner.site_id
      join fuma_workspaces workspace
        on workspace.organization_id=owner.organization_id and workspace.id=owner.workspace_id
      join fuma_organization_profiles organization
        on organization.organization_id=owner.organization_id
      left join auth_members membership
        on membership.organization_id=owner.organization_id and membership.user_id=$7
      left join fuma_workspace_membership_overrides workspace_override
        on workspace_override.workspace_id=owner.workspace_id and workspace_override.user_id=$7
      where owner.platform_id=$1 and owner.organization_id=$2 and owner.workspace_id=$3
        and owner.site_id=$4 and owner.owner_key=$5 and owner.generation=$6
    `, [
      expected.platformId,
      expected.organizationId,
      expected.workspaceId,
      expected.siteId,
      expected.ownerKey,
      expected.ownerGeneration,
      connector.actorId,
    ])
    if (result.rows.length !== 1) return null
    const parsed = safeParseValue(LiveRowSchema, result.rows[0])
    if (!parsed.ok) return null
    const scope = scopeFrom(parsed.value)
    if (!scope || scope.profileId !== expected.profileId) return null
    const active = parsed.value.owner_state === 'active'
      && parsed.value.transfer_id === null
      && parsed.value.transfer_lock_id === null
      && parsed.value.transfer_fence === null
      && parsed.value.organization_status === 'active'
      && parsed.value.workspace_status === 'active'
      && parsed.value.site_status === 'active'
      && parsed.value.membership_id !== null
      && parsed.value.override_access !== 'deny'
    return Object.freeze({
      active,
      actorId: connector.actorId,
      scope,
      revision: scope.ownerGeneration,
    })
  }
}

const CreditBindingRowSchema = Type.Object({
  account_id: Type.String({ minLength: 1 }),
  provider_id: Type.String({ minLength: 1 }),
  model_id: Type.String({ minLength: 1 }),
  credential_id: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
}, { additionalProperties: false })

type CreditBindingRow = typeof CreditBindingRowSchema.static

/** Resolves the exact FUMA-064 account and most-specific enabled catalog default without exposing BYOK material. */
export class PostgresMcpCreditAccountLocator implements McpCreditAccountLocator {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Hosted MCP credit account lookup requires PostgreSQL.')
    this.#db = db
  }

  async locate(scope: McpScope): Promise<McpCreditAccountBinding> {
    const result = await this.#db.unsafe<CreditBindingRow>(`
      select account.account_id, selected.provider_id, selected.model_id,
        credential.credential_id
      from fuma_ai_credit_accounts_v2 account
      join lateral (
        select defaults.provider_id, defaults.model_id
        from fuma_ai_catalog_defaults_v2 defaults
        join fuma_ai_catalog_providers_v2 provider
          on provider.provider_id=defaults.provider_id and provider.enabled=true
        join fuma_ai_catalog_model_controls_v2 control
          on control.provider_id=defaults.provider_id and control.model_id=defaults.model_id
          and control.enabled=true and control.visibility in ('public','customer')
          and control.allowed_profiles_json ? $7
        where defaults.profile_id=$7 and (
          (defaults.target_kind='site' and defaults.target_scope_id=$4)
          or (defaults.target_kind='workspace' and defaults.target_scope_id=$3)
          or (defaults.target_kind='organization' and defaults.target_scope_id=$2)
          or (defaults.target_kind='platform' and defaults.target_scope_id='')
        )
        order by case defaults.target_kind
          when 'site' then 1 when 'workspace' then 2
          when 'organization' then 3 else 4 end
        limit 1
      ) selected on true
      left join lateral (
        select byok.credential_id
        from fuma_ai_byok_metadata_v2 byok
        where byok.platform_id=account.platform_id
          and byok.organization_id=account.organization_id
          and byok.workspace_id=account.workspace_id and byok.site_id=account.site_id
          and byok.owner_key=account.owner_key and byok.owner_generation=account.owner_generation
          and byok.provider_id=selected.provider_id and byok.state='active'
        order by byok.updated_at desc, byok.credential_id
        limit 1
      ) credential on true
      where account.platform_id=$1 and account.organization_id=$2
        and account.workspace_id=$3 and account.site_id=$4
        and account.owner_key=$5 and account.owner_generation=$6
    `, [
      scope.platformId,
      scope.organizationId,
      scope.workspaceId,
      scope.siteId,
      scope.ownerKey,
      scope.ownerGeneration,
      scope.profileId,
    ])
    if (result.rows.length !== 1) throw new Error('Exact MCP AI credit account and model default are unavailable.')
    const parsed = safeParseValue(CreditBindingRowSchema, result.rows[0])
    if (!parsed.ok) throw new Error('Stored MCP AI credit binding is invalid.')
    return Object.freeze({
      accountId: parsed.value.account_id,
      providerId: parsed.value.provider_id,
      modelId: parsed.value.model_id,
      mode: parsed.value.credential_id === null ? 'platform' : 'byok',
      byokCredentialId: parsed.value.credential_id,
    })
  }
}
