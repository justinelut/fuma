import type { DbClient } from '../../../server/db/client'
import type { EditorSiteDocument } from '../../../server/fuma/editor/contracts'
import type { FumaJobService } from '../../../server/fuma/jobs'
import type { McpConnector, McpScope, McpSession } from '../../../server/fuma/mcp/contracts'
import {
  HostedMcpPublishConfirmationAuthority,
  PostgresMcpHostedPublishPort,
  readHostedAiByokMetadataKey,
} from '../../../server/fuma/mcp/productionRuntime'

const NOW = '2026-07-29T03:00:00.000Z'
const scope: McpScope = Object.freeze({
  platformId: 'fuma',
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  ownerKey: 'owner-a',
  ownerGeneration: 2,
  profileId: 'website',
})
const connector: McpConnector = Object.freeze({
  connectorId: 'connector-a',
  actorId: 'actor-a',
  label: 'Publisher',
  type: 'remote',
  scope,
  tokenHash: 'A'.repeat(43),
  capabilities: ['site.publish'],
  toolCapabilities: ['pages.publish'],
  rates: {
    read: { requestsPerMinute: 10, reserveInputTokens: 10, reserveOutputTokens: 10 },
    mutate: { requestsPerMinute: 10, reserveInputTokens: 10, reserveOutputTokens: 10 },
    publish: { requestsPerMinute: 2, reserveInputTokens: 10, reserveOutputTokens: 10 },
  },
  state: 'active',
  version: 1,
  createdAt: '2026-07-29T02:00:00.000Z',
  expiresAt: '2026-07-30T03:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
})
const mcpSession: McpSession = Object.freeze({
  sessionId: 'session-a',
  connectorId: connector.connectorId,
  actorId: connector.actorId,
  scope,
  connectorVersion: connector.version,
  state: 'active',
  openedAt: NOW,
  expiresAt: '2026-07-29T03:15:00.000Z',
  lastValidatedAt: NOW,
  closedAt: null,
})

function document(): EditorSiteDocument {
  const root = { id: 'root', moduleId: 'base.body', props: {}, breakpointOverrides: {}, children: [], parentId: null, classIds: [] }
  const structural = { expandedFolders: [], emptyFolders: [], rowOrder: [] }
  const decorative = { folders: [], items: [] }
  return {
    site: {
      id: scope.siteId,
      name: 'MCP publish fixture',
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      settings: { shortcuts: {} },
      styleRules: {},
      files: [],
      explorer: {
        pages: structuredClone(structural),
        styles: structuredClone(structural),
        scripts: structuredClone(structural),
        templates: structuredClone(decorative),
        components: structuredClone(decorative),
      },
      packageJson: { dependencies: {}, devDependencies: {} },
      runtime: { dependencyLock: { version: 1, packages: {}, updatedAt: 1 }, scripts: {}, styles: {} },
      createdAt: 1,
      updatedAt: 2,
    },
    pages: [{ id: 'page-1', slug: 'index', title: 'MCP release', rootNodeId: root.id, nodes: { [root.id]: root } }],
    visualComponents: [],
    layouts: [],
  }
}

describe('FUMA-066 hosted production authorities', () => {
  it('issues only from a fresh direct staff session and verifies the exact MCP operation', async () => {
    const authority = new HostedMcpPublishConfirmationAuthority({
      secret: 's'.repeat(32),
      now: () => new Date(NOW),
      resolveSession: async () => ({
        userId: connector.actorId,
        sessionId: 'staff-session-a',
        impersonatedBy: null,
        email: 'actor@example.test',
        createdAt: new Date('2026-07-29T02:59:00.000Z'),
      }),
    })
    const operationId = `${connector.connectorId}:publish-a`
    const confirmation = await authority.issue({ connector, operationId, request: new Request('https://app.trimly.co.ke/confirm') })
    expect(confirmation.stepUpReceiptId).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(confirmation)).not.toContain('s'.repeat(32))
    await expect(authority.verify({ connector, session: mcpSession, operationId, confirmation })).resolves.toBeUndefined()
    await expect(authority.verify({ connector, session: mcpSession, operationId: `${connector.connectorId}:changed`, confirmation })).rejects.toThrow('invalid or expired')

    const stale = new HostedMcpPublishConfirmationAuthority({
      secret: 's'.repeat(32),
      now: () => new Date(NOW),
      resolveSession: async () => ({
        userId: connector.actorId,
        sessionId: 'staff-session-stale',
        impersonatedBy: null,
        email: 'actor@example.test',
        createdAt: new Date('2026-07-29T02:54:59.000Z'),
      }),
    })
    await expect(stale.issue({ connector, operationId, request: new Request('https://app.trimly.co.ke/confirm') })).rejects.toThrow('fresh direct')
  })

  it('requires one canonical independent 256-bit BYOK metadata key', () => {
    const encoded = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url')
    const key = readHostedAiByokMetadataKey({ FUMA_AI_BYOK_METADATA_KEY: encoded })
    expect(key.bytes).toHaveLength(32)
    expect(key.keyId).toMatch(/^fuma-ai-byok-[a-f0-9]{16}$/)
    expect(() => readHostedAiByokMetadataKey({ FUMA_AI_BYOK_METADATA_KEY: 'not-a-key' })).toThrow('256-bit')
  })

  it('enqueues the existing exact immutable publish worker and replays one stable job identity', async () => {
    const source = document()
    const calls: unknown[][] = []
    const db = {
      dialect: 'postgres',
      unsafe: async (_sql: string, params: unknown[]) => {
        calls.push(params)
        return { rows: [{ mutation_id: 'mutation-a', accepted_sequence: 4, document_json: source }], rowCount: 1 }
      },
    } as unknown as DbClient
    const enqueued: Record<string, unknown>[] = []
    const jobs = {
      enqueue: async (input: Record<string, unknown>) => {
        enqueued.push(structuredClone(input))
        return { job: { id: input.id, status: 'queued' }, created: enqueued.length === 1 }
      },
    } as unknown as Pick<FumaJobService, 'enqueue'>
    const publisher = new PostgresMcpHostedPublishPort({ db, jobs })
    const input = { scope, actorId: connector.actorId, connectorId: connector.connectorId, operationId: `${connector.connectorId}:publish-a` }
    const first = await publisher.publish(input) as { jobId: string; releaseId: string; replay: boolean }
    const second = await publisher.publish(input) as { jobId: string; releaseId: string; replay: boolean }
    expect(first.jobId).toBe(second.jobId)
    expect(first.releaseId).toBe(second.releaseId)
    expect(first.replay).toBe(false)
    expect(second.replay).toBe(true)
    expect(enqueued[0]).toMatchObject({
      organizationId: scope.organizationId,
      siteId: scope.siteId,
      kind: 'fuma.publish-release',
      payload: { sourceSnapshotId: 'mutation-a' },
    })
    expect(calls[0]).toEqual([scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.ownerGeneration, scope.profileId])
  })
})
