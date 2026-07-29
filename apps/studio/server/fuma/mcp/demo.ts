import { generateConnectorToken, hashConnectorToken } from '../../ai/mcp/connectors/token'
import type { McpConnector, McpScope } from './contracts'
import { MemoryMcpRepository } from './memory'
import { hashMcpValue, McpService, type McpCreditAuthorityPort } from './service'

const scope = (siteId: string, ownerKey: string): McpScope => ({ platformId: 'platform-demo', organizationId: `organization-${siteId}`, workspaceId: `workspace-${siteId}`, siteId, ownerKey, ownerGeneration: 1, profileId: 'website' })
const rates = { read: { requestsPerMinute: 30, reserveInputTokens: 100, reserveOutputTokens: 100 }, mutate: { requestsPerMinute: 10, reserveInputTokens: 500, reserveOutputTokens: 500 }, publish: { requestsPerMinute: 2, reserveInputTokens: 100, reserveOutputTokens: 100 } } as const

export async function runMcpDemo(): Promise<Readonly<Record<string, unknown>>> {
  const repository = new MemoryMcpRepository()
  const creditEvents: string[] = []
  const credits: McpCreditAuthorityPort = { reserve: async ({ reservationId }) => { creditEvents.push(`reserve:${reservationId}`) }, settle: async ({ reservationId }) => { creditEvents.push(`settle:${reservationId}`) }, release: async ({ reservationId }) => { creditEvents.push(`release:${reservationId}`) } }
  const liveSites = new Set(['site-a', 'site-b'])
  let tick = 0
  const service = new McpService({ repository, credits, now: () => new Date('2026-07-28T12:00:00.000Z'), generateId: () => `audit-demo-${++tick}`, liveAuthority: { load: async (connector) => ({ active: liveSites.has(connector.scope.siteId), actorId: connector.actorId, scope: connector.scope, revision: connector.version }) }, confirmations: { verify: async ({ connector, confirmation }) => { if (connector.connectorId !== 'connector-b' || confirmation.stepUpReceiptId !== 'step-up-b') throw new Error('Exact publish step-up denied.') } } })
  const tokenA = generateConnectorToken(); const tokenB = generateConnectorToken()
  const make = async (connectorId: string, actorId: string, siteScope: McpScope, token: string, capabilities: McpConnector['capabilities']) => service.createConnector({ connectorId, actorId, label: connectorId, type: 'remote', scope: siteScope, tokenHash: await hashConnectorToken(token), capabilities, toolCapabilities: ['ai.chat', 'ai.tools.write', 'site.read', 'pages.publish'], rates, state: 'active', version: 1, createdAt: '2026-07-28T12:00:00.000Z', expiresAt: '2026-08-28T12:00:00.000Z', revokedAt: null, lastUsedAt: null })
  const siteA = scope('site-a', 'owner-a'); const siteB = scope('site-b', 'owner-b')
  await make('connector-a', 'actor-a', siteA, tokenA, ['site.read', 'site.mutate'])
  await make('connector-b', 'actor-b', siteB, tokenB, ['site.read', 'site.publish'])
  await service.authenticate({ tokenHash: await hashConnectorToken(tokenA), sessionId: 'session-a', expectedScope: siteA })
  await service.authenticate({ tokenHash: await hashConnectorToken(tokenB), sessionId: 'session-b', expectedScope: siteB })
  await service.revoke('connector-a', siteA, 'actor-a')
  const revokedDenied = await service.authenticate({ tokenHash: await hashConnectorToken(tokenA), sessionId: 'session-a-retry', expectedScope: siteA }).then(() => false, () => true)
  const publish = await service.beginOperation({ sessionId: 'session-b', operationId: 'publish-b-1', toolName: 'site_publish', capability: 'publish', inputHashSha256: await hashMcpValue({}), estimatedInputTokens: 1, estimatedOutputTokens: 10, confirmation: { confirmationId: 'confirm-b', stepUpReceiptId: 'step-up-b', confirmedAt: '2026-07-28T12:00:00.000Z' } })
  await service.completeOperation({ receipt: publish.receipt, output: { ok: true, data: { siteId: 'site-b', published: true } }, inputTokens: 1, outputTokens: 10 })
  const wrongSiteDenied = await service.authenticate({ tokenHash: await hashConnectorToken(tokenB), sessionId: 'foreign', expectedScope: siteA }).then(() => false, () => true)
  return Object.freeze({ connectedSites: Object.freeze(['site-a', 'site-b']), revokedConnector: 'connector-a', revokedDenied, wrongSiteDenied, publishedSite: 'site-b', publishedConnector: 'connector-b', creditLifecycle: Object.freeze(creditEvents), auditActions: Object.freeze((await repository.auditForConnector('connector-b')).map((fact) => fact.action)), secretsPresent: false })
}
