import { Type, type Static } from '@core/utils/typeboxHelpers'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  NextSourceAdaptationService,
  NextSourceInteractionBindingSchema,
  NextSourcePatchSchema,
  type NextSourceDraftRevision,
  type NextSourceFixAuthority,
  type NextSourceFixReceipt,
} from '@core/siteImport'
import type { DbClient } from '../../../db/client'
import { PostgresNextSourceAdaptationAuthority } from '../../../fuma/nextSource/authority'
import { PostgresNextSourceDraftRepository, type NextSourceScope } from '../../../fuma/nextSource/postgres'
import type { TenantObjectStorage } from '../../../fuma/objectStorage'

const ID = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })

export const NextSourceAdaptationCommandSchema = Type.Object({
  revisionId: ID,
  diagnosticIds: Type.Array(ID, { minItems: 1, maxItems: 100, uniqueItems: true }),
  patches: Type.Array(NextSourcePatchSchema, { minItems: 1, maxItems: 100 }),
}, { additionalProperties: false })
export type NextSourceAdaptationCommand = Static<typeof NextSourceAdaptationCommandSchema>


export const NextSourceInteractionMappingCommandSchema = Type.Object({
  revisionId: ID,
  bindings: Type.Array(NextSourceInteractionBindingSchema, {
    minItems: 1,
    maxItems: 2_000,
  }),
}, { additionalProperties: false })
export type NextSourceInteractionMappingCommand = Static<typeof NextSourceInteractionMappingCommandSchema>
export type NextSourceAdaptationToolExecution = Readonly<{
  conversationId: string
  actorId: string
  operationId: string
  command: unknown
}>

export interface NextSourceAdaptationToolPort {
  execute(input: NextSourceAdaptationToolExecution): Promise<NextSourceFixReceipt>
  mapInteractions(input: NextSourceAdaptationToolExecution): Promise<NextSourceDraftRevision>
}

let configuredPort: NextSourceAdaptationToolPort | null = null

export function configureNextSourceAdaptationToolPort(value: NextSourceAdaptationToolPort): () => void {
  if (configuredPort && configuredPort !== value) throw new Error('Next source adaptation tool port is already configured.')
  configuredPort = value
  return () => {
    if (configuredPort === value) configuredPort = null
  }
}

export function nextSourceAdaptationToolPort(): NextSourceAdaptationToolPort | null {
  return configuredPort
}

type AuthorityRow = Readonly<{
  operation_id: string
  reservation_id: string | null
  platform_id: string
  organization_id: string
  workspace_id: string
  site_id: string
  owner_key: string
  owner_generation: string | number | bigint
  profile_id: string
}>

function scope(row: AuthorityRow): NextSourceScope {
  return {
    platformId: row.platform_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    ownerKey: row.owner_key,
    ownerGeneration: Number(row.owner_generation),
    profileId: row.profile_id,
  }
}

/**
 * Production adapter over the existing FUMA-065/FUMA-066 receipts. It accepts
 * no caller-supplied scope, owner generation, capability, or metering flags.
 */
export class PostgresNextSourceAdaptationToolPort implements NextSourceAdaptationToolPort {
  readonly #db: DbClient
  readonly #storage: TenantObjectStorage

  constructor(input: Readonly<{ db: DbClient; storage: TenantObjectStorage }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted source adaptation requires PostgreSQL authority.')
    this.#db = input.db
    this.#storage = input.storage
  }

  async execute(input: NextSourceAdaptationToolExecution): Promise<NextSourceFixReceipt> {
    const command = safeParseValue(NextSourceAdaptationCommandSchema, input.command)
    if (!command.ok) throw new Error('Source adaptation command failed strict TypeBox validation.')
    const connectorId = input.conversationId.startsWith('mcp:')
      ? input.conversationId.slice('mcp:'.length)
      : null
    const authorityKind: NextSourceFixAuthority['kind'] = connectorId ? 'mcp' : 'ai'
    const authorityResult = connectorId
      ? await this.#db.unsafe<AuthorityRow>(`
          select receipt.operation_id,receipt.reservation_id,
            binding.platform_id,binding.organization_id,binding.workspace_id,binding.site_id,
            binding.owner_key,binding.owner_generation,binding.profile_id
          from fuma_mcp_tool_receipts_v2 receipt
          join fuma_mcp_sessions_v2 session on session.session_id=receipt.session_id
          join fuma_mcp_connector_bindings_v2 binding on binding.connector_id=receipt.connector_id
          join fuma_tenant_owner_keys owner
            on owner.platform_id=binding.platform_id and owner.organization_id=binding.organization_id
            and owner.workspace_id=binding.workspace_id and owner.site_id=binding.site_id
            and owner.owner_key=binding.owner_key and owner.generation=binding.owner_generation
          where receipt.connector_id=$1 and receipt.operation_id=$2 and binding.actor_id=$3
            and receipt.tool_name='site_propose_source_fix' and receipt.capability='mutate'
            and receipt.state='started' and receipt.reservation_id is not null
            and session.state='active' and session.expires_at>current_timestamp and binding.state='active'
            and owner.state='active' and owner.transfer_id is null and owner.transfer_fence is null
        `, [connectorId, input.operationId, input.actorId])
      : await this.#db.unsafe<AuthorityRow>(`
          select tool.tool_call_id operation_id,job.reservation_id,
            job.platform_id,job.organization_id,job.workspace_id,job.site_id,
            job.owner_key,job.owner_generation,job.profile_id
          from fuma_site_ai_tool_receipts tool
          join fuma_site_ai_turn_jobs job on job.job_id=tool.job_id
          join fuma_tenant_owner_keys owner
            on owner.platform_id=job.platform_id and owner.organization_id=job.organization_id
            and owner.workspace_id=job.workspace_id and owner.site_id=job.site_id
            and owner.owner_key=job.owner_key and owner.generation=job.owner_generation
          where job.conversation_id=$1 and tool.tool_call_id=$2 and job.actor_id=$3
            and tool.tool_name='site_propose_source_fix' and tool.mutates=true and tool.state='started'
            and job.state='running' and job.required_capability='ai.tools.write' and job.reservation_id is not null
            and owner.state='active' and owner.transfer_id is null and owner.transfer_fence is null
        `, [input.conversationId, input.operationId, input.actorId])
    if (authorityResult.rows.length !== 1) throw new Error('Exact started native source-adaptation receipt is unavailable.')
    const row = authorityResult.rows[0]!
    if (!Number.isSafeInteger(Number(row.owner_generation)) || Number(row.owner_generation) < 1) {
      throw new Error('Source adaptation owner generation is invalid.')
    }
    const boundScope = scope(row)
    const authority: NextSourceFixAuthority = {
      kind: authorityKind,
      actorId: input.actorId,
      operationId: row.operation_id,
      sourceRevisionId: command.value.revisionId,
      destination: {
        organizationId: boundScope.organizationId,
        workspaceId: boundScope.workspaceId,
        siteId: boundScope.siteId,
      },
      ownerGeneration: boundScope.ownerGeneration,
      capability: 'source.mutate',
      meteringReservationId: row.reservation_id,
    }
    const repository = new PostgresNextSourceDraftRepository({
      db: this.#db,
      storage: this.#storage,
      scope: boundScope,
    })
    const service = new NextSourceAdaptationService({
      repository,
      authority: new PostgresNextSourceAdaptationAuthority({ db: this.#db, scope: boundScope }),
      ownerConfirmation: {
        async verifyOwner() {
          return Object.freeze({ active: false, direct: false, impersonating: false, ownerGeneration: 0 })
        },
      },
    })
    return service.proposeFix({
      authority,
      diagnosticIds: command.value.diagnosticIds,
      patches: command.value.patches,
    })
  }

  async mapInteractions(input: NextSourceAdaptationToolExecution): Promise<NextSourceDraftRevision> {
    const command = safeParseValue(NextSourceInteractionMappingCommandSchema, input.command)
    if (!command.ok) throw new Error('Source interaction mapping command failed strict TypeBox validation.')
    const toolName = 'site_map_source_interactions'
    const connectorId = input.conversationId.startsWith('mcp:')
      ? input.conversationId.slice('mcp:'.length)
      : null
    const authorityResult = connectorId
      ? await this.#db.unsafe<AuthorityRow>(`
          select receipt.operation_id,receipt.reservation_id,
            binding.platform_id,binding.organization_id,binding.workspace_id,binding.site_id,
            binding.owner_key,binding.owner_generation,binding.profile_id
          from fuma_mcp_tool_receipts_v2 receipt
          join fuma_mcp_sessions_v2 session on session.session_id=receipt.session_id
          join fuma_mcp_connector_bindings_v2 binding on binding.connector_id=receipt.connector_id
          join fuma_tenant_owner_keys owner
            on owner.platform_id=binding.platform_id and owner.organization_id=binding.organization_id
            and owner.workspace_id=binding.workspace_id and owner.site_id=binding.site_id
            and owner.owner_key=binding.owner_key and owner.generation=binding.owner_generation
          where receipt.connector_id=$1 and receipt.operation_id=$2 and binding.actor_id=$3
            and receipt.tool_name=$4 and receipt.capability='mutate'
            and receipt.state='started' and receipt.reservation_id is not null
            and session.state='active' and session.expires_at>current_timestamp and binding.state='active'
            and owner.state='active' and owner.transfer_id is null and owner.transfer_fence is null
        `, [connectorId, input.operationId, input.actorId, toolName])
      : await this.#db.unsafe<AuthorityRow>(`
          select tool.tool_call_id operation_id,job.reservation_id,
            job.platform_id,job.organization_id,job.workspace_id,job.site_id,
            job.owner_key,job.owner_generation,job.profile_id
          from fuma_site_ai_tool_receipts tool
          join fuma_site_ai_turn_jobs job on job.job_id=tool.job_id
          join fuma_tenant_owner_keys owner
            on owner.platform_id=job.platform_id and owner.organization_id=job.organization_id
            and owner.workspace_id=job.workspace_id and owner.site_id=job.site_id
            and owner.owner_key=job.owner_key and owner.generation=job.owner_generation
          where job.conversation_id=$1 and tool.tool_call_id=$2 and job.actor_id=$3
            and tool.tool_name=$4 and tool.mutates=true and tool.state='started'
            and job.state='running' and job.required_capability='ai.tools.write' and job.reservation_id is not null
            and owner.state='active' and owner.transfer_id is null and owner.transfer_fence is null
        `, [input.conversationId, input.operationId, input.actorId, toolName])
    if (authorityResult.rows.length !== 1) throw new Error('Exact started native source-interaction mapping receipt is unavailable.')
    const row = authorityResult.rows[0]!
    if (!Number.isSafeInteger(Number(row.owner_generation)) || Number(row.owner_generation) < 1) {
      throw new Error('Source interaction mapping owner generation is invalid.')
    }
    const boundScope = scope(row)
    const repository = new PostgresNextSourceDraftRepository({
      db: this.#db,
      storage: this.#storage,
      scope: boundScope,
    })
    const service = new NextSourceAdaptationService({
      repository,
      authority: new PostgresNextSourceAdaptationAuthority({ db: this.#db, scope: boundScope }),
      ownerConfirmation: {
        async verifyOwner() {
          return Object.freeze({ active: false, direct: false, impersonating: false, ownerGeneration: 0 })
        },
      },
    })
    return service.mapInteractions({
      sourceRevisionId: command.value.revisionId,
      profileId: boundScope.profileId,
      bindings: command.value.bindings,
    })
  }
}
