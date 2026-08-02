import { generateConnectorToken, hashConnectorToken } from '../../../server/ai/mcp/connectors/token'
import { MemoryMcpRepository, McpService, type McpConnector, type McpCreditAuthorityPort, type McpScope } from '../../../server/fuma/mcp'

export const MCP_NOW = '2026-07-28T12:00:00.000Z'
export const mcpRates = Object.freeze({ read: Object.freeze({ requestsPerMinute: 20, reserveInputTokens: 100, reserveOutputTokens: 100 }), mutate: Object.freeze({ requestsPerMinute: 5, reserveInputTokens: 500, reserveOutputTokens: 500 }), publish: Object.freeze({ requestsPerMinute: 2, reserveInputTokens: 100, reserveOutputTokens: 100 }) })
export const mcpScope = (suffix: 'a' | 'b'): McpScope => Object.freeze({ platformId: 'platform-test', organizationId: `organization-${suffix}`, workspaceId: `workspace-${suffix}`, siteId: `site-${suffix}`, ownerKey: `owner-${suffix}`, ownerGeneration: 1, profileId: 'website' })

export async function createMcpFixture() {
  const repository = new MemoryMcpRepository()
  const active = new Set(['site-a', 'site-b'])
  const creditEvents: Array<Record<string, unknown>> = []
  const credits: McpCreditAuthorityPort = { reserve: async (value) => { creditEvents.push({ kind: 'reserve', ...structuredClone(value) }) }, settle: async (value) => { creditEvents.push({ kind: 'settle', ...structuredClone(value) }) }, release: async (value) => { creditEvents.push({ kind: 'release', ...structuredClone(value) }) } }
  const confirmations = new Set(['step-up-b'])
  let sequence = 0
  const service = new McpService({ repository, credits, now: () => new Date(MCP_NOW), generateId: () => `audit-${++sequence}`, liveAuthority: { load: async (connector) => ({ active: active.has(connector.scope.siteId), actorId: connector.actorId, scope: connector.scope, revision: connector.version }) }, confirmations: { verify: async ({ connector, confirmation }) => { if (connector.scope.siteId !== 'site-b' || !confirmations.has(confirmation.stepUpReceiptId)) throw new Error('Publish confirmation denied.') } } })
  async function connector(suffix: 'a' | 'b', capabilities: McpConnector['capabilities'] = ['site.read', 'site.mutate'], actorId = `actor-${suffix}`) { const token = generateConnectorToken(); const value = await service.createConnector({ connectorId: `connector-${suffix}`, actorId, label: `Connector ${suffix}`, type: 'remote', scope: mcpScope(suffix), tokenHash: await hashConnectorToken(token), capabilities, toolCapabilities: ['ai.chat', 'ai.tools.write', 'site.read', 'site.structure.edit', 'pages.publish'], rates: mcpRates, state: 'active', version: 1, createdAt: MCP_NOW, expiresAt: '2026-08-28T12:00:00.000Z', revokedAt: null, lastUsedAt: null }); return { token, value } }
  return { repository, service, active, creditEvents, confirmations, connector }
}
