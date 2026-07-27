import {
  PublicationAuthorSchema,
  PublicationContentImportSchema,
  PublicationContentSchema,
  PublicationSettingsSchema,
  PublicationTagSchema,
  PublicationWorkflowTransitionSchema,
  parsePublicationContract,
  type PublicationAuthor,
  type PublicationContent,
  type PublicationContentImport,
  type PublicationSettings,
  type PublicationTag,
  type PublicationWorkflowTransition,
} from '@core/fuma/publication'
import type { DbClient } from '../../db/client'
import type { PublicationRepositoryScope } from './scope'
import { PublicationScopeError } from './scope'
import {
  contentCells,
  contentFromRow,
  integer,
  record,
  relationMap,
  settingsFromRow,
  tagFromRow,
  type JsonRecord,
  type RelationRow,
  type UniversalRow,
} from './universalContentCodec'

interface AuthorRow { author_id: string; display_name: string; email: string; image: string | null }

type PublicationTableKind = 'posts' | 'pages' | 'tags' | 'settings'
const TABLE_DEFINITIONS: Readonly<Record<PublicationTableKind, Readonly<{
  name: string
  kind: 'postType' | 'page' | 'data'
  singular: string
  plural: string
  primary: string
  fields: readonly JsonRecord[]
}>>> = Object.freeze({
  posts: {
    name: 'Publication posts', kind: 'postType', singular: 'Post', plural: 'Posts', primary: 'title',
    fields: [
      { type: 'text', id: 'title', label: 'Title', required: true, builtIn: true },
      { type: 'text', id: 'slug', label: 'Slug', required: true, builtIn: true },
      { type: 'longText', id: 'excerpt', label: 'Excerpt', builtIn: true },
      { type: 'pageTree', id: 'visualDocument', label: 'Visual document', required: true, builtIn: true },
      { type: 'media', id: 'featureMediaId', label: 'Featured media', mediaKind: 'image', builtIn: true },
      { type: 'json', id: 'publicationMetadata', label: 'SEO, social, redirects, and visibility', builtIn: true },
    ],
  },
  pages: {
    name: 'Publication pages', kind: 'page', singular: 'Page', plural: 'Pages', primary: 'title',
    fields: [
      { type: 'text', id: 'title', label: 'Title', required: true, builtIn: true },
      { type: 'text', id: 'slug', label: 'Slug', required: true, builtIn: true },
      { type: 'longText', id: 'excerpt', label: 'Excerpt', builtIn: true },
      { type: 'pageTree', id: 'visualDocument', label: 'Visual document', required: true, builtIn: true },
      { type: 'media', id: 'featureMediaId', label: 'Featured media', mediaKind: 'image', builtIn: true },
      { type: 'json', id: 'publicationMetadata', label: 'SEO, social, redirects, and visibility', builtIn: true },
    ],
  },
  tags: {
    name: 'Publication tags', kind: 'data', singular: 'Tag', plural: 'Tags', primary: 'name',
    fields: [
      { type: 'text', id: 'name', label: 'Name', required: true },
      { type: 'text', id: 'slug', label: 'Slug', required: true },
      { type: 'longText', id: 'description', label: 'Description' },
    ],
  },
  settings: {
    name: 'Publication settings', kind: 'data', singular: 'Publication settings', plural: 'Publication settings', primary: 'name',
    fields: [
      { type: 'text', id: 'name', label: 'Name', required: true },
      { type: 'longText', id: 'description', label: 'Description' },
      { type: 'text', id: 'language', label: 'Language', required: true },
      { type: 'text', id: 'timezone', label: 'Timezone', required: true },
    ],
  },
})

function stableId(...parts: readonly string[]): string {
  const digest = new Bun.CryptoHasher('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)
  return `fuma-publication-${digest}`
}
function tableId(scope: PublicationRepositoryScope, kind: PublicationTableKind): string {
  return stableId(scope.platformId, scope.ownerKey, scope.profileId, 'table', kind)
}
function rowId(scope: PublicationRepositoryScope, recordKind: string, logicalId: string): string {
  return stableId(scope.platformId, scope.ownerKey, scope.profileId, recordKind, logicalId)
}
function rowStatus(status: PublicationContent['status']): 'draft' | 'published' | 'unpublished' {
  if (status === 'published') return 'published'
  if (status === 'unpublished' || status === 'archived') return 'unpublished'
  return 'draft'
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}
function normalizedCanonical(value: string | null): string | null {
  if (value === null) return null
  const url = new URL(value)
  url.hostname = url.hostname.toLowerCase()
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  url.searchParams.sort()
  return url.toString()
}
function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && String(error.code) === '23505')
}

/** FUMA-033 adapter: content authority remains in data_tables/data_rows; sidecars only scope rows and normalize relations. */
export class PostgresPublicationUniversalStore {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }

  async #authorized<T>(scope: PublicationRepositoryScope, work: (db: DbClient) => Promise<T>): Promise<T> {
    return await this.#db.transaction(async (db) => {
      const authority = await db`
        select 1
        from fuma_tenant_owner_keys owner
        join fuma_sites site
          on site.organization_id=owner.organization_id
         and site.workspace_id=owner.workspace_id
         and site.id=owner.site_id
        where owner.platform_id=${scope.platformId}
          and owner.owner_key=${scope.ownerKey}
          and owner.organization_id=${scope.organizationId}
          and owner.workspace_id=${scope.workspaceId}
          and owner.site_id=${scope.siteId}
          and owner.generation=${scope.generation}
          and site.profile_id=${scope.profileId}
          and owner.state='active'
          and owner.transfer_id is null
          and owner.transfer_lock_id is null
          and owner.transfer_fence is null
        for share`
      if (authority.rowCount !== 1) throw new PublicationScopeError()
      await this.#ensureTables(db, scope)
      return await work(db)
    })
  }

  async #ensureTables(db: DbClient, scope: PublicationRepositoryScope): Promise<void> {
    for (const kind of Object.keys(TABLE_DEFINITIONS) as PublicationTableKind[]) {
      const definition = TABLE_DEFINITIONS[kind]
      const id = tableId(scope, kind)
      await db`
        insert into data_tables (
          id,name,slug,kind,route_base,singular_label,plural_label,
          primary_field_id,fields_json,system,created_by_user_id,updated_by_user_id
        ) values (
          ${id},${definition.name},${id},${definition.kind},${''},${definition.singular},${definition.plural},
          ${definition.primary},${JSON.stringify(definition.fields)},${true},${null},${null}
        ) on conflict (id) do nothing`
      await db`
        insert into fuma_tenant_resource_owners (
          platform_id,owner_key,organization_id,workspace_id,site_id,resource_kind,
          class_id,source_name,legacy_id,legacy_identity_json,object_key,content_hash,size_bytes
        ) values (
          ${scope.platformId},${scope.ownerKey},${scope.organizationId},${scope.workspaceId},${scope.siteId},${'table-row'},
          ${'content.data-table'},${'data_tables'},${id},${JSON.stringify({ id, publicationProfileId: scope.profileId, publicationKind: kind })},${null},${null},${null}
        ) on conflict (platform_id,owner_key,class_id,legacy_id) do update set
          organization_id=excluded.organization_id,
          workspace_id=excluded.workspace_id,
          site_id=excluded.site_id,
          legacy_identity_json=excluded.legacy_identity_json,
          updated_at=current_timestamp`
    }
  }

  async #rows(db: DbClient, scope: PublicationRepositoryScope, kinds: readonly PublicationTableKind[], logicalId: string | null = null): Promise<UniversalRow[]> {
    const ids = kinds.map((kind) => tableId(scope, kind))
    if (ids.length === 1) {
      const result = logicalId === null
        ? await db<UniversalRow>`
          select row.id,row.table_id,row.cells_json,row.slug,row.status,row.created_at,row.updated_at,row.published_at
          from data_rows row
          join fuma_tenant_resource_owners owner
            on owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey}
           and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
           and owner.resource_kind='table-row' and owner.class_id='content.data-row'
           and owner.source_name='data_rows' and owner.legacy_id=row.id
          where row.table_id=${ids[0]} and row.deleted_at is null
          order by row.updated_at desc,row.id`
        : await db<UniversalRow>`
          select row.id,row.table_id,row.cells_json,row.slug,row.status,row.created_at,row.updated_at,row.published_at
          from data_rows row
          join fuma_tenant_resource_owners owner
            on owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey}
           and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
           and owner.resource_kind='table-row' and owner.class_id='content.data-row'
           and owner.source_name='data_rows' and owner.legacy_id=row.id
          where row.table_id=${ids[0]} and row.id=${rowId(scope, kinds[0], logicalId)} and row.deleted_at is null
          limit 1`
      return [...result.rows]
    }
    const { rows } = await db<UniversalRow>`
      select row.id,row.table_id,row.cells_json,row.slug,row.status,row.created_at,row.updated_at,row.published_at
      from data_rows row
      join fuma_tenant_resource_owners owner
        on owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey}
       and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
       and owner.resource_kind='table-row' and owner.class_id='content.data-row'
       and owner.source_name='data_rows' and owner.legacy_id=row.id
      where (row.table_id=${ids[0]} or row.table_id=${ids[1]}) and row.deleted_at is null
      order by row.updated_at desc,row.id`
    return [...rows]
  }

  async #lockedRow(db: DbClient, scope: PublicationRepositoryScope, physicalId: string, physicalTableId: string): Promise<UniversalRow | null> {
    const { rows } = await db<UniversalRow>`
      select row.id,row.table_id,row.cells_json,row.slug,row.status,row.created_at,row.updated_at,row.published_at
      from data_rows row
      join fuma_tenant_resource_owners owner
        on owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey}
       and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
       and owner.resource_kind='table-row' and owner.class_id='content.data-row'
       and owner.source_name='data_rows' and owner.legacy_id=row.id
      where row.id=${physicalId} and row.table_id=${physicalTableId} and row.deleted_at is null
      for update of row`
    return rows[0] ?? null
  }

  async #relations(db: DbClient, scope: PublicationRepositoryScope, sourceTableIds: readonly string[]): Promise<ReturnType<typeof relationMap>> {
    if (sourceTableIds.length === 0) return new Map()
    const { rows } = await db<RelationRow>`
      select relation.source_row_id,relation.relation_kind,relation.target_id,relation.target_row_id,relation.position,relation.is_primary
      from data_row_relations relation
      join data_rows source on source.id=relation.source_row_id
      where relation.platform_id=${scope.platformId}
        and relation.organization_id=${scope.organizationId}
        and relation.workspace_id=${scope.workspaceId}
        and relation.site_id=${scope.siteId}
        and relation.owner_key=${scope.ownerKey}
        and relation.profile_id=${scope.profileId}
        and (source.table_id=${sourceTableIds[0]} or source.table_id=${sourceTableIds[1] ?? sourceTableIds[0]})
        and source.deleted_at is null
      order by relation.source_row_id,relation.relation_kind,relation.position`
    return relationMap(rows)
  }

  async getContent(scope: PublicationRepositoryScope, contentId: string): Promise<PublicationContent | null> {
    return await this.#authorized(scope, async (db) => {
      const post = await this.#rows(db, scope, ['posts'], contentId)
      const rows = post.length > 0 ? post : await this.#rows(db, scope, ['pages'], contentId)
      if (!rows[0]) return null
      return contentFromRow(rows[0], await this.#relations(db, scope, [rows[0].table_id]))
    })
  }

  async listContent(scope: PublicationRepositoryScope): Promise<readonly PublicationContent[]> {
    return await this.#authorized(scope, async (db) => {
      const rows = await this.#rows(db, scope, ['posts', 'pages'])
      const relations = await this.#relations(db, scope, [tableId(scope, 'posts'), tableId(scope, 'pages')])
      return rows.map((row) => contentFromRow(row, relations))
    })
  }

  async #assertReferences(db: DbClient, scope: PublicationRepositoryScope, value: PublicationContent): Promise<Map<string, string>> {
    if (value.metadata.primaryTagId !== null && !value.metadata.tagIds.includes(value.metadata.primaryTagId)) {
      throw new TypeError('Primary Publication tag must be one of the content tags.')
    }
    for (const authorId of value.metadata.authorIds) {
      const author = await db`
        select 1
        from auth_users user_account
        join auth_staff_profiles staff on staff.user_id=user_account.id
        join auth_members membership on membership.user_id=user_account.id and membership.organization_id=${scope.organizationId}
        left join fuma_workspace_membership_overrides workspace_membership
          on workspace_membership.workspace_id=${scope.workspaceId} and workspace_membership.user_id=user_account.id
        where user_account.id=${authorId}
          and coalesce(workspace_membership.access,'inherit')<>'deny'
          and user_account.banned is not true`
      if (author.rowCount !== 1) throw new PublicationScopeError()
    }
    const targets = new Map<string, string>()
    for (const tagId of value.metadata.tagIds) {
      const physicalId = rowId(scope, 'tags', tagId)
      const tag = await db`
        select 1 from data_rows row
        join fuma_tenant_resource_owners owner
          on owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey}
         and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
         and owner.resource_kind='table-row' and owner.class_id='content.data-row'
         and owner.source_name='data_rows' and owner.legacy_id=row.id
        where row.id=${physicalId} and row.table_id=${tableId(scope, 'tags')} and row.deleted_at is null`
      if (tag.rowCount !== 1) throw new PublicationScopeError()
      targets.set(tagId, physicalId)
    }
    if (value.metadata.featureImageId !== null) {
      const media = await db`
        select 1 from fuma_tenant_resource_owners
        where platform_id=${scope.platformId} and owner_key=${scope.ownerKey}
          and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId}
          and resource_kind='table-row' and class_id='media.asset' and legacy_id=${value.metadata.featureImageId}`
      if (media.rowCount !== 1) throw new PublicationScopeError()
    }
    return targets
  }

  async #replaceRelations(db: DbClient, scope: PublicationRepositoryScope, value: PublicationContent, physicalId: string, tagTargets: ReadonlyMap<string, string>): Promise<void> {
    await db`
      delete from data_row_relations
      where platform_id=${scope.platformId} and organization_id=${scope.organizationId}
        and workspace_id=${scope.workspaceId} and site_id=${scope.siteId}
        and owner_key=${scope.ownerKey} and profile_id=${scope.profileId} and source_row_id=${physicalId}`
    for (const [position, authorId] of value.metadata.authorIds.entries()) {
      await db`
        insert into data_row_relations (
          platform_id,organization_id,workspace_id,site_id,owner_key,profile_id,
          source_row_id,relation_kind,target_kind,target_id,target_row_id,position,is_primary
        ) values (
          ${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.profileId},
          ${physicalId},${'author'},${'staff-profile'},${authorId},${null},${position},${false}
        )`
    }
    for (const [position, tagId] of value.metadata.tagIds.entries()) {
      await db`
        insert into data_row_relations (
          platform_id,organization_id,workspace_id,site_id,owner_key,profile_id,
          source_row_id,relation_kind,target_kind,target_id,target_row_id,position,is_primary
        ) values (
          ${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.profileId},
          ${physicalId},${'tag'},${'data-row'},${tagId},${tagTargets.get(tagId)!},${position},${tagId===value.metadata.primaryTagId}
        )`
    }
  }

  async #syncContentAuthority(db: DbClient, scope: PublicationRepositoryScope, value: PublicationContent, priorStatus: PublicationContent['status'] | null): Promise<void> {
    const contentPath = `/${value.metadata.slug}`
    const canonicalUrl = normalizedCanonical(value.metadata.canonicalUrl)
    const canonicalPath = canonicalUrl === null ? null : new URL(canonicalUrl).pathname
    const snapshot = { metadata: value.metadata, status: value.status, scheduledAt: value.scheduledAt, publishedAt: value.publishedAt }
    const snapshotJson = canonicalJson(snapshot)
    const metadataSha256 = new Bun.CryptoHasher('sha256').update(snapshotJson).digest('hex')
    const revisionId = `authority-${value.workflowVersion}-${metadataSha256.slice(0, 24)}`
    await db`select pg_advisory_xact_lock(hashtextextended(${`${scope.platformId}\0${scope.ownerKey}\0${scope.generation}\0${scope.profileId}`},0))`
    await db`
      delete from fuma_publication_redirect_authority
      where platform_id=${scope.platformId} and organization_id=${scope.organizationId}
        and workspace_id=${scope.workspaceId} and site_id=${scope.siteId}
        and owner_key=${scope.ownerKey} and owner_generation=${scope.generation}
        and profile_id=${scope.profileId} and content_id=${value.contentId}`
    const livePathConflict = await db`
      select 1 from fuma_publication_redirect_authority
      where platform_id=${scope.platformId} and organization_id=${scope.organizationId}
        and workspace_id=${scope.workspaceId} and site_id=${scope.siteId}
        and owner_key=${scope.ownerKey} and owner_generation=${scope.generation}
        and profile_id=${scope.profileId} and from_path=${contentPath} limit 1`
    if (livePathConflict.rowCount !== 0) throw new UniversalConflict()
    for (const redirect of value.metadata.redirects) {
      if (redirect.toPath !== contentPath) throw new UniversalConflict()
      const conflict = await db`
        select 1
        from fuma_publication_redirect_authority redirect
        where redirect.platform_id=${scope.platformId} and redirect.organization_id=${scope.organizationId}
          and redirect.workspace_id=${scope.workspaceId} and redirect.site_id=${scope.siteId}
          and redirect.owner_key=${scope.ownerKey} and redirect.owner_generation=${scope.generation}
          and redirect.profile_id=${scope.profileId}
          and (redirect.from_path=${redirect.fromPath} or redirect.from_path=${redirect.toPath})
        union all
        select 1
        from fuma_publication_metadata_authority content
        where content.platform_id=${scope.platformId} and content.organization_id=${scope.organizationId}
          and content.workspace_id=${scope.workspaceId} and content.site_id=${scope.siteId}
          and content.owner_key=${scope.ownerKey} and content.owner_generation=${scope.generation}
          and content.profile_id=${scope.profileId} and content.content_id<>${value.contentId}
          and (content.content_path=${redirect.fromPath} or content.canonical_path=${redirect.fromPath})
        limit 1`
      if (conflict.rowCount !== 0 || (canonicalPath !== null && canonicalPath === redirect.fromPath)) throw new UniversalConflict()
    }
    const saved = await db`
      insert into fuma_publication_metadata_authority (
        platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        content_id,content_path,lifecycle_status,workflow_version,canonical_url,canonical_path,
        visibility_kind,metadata_sha256,snapshot_json,updated_at
      ) values (
        ${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},
        ${value.contentId},${contentPath},${value.status},${value.workflowVersion},${canonicalUrl},${canonicalPath},
        ${value.metadata.visibility.kind},${metadataSha256},${snapshotJson}::text::jsonb,${value.updatedAt}
      ) on conflict (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,content_id)
      do update set content_path=excluded.content_path,lifecycle_status=excluded.lifecycle_status,
        workflow_version=excluded.workflow_version,canonical_url=excluded.canonical_url,canonical_path=excluded.canonical_path,
        visibility_kind=excluded.visibility_kind,metadata_sha256=excluded.metadata_sha256,
        snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at
      where fuma_publication_metadata_authority.workflow_version<excluded.workflow_version`
    if (saved.rowCount !== 1) throw new UniversalConflict()
    for (const redirect of value.metadata.redirects) await db`
      insert into fuma_publication_redirect_authority (
        platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        content_id,from_path,to_path,status_code,created_at
      ) values (
        ${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},
        ${value.contentId},${redirect.fromPath},${redirect.toPath},${redirect.statusCode},${value.updatedAt}
      )`
    const revision = await db`
      insert into fuma_publication_authority_revisions (
        platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        content_id,workflow_version,revision_id,reason,lifecycle_status,metadata_sha256,snapshot_json,created_at
      ) values (
        ${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},
        ${value.contentId},${value.workflowVersion},${revisionId},${priorStatus !== null && priorStatus !== value.status ? 'lifecycle' : 'metadata'},
        ${value.status},${metadataSha256},${snapshotJson}::text::jsonb,${value.updatedAt}
      ) on conflict do nothing`
    if (revision.rowCount !== 1) throw new UniversalConflict()
  }

  async #putContent(db: DbClient, scope: PublicationRepositoryScope, input: PublicationContent, expectedVersion: number | null): Promise<boolean> {
    const value = parsePublicationContract('content', PublicationContentSchema, input)
    const physicalId = rowId(scope, value.kind === 'post' ? 'posts' : 'pages', value.contentId)
    const contentTableId = tableId(scope, value.kind === 'post' ? 'posts' : 'pages')
    const targets = await this.#assertReferences(db, scope, value)
    const cells = JSON.stringify(contentCells(scope, value))
    let accepted: boolean
    let priorStatus: PublicationContent['status'] | null = null
    if (expectedVersion === null) {
      const { rowCount } = await db`
        insert into data_rows (id,table_id,cells_json,slug,status,published_at,created_at,updated_at)
        values (${physicalId},${contentTableId},${cells},${value.metadata.slug},${rowStatus(value.status)},${value.publishedAt},${value.createdAt},${value.updatedAt})
        on conflict do nothing`
      accepted = rowCount === 1
      if (accepted) await db`
        insert into fuma_tenant_resource_owners (
          platform_id,owner_key,organization_id,workspace_id,site_id,resource_kind,
          class_id,source_name,legacy_id,legacy_identity_json,object_key,content_hash,size_bytes
        ) values (
          ${scope.platformId},${scope.ownerKey},${scope.organizationId},${scope.workspaceId},${scope.siteId},${'table-row'},
          ${'content.data-row'},${'data_rows'},${physicalId},${JSON.stringify({ id: physicalId, publicationProfileId: scope.profileId, publicationId: value.contentId, publicationKind: value.kind })},${null},${null},${null}
        ) on conflict do nothing`
    } else {
      const current = await this.#lockedRow(db, scope, physicalId, contentTableId)
      if (!current || integer(record(current.cells_json).workflowVersion) !== expectedVersion) return false
      priorStatus = record(current.cells_json).workflowStatus as PublicationContent['status']
      const { rowCount } = await db`
        update data_rows row set
          cells_json=${cells},slug=${value.metadata.slug},status=${rowStatus(value.status)},published_at=${value.publishedAt},updated_at=${value.updatedAt}
        from fuma_tenant_resource_owners owner
        where row.id=${physicalId} and row.table_id=${contentTableId} and row.deleted_at is null
          and owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey}
          and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
          and owner.resource_kind='table-row' and owner.class_id='content.data-row'
          and owner.source_name='data_rows' and owner.legacy_id=row.id`
      accepted = rowCount === 1
    }
    if (accepted) {
      await this.#syncContentAuthority(db, scope, value, priorStatus)
      await this.#replaceRelations(db, scope, value, physicalId, targets)
    }
    return accepted
  }

  async putContent(scope: PublicationRepositoryScope, value: PublicationContent, expectedVersion: number | null): Promise<boolean> {
    try { return await this.#authorized(scope, (db) => this.#putContent(db, scope, value, expectedVersion)) }
    catch (error) { if (error instanceof UniversalConflict || isUniqueConflict(error)) return false; throw error }
  }

  async importContent(scope: PublicationRepositoryScope, input: PublicationContentImport): Promise<boolean> {
    const command = parsePublicationContract('content import', PublicationContentImportSchema, input)
    if (new Set(command.items.map((item) => item.content.contentId)).size !== command.items.length) throw new TypeError('Publication import contains duplicate stable IDs.')
    try {
      return await this.#authorized(scope, async (db) => {
        for (const item of command.items) if (!await this.#putContent(db, scope, item.content, item.expectedVersion)) throw new UniversalConflict()
        return true
      })
    } catch (error) {
      if (error instanceof UniversalConflict || isUniqueConflict(error)) return false
      throw error
    }
  }

  async deleteContent(scope: PublicationRepositoryScope, contentId: string, expectedVersion: number): Promise<boolean> {
    return await this.#authorized(scope, async (db) => {
      for (const kind of ['posts', 'pages'] as const) {
        const physicalId = rowId(scope, kind, contentId)
        const physicalTableId = tableId(scope, kind)
        const current = await this.#lockedRow(db, scope, physicalId, physicalTableId)
        if (!current || integer(record(current.cells_json).workflowVersion) !== expectedVersion) continue
        const { rowCount } = await db`
          update data_rows row set deleted_at=current_timestamp,updated_at=current_timestamp
          from fuma_tenant_resource_owners owner
          where row.id=${physicalId} and row.table_id=${physicalTableId} and row.deleted_at is null
            and owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey}
            and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
            and owner.resource_kind='table-row' and owner.class_id='content.data-row'
            and owner.source_name='data_rows' and owner.legacy_id=row.id`
        if (rowCount === 1) {
          await db`delete from data_row_relations where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and profile_id=${scope.profileId} and source_row_id=${physicalId}`
          await db`delete from fuma_publication_metadata_authority where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and content_id=${contentId}`
          return true
        }
      }
      return false
    })
  }

  async commitWorkflowTransition(scope: PublicationRepositoryScope, next: PublicationContent, input: PublicationWorkflowTransition, expectedVersion: number): Promise<boolean> {
    const content = parsePublicationContract('content', PublicationContentSchema, next)
    const transition = parsePublicationContract('workflow transition', PublicationWorkflowTransitionSchema, input)
    try {
      return await this.#authorized(scope, async (db) => {
        const inserted = await db`
          insert into fuma_publication_lifecycle_transitions (
            platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
            transition_id,content_id,from_status,to_status,actor_id,expected_version,scheduled_at,note,created_at
          ) values (
            ${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},
            ${transition.transitionId},${transition.contentId},${transition.from},${transition.to},${transition.actorId},${transition.expectedVersion},${transition.scheduledAt},${transition.note},${transition.createdAt}
          ) on conflict do nothing`
        if (inserted.rowCount !== 1 || !await this.#putContent(db, scope, content, expectedVersion)) throw new UniversalConflict()
        return true
      })
    } catch (error) {
      if (error instanceof UniversalConflict || isUniqueConflict(error)) return false
      throw error
    }
  }

  async listAuthors(scope: PublicationRepositoryScope): Promise<readonly PublicationAuthor[]> {
    return await this.#authorized(scope, async (db) => {
      const { rows } = await db<AuthorRow>`
        select user_account.id as author_id,user_account.name as display_name,user_account.email,user_account.image
        from auth_users user_account
        join auth_staff_profiles staff on staff.user_id=user_account.id
        join auth_members membership on membership.user_id=user_account.id and membership.organization_id=${scope.organizationId}
        left join fuma_workspace_membership_overrides workspace_membership
          on workspace_membership.workspace_id=${scope.workspaceId} and workspace_membership.user_id=user_account.id
        where coalesce(workspace_membership.access,'inherit')<>'deny' and user_account.banned is not true
        order by user_account.name,user_account.id`
      return rows.map((row) => parsePublicationContract('current Publication author', PublicationAuthorSchema, {
        authorId: row.author_id, displayName: row.display_name.trim() || row.email, email: row.email, image: row.image?.startsWith('https://') ? row.image : null,
      }))
    })
  }

  async putTag(scope: PublicationRepositoryScope, input: PublicationTag): Promise<boolean> {
    const value = parsePublicationContract('tag', PublicationTagSchema, input)
    try {
      return await this.#authorized(scope, async (db) => {
        const physicalId = rowId(scope, 'tags', value.tagId)
        const cells = JSON.stringify({ publicationProfileId: scope.profileId, publicationId: value.tagId, name: value.name, description: value.description })
        const existing = await db`select 1 from data_rows where id=${physicalId} and table_id=${tableId(scope, 'tags')} and deleted_at is null`
        if (existing.rowCount === 0) {
          const inserted = await db`
            insert into data_rows (id,table_id,cells_json,slug,status)
            values (${physicalId},${tableId(scope, 'tags')},${cells},${value.slug},${'draft'}) on conflict do nothing`
          if (inserted.rowCount !== 1) return false
          await db`
            insert into fuma_tenant_resource_owners (
              platform_id,owner_key,organization_id,workspace_id,site_id,resource_kind,class_id,source_name,legacy_id,legacy_identity_json,object_key,content_hash,size_bytes
            ) values (
              ${scope.platformId},${scope.ownerKey},${scope.organizationId},${scope.workspaceId},${scope.siteId},${'table-row'},${'content.data-row'},${'data_rows'},${physicalId},
              ${JSON.stringify({ id: physicalId, publicationProfileId: scope.profileId, publicationId: value.tagId, publicationKind: 'tag' })},${null},${null},${null}
            ) on conflict do nothing`
          return true
        }
        return (await db`
          update data_rows row set cells_json=${cells},slug=${value.slug},updated_at=current_timestamp
          from fuma_tenant_resource_owners owner
          where row.id=${physicalId} and row.table_id=${tableId(scope, 'tags')} and row.deleted_at is null
            and owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey}
            and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
            and owner.resource_kind='table-row' and owner.class_id='content.data-row'
         and owner.source_name='data_rows' and owner.legacy_id=row.id`).rowCount === 1
      })
    } catch (error) { if (isUniqueConflict(error)) return false; throw error }
  }

  async listTags(scope: PublicationRepositoryScope): Promise<readonly PublicationTag[]> {
    return await this.#authorized(scope, async (db) => (await this.#rows(db, scope, ['tags']))
      .map(tagFromRow).sort((left, right) => left.name.localeCompare(right.name) || left.tagId.localeCompare(right.tagId)))
  }

  async getSettings(scope: PublicationRepositoryScope): Promise<PublicationSettings | null> {
    return await this.#authorized(scope, async (db) => {
      const rows = await this.#rows(db, scope, ['settings'])
      return rows[0] ? settingsFromRow(rows[0]) : null
    })
  }

  async putSettings(scope: PublicationRepositoryScope, input: PublicationSettings, expectedVersion: number | null): Promise<boolean> {
    const value = parsePublicationContract('Publication settings', PublicationSettingsSchema, input)
    return await this.#authorized(scope, async (db) => {
      const currentRows = await this.#rows(db, scope, ['settings'])
      const current = currentRows[0] ? settingsFromRow(currentRows[0]) : null
      if (expectedVersion === null ? current !== null || value.version !== 1 : !current || current.publicationId !== value.publicationId || current.version !== expectedVersion || value.version !== expectedVersion + 1) return false
      const physicalId = rowId(scope, 'settings', value.publicationId)
      const cells = JSON.stringify({ publicationProfileId: scope.profileId, publicationId: value.publicationId, name: value.name, description: value.description, language: value.language, timezone: value.timezone, version: value.version, updatedAt: value.updatedAt })
      if (expectedVersion === null) {
        const inserted = await db`insert into data_rows (id,table_id,cells_json,slug,status,created_at,updated_at) values (${physicalId},${tableId(scope, 'settings')},${cells},${'publication'},${'draft'},${value.updatedAt},${value.updatedAt}) on conflict do nothing`
        if (inserted.rowCount !== 1) return false
        await db`
          insert into fuma_tenant_resource_owners (
            platform_id,owner_key,organization_id,workspace_id,site_id,resource_kind,class_id,source_name,legacy_id,legacy_identity_json,object_key,content_hash,size_bytes
          ) values (
            ${scope.platformId},${scope.ownerKey},${scope.organizationId},${scope.workspaceId},${scope.siteId},${'table-row'},${'content.data-row'},${'data_rows'},${physicalId},
            ${JSON.stringify({ id: physicalId, publicationProfileId: scope.profileId, publicationId: value.publicationId, publicationKind: 'settings' })},${null},${null},${null}
          ) on conflict do nothing`
        return true
      }
      const settingsTableId = tableId(scope, 'settings')
      const locked = await this.#lockedRow(db, scope, physicalId, settingsTableId)
      if (!locked || settingsFromRow(locked).version !== expectedVersion) return false
      return (await db`
        update data_rows row set cells_json=${cells},updated_at=${value.updatedAt}
        from fuma_tenant_resource_owners owner
        where row.id=${physicalId} and row.table_id=${settingsTableId} and row.deleted_at is null
          and owner.platform_id=${scope.platformId} and owner.owner_key=${scope.ownerKey}
          and owner.organization_id=${scope.organizationId} and owner.workspace_id=${scope.workspaceId} and owner.site_id=${scope.siteId}
          and owner.resource_kind='table-row' and owner.class_id='content.data-row'
          and owner.source_name='data_rows' and owner.legacy_id=row.id`).rowCount === 1
    })
  }
}

class UniversalConflict extends Error {}
