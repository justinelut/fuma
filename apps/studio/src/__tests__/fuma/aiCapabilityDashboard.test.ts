import { describe, expect, it } from 'bun:test'
import { createInsertDataBackedSectionCapability } from '../../../server/fuma/aiBackendCapabilities'
import {
  CapabilityDashboardService,
  createCapabilityDashboardScopedRoutes,
  type CapabilityDashboardReadModel,
  type PlatformDashboardEvidence,
  type SiteDashboardEvidence,
} from '../../../server/fuma/aiCapabilityDashboard'
import type { BackendCapabilityScope } from '../../../server/fuma/aiBackendCapabilities'
import type { FumaScopedRouteHandlerInput } from '../../../server/fuma/context'

const NOW = '2026-07-31T09:30:00.000Z'
const RECEIPT_ID = 'a'.repeat(64)
const SCOPE: BackendCapabilityScope = Object.freeze({
  platformId: 'platform-a',
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  ownerKey: 'owner-a',
  ownerGeneration: 3,
  profileId: 'website',
})

function requestInput(input: Readonly<{
  permissions?: readonly string[]
  impersonator?: string | null
  siteId?: string
  repositorySiteId?: string
  body?: unknown
  url?: string
}> = {}): FumaScopedRouteHandlerInput {
  const impersonator = input.impersonator ?? null
  const siteId = input.siteId ?? SCOPE.siteId
  return {
    request: new Request(input.url ?? `https://admin.trimly.co.ke/api/fuma/organizations/${SCOPE.organizationId}/workspaces/${SCOPE.workspaceId}/sites/${siteId}/ai/backend-capabilities`, input.body === undefined ? undefined : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input.body),
    }),
    params: {},
    context: {
      requestId: 'request-dashboard',
      source: { kind: 'staff-session', correlationId: 'correlation-dashboard', userId: 'actor-a', sessionId: 'session-a', impersonatedBy: impersonator },
      actor: { kind: 'staff', userId: 'actor-a', sessionId: 'session-a', impersonator: impersonator === null ? null : { userId: impersonator } },
      scope: {
        platform: { id: SCOPE.platformId, status: 'active' },
        organization: { id: SCOPE.organizationId, platformId: SCOPE.platformId, status: 'active' },
        workspace: { id: SCOPE.workspaceId, platformId: SCOPE.platformId, organizationId: SCOPE.organizationId, status: 'active' },
        site: { id: siteId, platformId: SCOPE.platformId, organizationId: SCOPE.organizationId, workspaceId: SCOPE.workspaceId, profileId: 'website', status: 'active' },
      },
      profile: { id: 'website', status: 'active' },
      capabilities: ['content.pages'],
      permissions: { subjectId: 'actor-a', allow: [...(input.permissions ?? ['site.read', 'site.structure.edit', 'ai.providers.manage'])], deny: [] },
    },
    repositoryScope: {
      platformId: SCOPE.platformId,
      organizationId: SCOPE.organizationId,
      workspaceId: SCOPE.workspaceId,
      siteId: input.repositorySiteId ?? siteId,
      ownerKey: SCOPE.ownerKey,
      generation: SCOPE.ownerGeneration,
      state: 'active',
      transferFence: null,
    },
  } as FumaScopedRouteHandlerInput
}

function receipt(channel: 'site-ai' | 'mcp' = 'site-ai') {
  return Object.freeze({
    receiptId: RECEIPT_ID,
    capabilityId: 'site.component-usage.insert',
    capabilityVersion: '1.0.0',
    channel,
    operationId: `operation-${channel}`,
    outerReceiptId: `outer-${channel}`,
    inputHashSha256: 'b'.repeat(64),
    outputHashSha256: 'c'.repeat(64),
    outcome: 'succeeded' as const,
    metered: true,
    audited: true,
    occurredAt: NOW,
  })
}

function siteEvidence(overrides: Partial<SiteDashboardEvidence> = {}): SiteDashboardEvidence {
  return Object.freeze({
    receipts: Object.freeze([{
      receipt: receipt(), channel: 'site-ai', operationId: 'operation-site-ai', state: 'completed',
      auditId: 'audit-a', metered: true, occurredAt: NOW,
    }]),
    hasMore: false,
    connectors: Object.freeze([
      { connectorId: 'connector-a', label: 'Build connector', actorId: 'actor-a', state: 'active' },
      { connectorId: 'connector-other', label: 'Other actor', actorId: 'actor-b', state: 'active' },
    ]),
    usage: Object.freeze({ logicalCredits: 2, providerCredits: 2, spendUsdMicros: '250000' }),
    totalSuccessful: 1,
    totalFailed: 0,
    totalMetered: 1,
    totalAudited: 1,
    driftedReceipts: 0,
    ...overrides,
  })
}

function platformEvidence(): PlatformDashboardEvidence {
  return Object.freeze({
    receipts: Object.freeze([{
      receipt: receipt('mcp'), channel: 'mcp', operationId: 'operation-mcp', state: 'completed',
      auditId: 'audit-platform', metered: true, occurredAt: NOW,
    }]),
    hasMore: false,
    tenantCount: 4,
    successful: 8,
    failed: 2,
    metered: 7,
    audited: 8,
    logicalCredits: 7,
    providerCredits: 7,
    spendUsdMicros: '900000',
    activeMcpGrants: 3,
    revokedMcpGrants: 2,
    currentVersionOperations: 7,
    driftedReceipts: 1,
  })
}

function harness(site = siteEvidence()) {
  const calls: Array<{ kind: string; scope?: BackendCapabilityScope; limit: number; offset: number }> = []
  const revoked: unknown[] = []
  const readModel: CapabilityDashboardReadModel = {
    async site(exact, limit, offset) { calls.push({ kind: 'site', scope: exact, limit, offset }); return site },
    async platform(_version, limit, offset) { calls.push({ kind: 'platform', limit, offset }); return platformEvidence() },
  }
  const metadata = createInsertDataBackedSectionCapability({ execute: async () => { throw new Error('dashboard must not execute a capability') } } as never).metadata
  const service = new CapabilityDashboardService({
    readModel,
    metadata,
    mcp: { async revoke(connectorId, scope, actorId) { revoked.push({ connectorId, scope, actorId }); return {} as never } },
    now: () => new Date(NOW),
  })
  return { calls, metadata, readModel, revoked, service }
}

describe('FUMA-087 protected capability dashboard', () => {
  it('projects exact FUMA-086 metadata, current-owner grants, bounded usage, minimized receipts, and explicit unsupported gaps', async () => {
    const h = harness()
    const result = await h.service.site(requestInput(), { limit: 20 })
    expect(h.calls).toEqual([{ kind: 'site', scope: SCOPE, limit: 20, offset: 0 }])
    expect(result.capabilities[0]).toMatchObject({
      id: 'site.component-usage.insert', version: '1.0.0', state: 'enabled',
      requiredPermission: 'site.structure.edit', permissionGranted: true,
      usage: { successfulOperations: 1, failedOperations: 0, logicalCredits: 2, providerCredits: 2, spendUsdMicros: '250000' },
      health: { state: 'healthy' },
      limits: { inputBytes: 65_536, outputBytes: 131_072, resultItems: 1, requestsPerMinute: 60, timeoutMs: 10_000 },
    })
    expect(result.capabilities[0]?.channels.find(({ channel }) => channel === 'mcp')?.grants).toEqual([
      { grantId: 'connector-a', label: 'Build connector', channel: 'mcp', state: 'active', canRevoke: true },
      { grantId: 'connector-other', label: 'Other actor', channel: 'mcp', state: 'active', canRevoke: false },
    ])
    expect(result.unsupportedGaps.map(({ channel }) => channel)).toEqual(['imported-runtime', 'export-adapter'])
    expect(result.recentReceipts[0]).toEqual({
      receiptId: RECEIPT_ID, capabilityId: 'site.component-usage.insert', capabilityVersion: '1.0.0',
      channel: 'site-ai', operationId: 'operation-site-ai', outcome: 'succeeded', metered: true,
      audited: true, auditId: 'audit-a', occurredAt: NOW,
    })
    const serialized = JSON.stringify(result)
    for (const forbidden of ['owner-a', 'session-a', 'outer-site-ai', 'inputHashSha256', 'outputHashSha256', 'token', 'password', 'prompt', 'sql']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('degrades on failed attempts and missing audit/metering or drift without exposing tenant identities', async () => {
    const h = harness(siteEvidence({ totalSuccessful: 3, totalFailed: 1, totalMetered: 2, totalAudited: 1, driftedReceipts: 1 }))
    expect((await h.service.site(requestInput(), { limit: 1 })).capabilities[0]?.health.state).toBe('degraded')
    const platform = await h.service.platform(requestInput(), { limit: 50 })
    expect(platform.inventory[0]).toMatchObject({
      version: '1.0.0', health: { state: 'degraded' }, adoption: { currentVersionOperations: 7, driftedReceipts: 1 },
      aggregate: { tenantCount: 4, successfulOperations: 8, failedOperations: 2, meteredOperations: 7, auditedOperations: 8 },
    })
    expect(platform.inventory[0]?.controls.map(({ state }) => state)).toEqual(['blocked', 'blocked', 'blocked'])
    expect(JSON.stringify(platform)).not.toMatch(/organization-a|workspace-a|site-a|owner-a|actor-a/)
  })

  it('rejects support impersonation, stale scope, malformed cursors, and unbounded limits before read contact', async () => {
    const h = harness()
    await expect(h.service.site(requestInput({ impersonator: 'support-a' }), { limit: 20 })).rejects.toMatchObject({ code: 'authority-denied' })
    await expect(h.service.site(requestInput({ repositorySiteId: 'site-b' }), { limit: 20 })).rejects.toMatchObject({ code: 'authority-denied' })
    await expect(h.service.site(requestInput(), { limit: 51 })).rejects.toMatchObject({ code: 'invalid-contract' })
    await expect(h.service.site(requestInput(), { limit: 20, cursor: 'bm90LWpzb24' })).rejects.toMatchObject({ code: 'invalid-contract' })
    expect(h.calls).toEqual([])
  })

  it('delegates only exact actor-owned MCP revocation and cannot mint grants', async () => {
    const h = harness()
    const command = { capabilityId: h.metadata.id, capabilityVersion: h.metadata.version, channel: 'mcp' as const, grantId: 'connector-a' }
    expect(await h.service.revoke(requestInput(), command)).toEqual({ ...command, state: 'revoked' })
    expect(h.revoked).toEqual([{ connectorId: 'connector-a', scope: SCOPE, actorId: 'actor-a' }])
    await expect(h.service.revoke(requestInput({ permissions: ['site.read', 'site.structure.edit'] }), command)).rejects.toMatchObject({ code: 'authority-denied' })
    await expect(h.service.revoke(requestInput(), { ...command, organizationId: 'attacker' })).rejects.toMatchObject({ code: 'invalid-contract' })
    expect(h.revoked).toHaveLength(1)
    expect(h.service).not.toHaveProperty('grant')
  })

  it('returns private no-store strict envelopes and binds platform authorization only to the internal route', async () => {
    const h = harness()
    const authorization = { loadExactSiteAuthorization: async () => null }
    const routes = createCapabilityDashboardScopedRoutes(h.service, authorization)
    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /ai/backend-capabilities',
      'POST /ai/backend-capabilities/revocations',
      'GET /internal/ai-capabilities',
    ])
    expect(routes.find(({ path }) => path === '/internal/ai-capabilities')?.authorization).toBe(authorization)
    expect(routes.find(({ path }) => path === '/ai/backend-capabilities')?.authorization).toBeUndefined()
    const siteRoute = routes[0]!
    const response = await siteRoute.handler(requestInput({ url: 'https://admin.trimly.co.ke/dashboard?limit=1' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect((await response.json()).result.kind).toBe('site')
  })
})
