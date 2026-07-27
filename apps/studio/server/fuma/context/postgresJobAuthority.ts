import type { DbClient } from '../../db/client'
import { PLATFORM_ORGANIZATION_ID } from '../organizations'
import type { FumaJobContextAuthority, FumaJobAuthorityLookupInput } from './jobContext'

interface JobSiteRow{platform_id:string;organization_id:string;organization_kind:'platform'|'customer';organization_status:'active'|'suspended'|'archived';workspace_id:string;workspace_status:'active'|'archived';site_id:string;site_status:'active'|'archived';profile_id:string;capability_overrides_json:unknown}

/** Reloads trusted job authority from PostgreSQL; payload values never select tenancy. */
export class PostgresFumaJobContextAuthority implements FumaJobContextAuthority{
  readonly #db:DbClient
  constructor(db:DbClient){if(db.dialect!=='postgres')throw new Error('Fuma job-context authority requires PostgreSQL.');this.#db=db}
  async loadTrustedJobAuthority(input:FumaJobAuthorityLookupInput):Promise<unknown|null>{
    if(input.siteId===null)return null
    const {rows}=await this.#db<JobSiteRow>`select owner.platform_id,organization.organization_id,organization.kind as organization_kind,organization.status as organization_status,workspace.id as workspace_id,workspace.status as workspace_status,site.id as site_id,site.status as site_status,site.profile_id,site.capability_overrides_json from fuma_sites site join fuma_workspaces workspace on workspace.organization_id=site.organization_id and workspace.id=site.workspace_id join fuma_organization_profiles organization on organization.organization_id=site.organization_id join fuma_tenant_owner_keys owner on owner.organization_id=site.organization_id and owner.workspace_id=site.workspace_id and owner.site_id=site.id where site.organization_id=${input.organizationId} and site.id=${input.siteId} and owner.state='active' and owner.transfer_id is null and owner.transfer_lock_id is null and owner.transfer_fence is null`
    if(rows.length!==1)return null
    const row=rows[0]!;const subjectId=`job-${input.jobId}`;const binding={platformId:row.platform_id,organizationId:row.organization_id,workspaceId:row.workspace_id,siteId:row.site_id}
    return {kind:'site',originatingRequestId:null,authorization:{platformOrganizationId:PLATFORM_ORGANIZATION_ID,platform:{id:row.platform_id,status:'active'},organization:{id:row.organization_id,platformId:row.platform_id,kind:row.organization_kind,status:row.organization_status},workspace:{id:row.workspace_id,platformId:row.platform_id,organizationId:row.organization_id,status:row.workspace_status},site:{id:row.site_id,platformId:row.platform_id,organizationId:row.organization_id,workspaceId:row.workspace_id,profileId:row.profile_id,status:row.site_status},profile:{...binding,id:row.profile_id,status:'active'},capabilities:{...binding,profileId:row.profile_id,overrides:row.capability_overrides_json},permissions:{subjectId,scope:{kind:'site',...binding},protectedOwnerInvariant:null,roleAssignments:[{id:`job-authority-${input.jobId}`,subjectId,scope:{kind:'organization',platformId:row.platform_id,organizationId:row.organization_id},role:{kind:'launch-persona',persona:'owner'}}],permissionOverrides:[],customRoles:[]}}}
  }
}
