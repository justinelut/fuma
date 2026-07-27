import {
  EmailSettingsTargetSchema,
  EmailSettingsVersionSchema,
  parseEmailSettingsContract,
  type EmailSettingsLevel,
  type EmailSettingsTarget,
  type EmailSettingsVersion,
} from '@core/fuma/publication/emailSettingsContracts'
import type { DbClient } from '../../db/client'
import type { PublicationRepositoryScope } from './scope'
import { PublicationScopeError } from './scope'
import { EmailSettingsError, type EmailSettingsVersionRepository } from './emailSettings'

interface VersionRow {
  version_id: string
  level_kind: string
  level_id: string
  ordinal: string | number | bigint
  parent_version_id: string | null
  overrides_json: unknown
  mutation_json: unknown
  actor_id: string
  created_at: string | Date
}
class EmailSettingsWriteConflict extends Error {}

export class PostgresEmailSettingsVersionRepository implements EmailSettingsVersionRepository {
  readonly #db: DbClient
  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new Error('Hierarchical email settings require PostgreSQL authority.')
    this.#db = db
  }

  async current(scope: PublicationRepositoryScope, targetInput: EmailSettingsTarget): Promise<EmailSettingsVersion | null> {
    const target = parseEmailSettingsContract('Email settings target', EmailSettingsTargetSchema, targetInput)
    assertTarget(scope, target, target.level === 'newsletter' ? target.levelId : null)
    return await this.#authorized(scope, async (db) => {
      const row = (await db<VersionRow>`select version.version_id,version.level_kind,version.level_id,version.ordinal,version.parent_version_id,version.overrides_json,version.mutation_json,version.actor_id,version.created_at from fuma_email_settings_version_heads head join fuma_email_settings_versions version on version.platform_id=head.platform_id and version.organization_id=head.organization_id and version.workspace_id=head.workspace_id and version.site_id=head.site_id and version.owner_key=head.owner_key and version.owner_generation=head.owner_generation and version.profile_id=head.profile_id and version.level_kind=head.level_kind and version.level_id=head.level_id and version.version_id=head.version_id where head.platform_id=${scope.platformId} and head.organization_id=${scope.organizationId} and head.workspace_id=${scope.workspaceId} and head.site_id=${scope.siteId} and head.owner_key=${scope.ownerKey} and head.owner_generation=${scope.generation} and head.profile_id=${scope.profileId} and head.level_kind=${target.level} and head.level_id=${target.levelId}`).rows[0]
      return row ? mapVersion(row) : null
    })
  }

  async listCurrent(scope: PublicationRepositoryScope, newsletterId: string | null): Promise<readonly EmailSettingsVersion[]> {
    return await this.#authorized(scope, async (db) => {
      const rows = await db<VersionRow>`select version.version_id,version.level_kind,version.level_id,version.ordinal,version.parent_version_id,version.overrides_json,version.mutation_json,version.actor_id,version.created_at from fuma_email_settings_version_heads head join fuma_email_settings_versions version on version.platform_id=head.platform_id and version.organization_id=head.organization_id and version.workspace_id=head.workspace_id and version.site_id=head.site_id and version.owner_key=head.owner_key and version.owner_generation=head.owner_generation and version.profile_id=head.profile_id and version.level_kind=head.level_kind and version.level_id=head.level_id and version.version_id=head.version_id where head.platform_id=${scope.platformId} and head.organization_id=${scope.organizationId} and head.workspace_id=${scope.workspaceId} and head.site_id=${scope.siteId} and head.owner_key=${scope.ownerKey} and head.owner_generation=${scope.generation} and head.profile_id=${scope.profileId} and ((head.level_kind='platform' and head.level_id=${scope.platformId}) or (head.level_kind='organization' and head.level_id=${scope.organizationId}) or (head.level_kind='workspace' and head.level_id=${scope.workspaceId}) or (head.level_kind='site' and head.level_id=${scope.siteId}) or (head.level_kind='newsletter' and head.level_id=${newsletterId ?? ''})) order by case head.level_kind when 'platform' then 1 when 'organization' then 2 when 'workspace' then 3 when 'site' then 4 else 5 end limit 5`
      return Object.freeze(rows.rows.map(mapVersion))
    })
  }

  async append(scope: PublicationRepositoryScope, versionInput: EmailSettingsVersion, expectedVersionId: string | null): Promise<boolean> {
    const version = parseEmailSettingsContract('Email settings version', EmailSettingsVersionSchema, versionInput)
    assertTarget(scope, version, version.level === 'newsletter' ? version.levelId : null)
    try {
      return await this.#authorized(scope, async (db) => {
        if (version.level === 'newsletter') {
          const newsletter = await db`select 1 where exists (
            select 1 from fuma_publication_newsletter_composers composer
            where composer.platform_id=${scope.platformId} and composer.organization_id=${scope.organizationId}
              and composer.workspace_id=${scope.workspaceId} and composer.site_id=${scope.siteId}
              and composer.owner_key=${scope.ownerKey} and composer.owner_generation=${scope.generation}
              and composer.profile_id=${scope.profileId} and composer.newsletter_id=${version.levelId}
              and composer.status<>'archived'
          ) or exists (
            select 1 from fuma_publication_newsletters legacy
            where legacy.platform_id=${scope.platformId} and legacy.organization_id=${scope.organizationId}
              and legacy.workspace_id=${scope.workspaceId} and legacy.site_id=${scope.siteId}
              and legacy.owner_key=${scope.ownerKey} and legacy.owner_generation=${scope.generation}
              and legacy.profile_id=${scope.profileId} and legacy.newsletter_id=${version.levelId}
              and legacy.status<>'archived'
          )`
          if (newsletter.rowCount !== 1) throw new EmailSettingsError('scope-denied', 'Email settings scope denied.')
        }
        const head = await db<{ version_id: string; ordinal: string | number | bigint }>`select version_id,ordinal from fuma_email_settings_version_heads where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and level_kind=${version.level} and level_id=${version.levelId} for update`
        const current = head.rows[0]
        if ((current?.version_id ?? null) !== expectedVersionId || version.parentVersionId !== expectedVersionId || version.ordinal !== integer(current?.ordinal ?? 0) + 1) return false
        const inserted = await db`insert into fuma_email_settings_versions (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,level_kind,level_id,version_id,ordinal,parent_version_id,overrides_json,mutation_json,actor_id,created_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${version.level},${version.levelId},${version.versionId},${version.ordinal},${version.parentVersionId},${JSON.stringify(version.overrides)}::text::jsonb,${JSON.stringify(version.mutation)}::text::jsonb,${version.actorId},${version.createdAt}) on conflict do nothing`
        if (inserted.rowCount !== 1) throw new EmailSettingsWriteConflict()
        const changed = expectedVersionId === null
          ? await db`insert into fuma_email_settings_version_heads (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,level_kind,level_id,version_id,ordinal,updated_at) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${version.level},${version.levelId},${version.versionId},${version.ordinal},${version.createdAt}) on conflict do nothing`
          : await db`update fuma_email_settings_version_heads set version_id=${version.versionId},ordinal=${version.ordinal},updated_at=${version.createdAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and level_kind=${version.level} and level_id=${version.levelId} and version_id=${expectedVersionId}`
        if (changed.rowCount !== 1) throw new EmailSettingsWriteConflict()
        return true
      })
    } catch (error) {
      if (error instanceof EmailSettingsWriteConflict) return false
      throw error
    }
  }

  async #authorized<T>(scope: PublicationRepositoryScope, work: (db: DbClient) => Promise<T>): Promise<T> {
    return await this.#db.transaction(async (db) => {
      const authority = await db`select 1 from fuma_tenant_owner_keys owner join fuma_sites site on site.organization_id=owner.organization_id and site.workspace_id=owner.workspace_id and site.id=owner.site_id where owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey} and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId} and owner.generation=${scope.generation} and site.profile_id=${scope.profileId} and owner.state='active' and owner.transfer_id is null and owner.transfer_lock_id is null and owner.transfer_fence is null for share`
      if (authority.rowCount !== 1) throw new PublicationScopeError()
      return await work(db)
    })
  }
}

function mapVersion(row: VersionRow): EmailSettingsVersion {
  return parseEmailSettingsContract('Stored email settings version', EmailSettingsVersionSchema, {
    versionId: row.version_id,
    level: row.level_kind,
    levelId: row.level_id,
    ordinal: integer(row.ordinal),
    parentVersionId: row.parent_version_id,
    overrides: json(row.overrides_json),
    mutation: json(row.mutation_json),
    actorId: row.actor_id,
    createdAt: new Date(row.created_at).toISOString(),
  })
}
function integer(value: string | number | bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Stored email settings integer is invalid.')
  return result
}
function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : structuredClone(value)
}
function assertTarget(scope: PublicationRepositoryScope, target: { level: EmailSettingsLevel; levelId: string }, newsletterId: string | null): void {
  const expected: Readonly<Record<EmailSettingsLevel, string | null>> = { platform: scope.platformId, organization: scope.organizationId, workspace: scope.workspaceId, site: scope.siteId, newsletter: newsletterId }
  if (expected[target.level] === null || expected[target.level] !== target.levelId) throw new EmailSettingsError('scope-denied', 'Email settings scope denied.')
}
