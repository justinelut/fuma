import type { DbClient } from '../../../db/client'
import type { ComponentCatalogAction, ComponentCatalogScope } from '../../../fuma/componentCatalog/contracts'
import type { ComponentCatalogService } from '../../../fuma/componentCatalog/service'

export interface SiteComponentCatalogPort { execute(input: Readonly<{ conversationId: string; actorId: string; operationId: string; action: ComponentCatalogAction; command: unknown; nativeAiAuthority: boolean }>): Promise<unknown> }
let port: SiteComponentCatalogPort | null = null
export function configureSiteComponentCatalogPort(value: SiteComponentCatalogPort): () => void { if (port && port !== value) throw new Error('Site component catalog port is already configured.'); port = value; return () => { if (port === value) port = null } }
export function siteComponentCatalogPort(): SiteComponentCatalogPort | null { return port }

type ScopeRow = Readonly<{ platform_id: string; organization_id: string; workspace_id: string; site_id: string; owner_key: string; owner_generation: string | number; profile_id: 'website' | 'publication'; actor_id: string }>
export class PostgresSiteComponentCatalogPort implements SiteComponentCatalogPort {
  readonly db: DbClient
  readonly service: ComponentCatalogService
  constructor(db: DbClient, service: ComponentCatalogService) { this.db = db; this.service = service; if (db.dialect !== 'postgres') throw new TypeError('Hosted component tools require PostgreSQL authority.') }
  async execute(input: Readonly<{ conversationId: string; actorId: string; operationId: string; action: ComponentCatalogAction; command: unknown; nativeAiAuthority: boolean }>) {
    if (input.nativeAiAuthority && input.action === 'confirm-source') throw new Error('Executable component confirmation requires the direct owner UI; AI can validate and disclose but cannot confirm for the owner.')
    const connectorId = input.conversationId.startsWith('mcp:') ? input.conversationId.slice(4) : null
    const result = connectorId
      ? await this.db.unsafe<ScopeRow>(`select b.platform_id,b.organization_id,b.workspace_id,b.site_id,b.owner_key,b.owner_generation,b.profile_id,b.actor_id from fuma_mcp_connector_bindings_v2 b join fuma_tenant_owner_keys o on o.platform_id=b.platform_id and o.organization_id=b.organization_id and o.workspace_id=b.workspace_id and o.site_id=b.site_id and o.owner_key=b.owner_key and o.generation=b.owner_generation where b.connector_id=$1 and b.actor_id=$2 and b.state='active' and o.state='active' and o.transfer_id is null`, [connectorId, input.actorId])
      : await this.db.unsafe<ScopeRow>(`select b.platform_id,b.organization_id,b.workspace_id,b.site_id,b.owner_key,b.owner_generation,b.profile_id,b.actor_id from fuma_site_ai_conversation_bindings b join fuma_tenant_owner_keys o on o.platform_id=b.platform_id and o.organization_id=b.organization_id and o.workspace_id=b.workspace_id and o.site_id=b.site_id and o.owner_key=b.owner_key and o.generation=b.owner_generation where b.conversation_id=$1 and b.actor_id=$2 and o.state='active' and o.transfer_id is null`, [input.conversationId, input.actorId])
    const row = result.rows[0]; if (!row) throw new Error('Exact live site component authority is unavailable.')
    const scope: ComponentCatalogScope = { platformId: row.platform_id, organizationId: row.organization_id, workspaceId: row.workspace_id, siteId: row.site_id, ownerKey: row.owner_key, ownerGeneration: Number(row.owner_generation), profileId: row.profile_id }
    return this.service.execute({ scope, actorId: input.actorId, operationId: input.operationId }, input.action, input.command)
  }
}
