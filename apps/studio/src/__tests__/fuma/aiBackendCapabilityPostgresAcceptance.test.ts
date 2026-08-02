import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { generateConnectorToken, hashConnectorToken } from '../../../server/ai/mcp/connectors/token'
import { siteAiScopeAuthorityMigration } from '../../../server/fuma/db/migrations/000068_site_ai_scope_authority'
import { mcpConnectorAuthorityMigration } from '../../../server/fuma/db/migrations/000069_mcp_connector_authority'
import { componentCatalogAuthorityMigration } from '../../../server/fuma/db/migrations/000075_component_catalog_authority'
import {
  ComponentCatalogService,
  PostgresComponentCatalogRepository,
} from '../../../server/fuma/componentCatalog'
import {
  MemorySiteAiLiveAuthority,
  PostgresSiteAiRepository,
  SiteAiService,
  hashSiteAiSnapshot,
  type SiteAiAuthoritySnapshot,
} from '../../../server/fuma/siteAi'
import {
  McpService,
  PostgresMcpRepository,
  hashMcpValue,
} from '../../../server/fuma/mcp'
import { PostgresAiBackendCapabilityRuntime } from '../../../server/fuma/aiBackendCapabilities'
import { release } from './componentCatalogFixture'
import { releaseCoordinate } from '../../../../../tooling/component-packs/contracts'
import { mcpRates } from './mcpTestFixture'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-07-31T08:59:42.000Z'
const scope = Object.freeze({
  platformId: 'fuma',
  organizationId: 'org-test',
  workspaceId: 'workspace-test',
  siteId: 'site-test',
  ownerKey: 'owner-test',
  ownerGeneration: 3,
  profileId: 'website' as const,
})

function quote(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.')
  return `"${value}"`
}
function scoped(connection: string, schema: string): string {
  const url = new URL(connection)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}
function command(usageId: string) {
  return {
    coordinate: 'test.owner/hero@1.0.0',
    componentId: 'hero',
    usageId,
    kind: 'page-node' as const,
    resourceId: 'home',
    parentNodeId: 'home-root',
    variantId: null,
    props: { heading: 'Shared reviewed capability' },
  }
}

const siteAuthority: SiteAiAuthoritySnapshot = {
  scope,
  actor: { actorId: 'actor-shared', sessionId: 'better-auth-session', editorSessionId: 'editor-session' },
  capabilities: ['ai.chat', 'ai.tools.write', 'site.structure.edit'],
  state: 'active',
  revision: 1,
  observedAt: NOW,
}

describe('FUMA-086 optional native PostgreSQL acceptance', () => {
  it.skipIf(!postgresUrl)('serializes Site AI/MCP receipts and persists one scoped mutation per channel without direct authority', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_backend_capability_086_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await db.unsafe(`
        create table ai_conversations(id text primary key);
        create table ai_mcp_connectors(
          id text primary key,user_id text not null,label text not null,type text not null,
          auth_mode text not null,token_hash text unique,capabilities_json jsonb not null,
          created_at timestamptz not null,last_used_at timestamptz null,
          revoked_at timestamptz null,expires_at timestamptz null
        );
        create table fuma_tenant_owner_keys(
          platform_id text not null,owner_key text not null,organization_id text not null,
          workspace_id text not null,site_id text not null,generation bigint not null,
          state text not null,transfer_id text null,transfer_lock_id text null,
          transfer_fence bigint null,created_at timestamptz not null,updated_at timestamptz not null,
          primary key(platform_id,owner_key),
          unique(platform_id,owner_key,organization_id,workspace_id,site_id)
        );
      `)
      await db`insert into fuma_tenant_owner_keys(
        platform_id,owner_key,organization_id,workspace_id,site_id,generation,state,
        transfer_id,transfer_lock_id,transfer_fence,created_at,updated_at
      ) values (
        ${scope.platformId},${scope.ownerKey},${scope.organizationId},${scope.workspaceId},
        ${scope.siteId},${scope.ownerGeneration},'active',null,null,null,${NOW},${NOW}
      )`
      await db.unsafe(siteAiScopeAuthorityMigration.sql)
      await db.unsafe(mcpConnectorAuthorityMigration.sql)
      await db.unsafe(componentCatalogAuthorityMigration.sql)

      const componentRepository = new PostgresComponentCatalogRepository(db)
      const components = new ComponentCatalogService({
        repository: componentRepository,
        reviews: { marketplace: async () => [], install: async () => { throw new Error('not expected') } } as never,
        artifacts: { readVerifiedArtifact: async () => { throw new Error('not expected') } } as never,
        now: () => new Date(NOW),
      })
      await components.create({ scope, actorId: 'actor-shared', operationId: 'seed-release' }, {
        release: release(),
        previousCoordinate: null,
      })
      expect(releaseCoordinate(release())).toBe('test.owner/hero@1.0.0')

      const meterEvents: unknown[] = []
      const capability = new PostgresAiBackendCapabilityRuntime({
        db,
        components,
        metering: { async record(value) { meterEvents.push(structuredClone(value)) } },
        now: () => new Date(NOW),
      })

      await db`insert into ai_conversations(id) values ('conversation-086')`
      const siteRepository = new PostgresSiteAiRepository(db)
      const live = new MemorySiteAiLiveAuthority()
      live.set(siteAuthority)
      let siteAudit = 0
      const siteAi = new SiteAiService({
        repository: siteRepository,
        liveAuthority: live,
        models: { authorize: async () => {} },
        credits: {
          reserve: async () => {},
          settle: async () => {},
          release: async () => {},
        },
        now: () => new Date(NOW),
        generateAuditId: () => `site-audit-${++siteAudit}`,
      })
      await siteAi.bindConversation({ conversationId: 'conversation-086', authority: siteAuthority })
      const snapshot = { siteId: scope.siteId }
      await siteAi.bindSnapshot({
        snapshotId: 'snapshot-086',
        conversationId: 'conversation-086',
        sequence: 0,
        snapshotHashSha256: await hashSiteAiSnapshot(snapshot),
        authority: siteAuthority,
      })
      const siteTurn = await siteAi.beginTurn({
        jobId: 'job-086',
        conversationId: 'conversation-086',
        snapshotId: 'snapshot-086',
        providerId: 'provider-test',
        modelId: 'model-test',
        requiredCapability: 'ai.chat',
        estimatedInputTokens: 10,
        estimatedOutputTokens: 10,
        attempt: 1,
        authority: siteAuthority,
      })
      const siteCommand = command('usage-site-ai')
      const siteInputHash = await hashSiteAiSnapshot(siteCommand)
      await siteTurn.authority.authorizeTool({
        toolCallId: 'operation-site-ai',
        toolName: 'site_insert_component',
        mutates: true,
        input: siteCommand,
      })
      const siteContenders = await Promise.all(Array.from({ length: 7 }, () => siteRepository.claimTool({
        jobId: 'job-086',
        toolCallId: 'operation-site-ai',
        toolName: 'site_insert_component',
        inputHashSha256: siteInputHash,
        mutates: true,
        state: 'started',
        attempt: 1,
        output: null,
        createdAt: NOW,
        completedAt: null,
      })))
      expect(siteContenders.every((item) => item.outcome === 'in-flight')).toBe(true)
      await expect(capability.insertDataBackedSection({
        conversationId: 'conversation-086',
        actorId: 'actor-shared',
        operationId: 'operation-site-ai',
        permissions: ['site.structure.edit'],
      }, { ...siteCommand, usageId: 'usage-changed-replay' })).rejects.toThrow('does not match')
      expect(await componentRepository.listUsage(scope)).toHaveLength(0)
      const siteResult = await capability.insertDataBackedSection({
        conversationId: 'conversation-086',
        actorId: 'actor-shared',
        operationId: 'operation-site-ai',
        permissions: ['site.structure.edit'],
      }, siteCommand)
      expect(siteResult.receipt.channel).toBe('site-ai')
      await siteTurn.authority.recordToolResult({
        toolCallId: 'operation-site-ai',
        toolName: 'site_insert_component',
        mutates: true,
        input: siteCommand,
        output: { ok: true, data: siteResult },
      })

      const mcpRepository = new PostgresMcpRepository(db)
      let mcpAudit = 0
      const mcp = new McpService({
        repository: mcpRepository,
        liveAuthority: { load: async (connector) => ({ active: true, actorId: connector.actorId, scope: connector.scope, revision: connector.version }) },
        credits: { reserve: async () => {}, settle: async () => {}, release: async () => {} },
        confirmations: { verify: async () => {} },
        now: () => new Date(NOW),
        generateId: () => `mcp-audit-${++mcpAudit}`,
      })
      const token = generateConnectorToken()
      const tokenHash = await hashConnectorToken(token)
      await mcp.createConnector({
        connectorId: 'connector-086',
        actorId: 'actor-shared',
        label: 'FUMA-086',
        type: 'remote',
        scope,
        tokenHash,
        capabilities: ['site.read', 'site.mutate', 'component.mutate'],
        toolCapabilities: ['ai.chat', 'ai.tools.write', 'site.read', 'site.structure.edit'],
        rates: mcpRates,
        state: 'active',
        version: 1,
        createdAt: NOW,
        expiresAt: '2026-08-31T08:59:42.000Z',
        revokedAt: null,
        lastUsedAt: null,
      })
      await mcp.authenticate({ tokenHash, sessionId: 'mcp-session-086', expectedScope: scope })
      const mcpCommand = command('usage-mcp')
      const operation = {
        sessionId: 'mcp-session-086',
        operationId: 'operation-mcp',
        toolName: 'site_insert_component',
        capability: 'mutate' as const,
        connectorCapability: 'component.mutate' as const,
        inputHashSha256: await hashMcpValue(mcpCommand),
        estimatedInputTokens: 10,
        estimatedOutputTokens: 10,
        confirmation: null,
      }
      const mcpStarted = await mcp.beginOperation(operation)
      const mcpAttempts = await Promise.allSettled(Array.from({ length: 8 }, () =>
        capability.insertDataBackedSection({
          conversationId: 'mcp:connector-086',
          actorId: 'actor-shared',
          operationId: 'operation-mcp',
          permissions: ['site.structure.edit'],
        }, mcpCommand),
      ))
      const mcpSuccesses = mcpAttempts.filter((item) => item.status === 'fulfilled')
      const mcpDenials = mcpAttempts.filter((item) => item.status === 'rejected')
      expect(mcpSuccesses).toHaveLength(1)
      expect(mcpDenials).toHaveLength(7)
      expect(mcpDenials.every((item) => String(item.reason).includes('already executed'))).toBe(true)
      const mcpResult = mcpSuccesses[0]!.value
      expect(mcpResult.receipt.channel).toBe('mcp')
      await mcp.completeOperation({
        receipt: mcpStarted.receipt,
        output: { ok: true, data: mcpResult },
        inputTokens: 10,
        outputTokens: 10,
      })

      expect((await componentRepository.listUsage(scope)).map((item) => item.usageId).sort())
        .toEqual(['usage-mcp', 'usage-site-ai'])
      expect(meterEvents).toHaveLength(2)
      const insertionAudits = await db.unsafe<{ count: string }>(`
        select count(*)::text count from fuma_component_catalog_audit_v1
        where action='component.inserted'
      `)
      expect(insertionAudits.rows[0]?.count).toBe('2')
      const siteTerminal = await db.unsafe<{ output_json: unknown }>(`
        select output_json from fuma_site_ai_tool_receipts
        where tool_call_id='operation-site-ai' and state='completed'
      `)
      const mcpTerminal = await db.unsafe<{ output_json: unknown }>(`
        select output_json from fuma_mcp_tool_receipts_v2
        where operation_id='operation-mcp' and state='completed'
      `)
      expect(siteTerminal.rows).toHaveLength(1)
      expect(mcpTerminal.rows).toHaveLength(1)
      expect(JSON.stringify([siteTerminal.rows[0]?.output_json, mcpTerminal.rows[0]?.output_json]))
        .not.toContain('better-auth-session')
      expect(JSON.stringify([siteTerminal.rows[0]?.output_json, mcpTerminal.rows[0]?.output_json]))
        .not.toContain(scope.ownerKey)
      expect(JSON.stringify([siteResult, mcpResult])).not.toContain('better-auth-session')
      expect(JSON.stringify([siteResult, mcpResult])).not.toContain(scope.ownerKey)
      expect(await siteRepository.claimTool({
        ...siteContenders[0]!.receipt,
        inputHashSha256: 'f'.repeat(64),
      })).toMatchObject({ outcome: 'conflict' })
      await expect(db`delete from fuma_component_catalog_usage_v1`).rejects.toThrow('append-only')
      await expect(db`delete from fuma_component_catalog_audit_v1`).rejects.toThrow('immutable')

      await db`update fuma_tenant_owner_keys set state='transferring',transfer_id='transfer-086' where platform_id=${scope.platformId} and owner_key=${scope.ownerKey}`
      const before = (await componentRepository.listUsage(scope)).length
      await expect(capability.insertDataBackedSection({
        conversationId: 'conversation-086',
        actorId: 'actor-shared',
        operationId: 'operation-site-ai',
        permissions: ['site.structure.edit'],
      }, { ...siteCommand, usageId: 'usage-revoked' })).rejects.toThrow('unavailable')
      expect((await componentRepository.listUsage(scope))).toHaveLength(before)

      process.stdout.write('[FUMA-086 PostgreSQL demo] channels=site-ai,mcp contention=8/8 usages=2 meters=2 immutable=usage,audit revoked=denied\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftovers = await admin<{ count: string }>`select count(*)::text count from pg_namespace where nspname=${schema}`
      expect(leftovers.rows[0]?.count).toBe('0')
    }
  }, 120_000)
})
