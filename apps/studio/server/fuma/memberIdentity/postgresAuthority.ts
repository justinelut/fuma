import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { PublicationRepositoryScopeSchema } from '../publication/scope'
import type { MemberSiteAuthority } from './boundary'

const RowSchema = Type.Object({
  platform_id: PublicationRepositoryScopeSchema.properties.platformId,
  organization_id: PublicationRepositoryScopeSchema.properties.organizationId,
  workspace_id: PublicationRepositoryScopeSchema.properties.workspaceId,
  site_id: PublicationRepositoryScopeSchema.properties.siteId,
  owner_key: PublicationRepositoryScopeSchema.properties.ownerKey,
  owner_generation: PublicationRepositoryScopeSchema.properties.generation,
  profile_id: PublicationRepositoryScopeSchema.properties.profileId,
}, { additionalProperties: false })
type Row = Static<typeof RowSchema>

export class PostgresMemberSiteAuthority implements MemberSiteAuthority {
  readonly db: DbClient
  constructor(db: DbClient) { this.db = db }
  async resolve(request: Request) {
    const url = new URL(request.url)
    const hostname = url.hostname.toLowerCase()
    const { rows } = await this.db<Row>`
      select owner.platform_id, owner.organization_id, owner.workspace_id, owner.site_id,
             owner.owner_key, owner.generation as owner_generation, site.profile_id
      from fuma_tenant_owner_keys owner
      join fuma_sites site on site.organization_id=owner.organization_id and site.workspace_id=owner.workspace_id and site.id=owner.site_id
      where owner.state='active' and owner.transfer_id is null and owner.transfer_lock_id is null and owner.transfer_fence is null
        and site.status='active'
        and (
          exists (select 1 from fuma_free_hosts_v2 free where free.host=${hostname} and free.state='active'
            and free.platform_id=owner.platform_id and free.organization_id=owner.organization_id and free.workspace_id=owner.workspace_id
            and free.site_id=owner.site_id and free.owner_key=owner.owner_key)
          or exists (select 1 from fuma_domains domain where domain.hostname=${hostname} and domain.desired='active'
            and domain.observed='active' and domain.certificate='active' and domain.organization_id=owner.organization_id
            and domain.workspace_id=owner.workspace_id and domain.site_id=owner.site_id)
        )
      limit 2`
    if (rows.length !== 1) return null
    const parsed = safeParseValue(RowSchema, rows[0])
    if (!parsed.ok) return null
    const row = parsed.value
    const scope = safeParseValue(PublicationRepositoryScopeSchema, {
      platformId: row.platform_id, organizationId: row.organization_id, workspaceId: row.workspace_id,
      siteId: row.site_id, ownerKey: row.owner_key, generation: row.owner_generation,
      state: 'active', transferFence: null, profileId: row.profile_id,
    })
    return scope.ok ? Object.freeze({ scope: Object.freeze(scope.value), origin: `https://${hostname}` }) : null
  }
}
