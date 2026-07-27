import {
  DynamicPublicationLoopItemSchema,
  DynamicPublicationLoopQuerySchema,
  DynamicPublicationTemplateSchema,
  parseDynamicPublicationContract,
  type DynamicPublicationLoopItem,
  type DynamicPublicationLoopQuery,
  type DynamicPublicationTarget,
  type DynamicPublicationTemplate,
} from '@core/fuma/publication/dynamicPublication'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import { placeholder, type DbClient } from '../../db/client'
import { jsonField } from '../../db/jsonExtract'
import { PublicationScopeError, type PublicationRepositoryScope } from './scope'

export interface DynamicPublicationRepository {
  saveTemplate(scope: PublicationRepositoryScope, template: DynamicPublicationTemplate, expectedVersion: number | null): Promise<boolean>
  listTemplates(scope: PublicationRepositoryScope): Promise<readonly DynamicPublicationTemplate[]>
  resolveTemplate(scope: PublicationRepositoryScope, target: DynamicPublicationTarget): Promise<DynamicPublicationTemplate | null>
  queryLoop(scope: PublicationRepositoryScope, query: DynamicPublicationLoopQuery): Promise<Readonly<{ items: readonly DynamicPublicationLoopItem[]; total: number }>>
}

interface TemplateRow {
  template_id: string
  name: string
  target_kind: string
  target_id: string
  document_json: unknown
  empty_state: string
  version: string | number | bigint
  active: boolean
  created_at: string | Date
  updated_at: string | Date
}
interface LoopEnvelopeRow { total_count: string | number | bigint; items_json: unknown }

const StoredLoopItemsSchema = Type.Array(DynamicPublicationLoopItemSchema, { maxItems: 50 })

function integer(value: string | number | bigint): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Stored Dynamic Publication integer is invalid.')
  return parsed
}
function iso(value: string | Date): string { return new Date(value).toISOString() }
function json(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : structuredClone(value) }
function templateFromRow(row: TemplateRow): DynamicPublicationTemplate {
  return parseDynamicPublicationContract('stored template', DynamicPublicationTemplateSchema, {
    templateId: row.template_id,
    name: row.name,
    target: { kind: row.target_kind, targetId: row.target_id === '*' ? null : row.target_id },
    document: json(row.document_json),
    emptyState: row.empty_state,
    version: integer(row.version),
    active: row.active,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  })
}

/** Exact owner-generation/profile authority plus O(1)-query archive projection. */
export class PostgresDynamicPublicationRepository implements DynamicPublicationRepository {
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
          and owner.organization_id=${scope.organizationId}
          and owner.workspace_id=${scope.workspaceId}
          and owner.site_id=${scope.siteId}
          and owner.owner_key=${scope.ownerKey}
          and owner.generation=${scope.generation}
          and owner.state='active'
          and owner.transfer_id is null
          and owner.transfer_lock_id is null
          and owner.transfer_fence is null
          and site.profile_id=${scope.profileId}
        for share`
      if (authority.rowCount !== 1) throw new PublicationScopeError()
      return await work(db)
    })
  }

  async saveTemplate(scope: PublicationRepositoryScope, input: DynamicPublicationTemplate, expectedVersion: number | null): Promise<boolean> {
    const value = parseDynamicPublicationContract('template', DynamicPublicationTemplateSchema, input)
    const targetId = value.target.targetId ?? '*'
    return await this.#authorized(scope, async (db) => expectedVersion === null
      ? (await db`
          insert into fuma_dynamic_publication_templates (
            platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
            template_id,name,target_kind,target_id,document_json,empty_state,version,active,created_at,updated_at
          ) values (
            ${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},
            ${value.templateId},${value.name},${value.target.kind},${targetId},${JSON.stringify(value.document)}::text::jsonb,${value.emptyState},${value.version},${value.active},${value.createdAt},${value.updatedAt}
          ) on conflict do nothing`).rowCount === 1
      : (await db`
          update fuma_dynamic_publication_templates set
            name=${value.name},target_kind=${value.target.kind},target_id=${targetId},document_json=${JSON.stringify(value.document)}::text::jsonb,
            empty_state=${value.emptyState},version=${value.version},active=${value.active},updated_at=${value.updatedAt}
          where platform_id=${scope.platformId} and organization_id=${scope.organizationId}
            and workspace_id=${scope.workspaceId} and site_id=${scope.siteId}
            and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId}
            and template_id=${value.templateId} and version=${expectedVersion}`).rowCount === 1)
  }

  async listTemplates(scope: PublicationRepositoryScope): Promise<readonly DynamicPublicationTemplate[]> {
    return await this.#authorized(scope, async (db) => {
      const { rows } = await db<TemplateRow>`
        select template_id,name,target_kind,target_id,document_json,empty_state,version,active,created_at,updated_at
        from fuma_dynamic_publication_templates
        where platform_id=${scope.platformId} and organization_id=${scope.organizationId}
          and workspace_id=${scope.workspaceId} and site_id=${scope.siteId}
          and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId}
        order by target_kind,target_id,name,template_id`
      return Object.freeze(rows.map(templateFromRow))
    })
  }

  async resolveTemplate(scope: PublicationRepositoryScope, target: DynamicPublicationTarget): Promise<DynamicPublicationTemplate | null> {
    const selector = target.targetId ?? '*'
    return await this.#authorized(scope, async (db) => {
      const { rows } = await db<TemplateRow>`
        select template_id,name,target_kind,target_id,document_json,empty_state,version,active,created_at,updated_at
        from fuma_dynamic_publication_templates
        where platform_id=${scope.platformId} and organization_id=${scope.organizationId}
          and workspace_id=${scope.workspaceId} and site_id=${scope.siteId}
          and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId}
          and target_kind=${target.kind} and active=true and (target_id=${selector} or target_id='*')
        order by case when target_id=${selector} then 0 else 1 end,updated_at desc,template_id
        limit 1`
      return rows[0] ? templateFromRow(rows[0]) : null
    })
  }

  async queryLoop(scope: PublicationRepositoryScope, input: DynamicPublicationLoopQuery): Promise<Readonly<{ items: readonly DynamicPublicationLoopItem[]; total: number }>> {
    const query = parseDynamicPublicationContract('loop query', DynamicPublicationLoopQuerySchema, input)
    if (query.target.targetId === null) throw new TypeError('Dynamic Publication loop target requires a selector.')
    const offset = (query.page - 1) * query.pageSize
    const segments = JSON.stringify(query.audience.segmentIds)
    return await this.#authorized(scope, async (db) => {
      const params: unknown[] = []
      const bind = (value: unknown): string => {
        params.push(value)
        return placeholder(db.dialect, params.length)
      }
      const publicationId = jsonField('cells_json', 'publicationId', db.dialect).sql
      const publicationProfileId = jsonField('cells_json', 'publicationProfileId', db.dialect).sql
      const workflowStatus = jsonField('cells_json', 'workflowStatus', db.dialect).sql
      const publicationKind = jsonField('cells_json', 'publicationKind', db.dialect).sql
      const publicationCollectionId = jsonField('cells_json', 'publicationCollectionId', db.dialect).sql
      const title = jsonField('cells_json', 'title', db.dialect).sql
      const excerpt = jsonField('cells_json', 'excerpt', db.dialect).sql
      const sql = `
        with eligible as (
          select row.id,row.slug,row.published_at,
            ${publicationId} publication_id,${publicationKind} publication_kind,
            ${title} title,coalesce(${excerpt},'') excerpt
          from data_rows row
          join fuma_tenant_resource_owners owner
            on owner.platform_id=${bind(scope.platformId)} and owner.organization_id=${bind(scope.organizationId)}
           and owner.workspace_id=${bind(scope.workspaceId)} and owner.site_id=${bind(scope.siteId)}
           and owner.owner_key=${bind(scope.ownerKey)} and owner.resource_kind='table-row'
           and owner.class_id='content.data-row' and owner.source_name='data_rows' and owner.legacy_id=row.id
          join fuma_publication_metadata_authority authority
            on authority.platform_id=${bind(scope.platformId)} and authority.organization_id=${bind(scope.organizationId)}
           and authority.workspace_id=${bind(scope.workspaceId)} and authority.site_id=${bind(scope.siteId)}
           and authority.owner_key=${bind(scope.ownerKey)} and authority.owner_generation=${bind(scope.generation)}
           and authority.profile_id=${bind(scope.profileId)} and authority.content_id=${publicationId}
          where row.deleted_at is null and row.status='published' and row.published_at is not null and row.published_at<=${bind(query.asOf)}
            and ${publicationProfileId}=${bind(scope.profileId)}
            and ${workflowStatus}='published'
            and (
              authority.visibility_kind='public'
              or (authority.visibility_kind='member' and ${bind(query.audience.member)})
              or (authority.visibility_kind='paid' and ${bind(query.audience.paid)} and ${bind(query.audience.memberId ?? '')}<>'' and exists (
                select 1 from fuma_publication_member_access member_access
                where member_access.platform_id=${bind(scope.platformId)}
                  and member_access.organization_id=${bind(scope.organizationId)}
                  and member_access.workspace_id=${bind(scope.workspaceId)}
                  and member_access.site_id=${bind(scope.siteId)}
                  and member_access.owner_key=${bind(scope.ownerKey)}
                  and member_access.owner_generation=${bind(scope.generation)}
                  and member_access.profile_id=${bind(scope.profileId)}
                  and member_access.member_id=${bind(query.audience.memberId ?? '')}
                  and member_access.access='premium'
                  and member_access.state in ('active','grace')
                  and member_access.starts_at<=${bind(query.asOf)}
                  and ((member_access.expires_at is null or member_access.expires_at>${bind(query.asOf)})
                    or (member_access.grace_ends_at is not null and member_access.grace_ends_at>${bind(query.asOf)}))
                  and (
                    (member_access.resource_kind='publication' and member_access.resource_id=${bind(scope.siteId)})
                    or (member_access.resource_kind='post' and member_access.resource_id=authority.content_id)
                    or (member_access.resource_kind='tag' and exists (
                      select 1 from data_row_relations access_tag
                      where access_tag.platform_id=${bind(scope.platformId)}
                        and access_tag.organization_id=${bind(scope.organizationId)}
                        and access_tag.workspace_id=${bind(scope.workspaceId)}
                        and access_tag.site_id=${bind(scope.siteId)}
                        and access_tag.owner_key=${bind(scope.ownerKey)}
                        and access_tag.profile_id=${bind(scope.profileId)}
                        and access_tag.source_row_id=row.id
                        and access_tag.relation_kind='tag'
                        and access_tag.target_id=member_access.resource_id
                    ))
                  )
              ))
              or (authority.visibility_kind='segment' and exists (
                select 1 from jsonb_array_elements_text(coalesce(authority.snapshot_json#>'{metadata,visibility,segmentIds}','[]'::jsonb)) allowed(value)
                join jsonb_array_elements_text(${bind(segments)}::text::jsonb) supplied(value) using (value)
              ))
            )
            and (
              (${bind(query.target.kind)}='post' and ${publicationKind}='post' and row.slug=${bind(query.target.targetId)})
              or (${bind(query.target.kind)}='page' and ${publicationKind}='page' and row.slug=${bind(query.target.targetId)})
              or (${bind(query.target.kind)}='author' and exists (
                select 1 from data_row_relations relation where relation.platform_id=${bind(scope.platformId)}
                  and relation.organization_id=${bind(scope.organizationId)} and relation.workspace_id=${bind(scope.workspaceId)}
                  and relation.site_id=${bind(scope.siteId)} and relation.owner_key=${bind(scope.ownerKey)} and relation.profile_id=${bind(scope.profileId)}
                  and relation.source_row_id=row.id and relation.relation_kind='author' and relation.target_id=${bind(query.target.targetId)}
              ))
              or (${bind(query.target.kind)}='tag' and exists (
                select 1 from data_row_relations relation where relation.platform_id=${bind(scope.platformId)}
                  and relation.organization_id=${bind(scope.organizationId)} and relation.workspace_id=${bind(scope.workspaceId)}
                  and relation.site_id=${bind(scope.siteId)} and relation.owner_key=${bind(scope.ownerKey)} and relation.profile_id=${bind(scope.profileId)}
                  and relation.source_row_id=row.id and relation.relation_kind='tag' and relation.target_id=${bind(query.target.targetId)}
              ))
              or (${bind(query.target.kind)}='date' and (
                to_char(row.published_at at time zone 'UTC','YYYY')=${bind(query.target.targetId)}
                or to_char(row.published_at at time zone 'UTC','YYYY-MM')=${bind(query.target.targetId)}
              ))
              or (${bind(query.target.kind)}='collection' and (
                (${bind(query.target.targetId)}='posts' and ${publicationKind}='post')
                or (${bind(query.target.targetId)}='pages' and ${publicationKind}='page')
                or ${publicationCollectionId}=${bind(query.target.targetId)}
              ))
            )
        ), paged as (
          select * from eligible order by published_at desc,id limit ${bind(query.pageSize)} offset ${bind(offset)}
        ), relations as (
          select relation.source_row_id,
            coalesce(jsonb_agg(relation.target_id order by relation.position) filter (where relation.relation_kind='author'),'[]'::jsonb) author_ids,
            coalesce(jsonb_agg(relation.target_id order by relation.position) filter (where relation.relation_kind='tag'),'[]'::jsonb) tag_ids
          from data_row_relations relation join paged on paged.id=relation.source_row_id
          where relation.platform_id=${bind(scope.platformId)} and relation.organization_id=${bind(scope.organizationId)}
            and relation.workspace_id=${bind(scope.workspaceId)} and relation.site_id=${bind(scope.siteId)}
            and relation.owner_key=${bind(scope.ownerKey)} and relation.profile_id=${bind(scope.profileId)}
          group by relation.source_row_id
        )
        select (select count(*) from eligible) total_count,
          coalesce(jsonb_agg(jsonb_build_object(
            'contentId',paged.publication_id,'kind',paged.publication_kind,
            'title',paged.title,'slug',paged.slug,'excerpt',paged.excerpt,
            'publishedAt',to_char(paged.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'authorIds',coalesce(relations.author_ids,'[]'::jsonb),'tagIds',coalesce(relations.tag_ids,'[]'::jsonb)
          ) order by paged.published_at desc,paged.id) filter (where paged.id is not null),'[]'::jsonb) items_json
        from (select 1 marker) singleton left join paged on true left join relations on relations.source_row_id=paged.id`
      const { rows } = await db.unsafe<LoopEnvelopeRow>(sql, params)
      const row = rows[0] ?? { total_count: 0, items_json: [] }
      const parsed = safeParseValue(StoredLoopItemsSchema, json(row.items_json))
      if (!parsed.ok) throw new Error('Stored Dynamic Publication loop projection is invalid.')
      return Object.freeze({ items: Object.freeze(parsed.value), total: integer(row.total_count) })
    })
  }

}
