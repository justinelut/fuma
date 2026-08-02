import type { AiToolOutput } from '@core/ai'
import type { McpNativeCapability, McpNativeConnectorCapability, McpNativeExecutionAuthority, McpNativeHttpAuthority, McpNativeResolvedSession } from '../../ai/mcp/authority'
import { hashConnectorToken } from '../../ai/mcp/connectors/token'
import type { McpPublishConfirmationInput } from '../../ai/mcp/tools/publishTool'
import { hashMcpValue, McpService } from './service'
import type { McpConnector, McpOperationCapability, McpScope, McpToolReceipt } from './contracts'

export interface McpHostedPublishPort {
  publish(input: Readonly<{ scope: McpScope; actorId: string; connectorId: string; operationId: string }>): Promise<unknown>
}

const bearer = /^Bearer\s+(.+)$/i
const validId = (value: string | null): value is string => Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/.test(value))
const operationCapability = (value: McpNativeCapability): McpOperationCapability => value
const tokenUnits = (value: unknown): number => Math.max(1, Math.ceil(new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength / 4))

class HostedMcpExecutionAuthority implements McpNativeExecutionAuthority {
  readonly #service: McpService
  readonly #sessionId: string
  readonly #connector: McpConnector
  readonly #receipts = new Map<string, McpToolReceipt>()
  constructor(service: McpService, sessionId: string, connector: McpConnector) { this.#service = service; this.#sessionId = sessionId; this.#connector = connector }

  async revalidate(input: Readonly<{ phase: 'list' | 'tool-dispatch' | 'bridge-dispatch' | 'tool-result'; toolName?: string; capability?: McpNativeCapability; connectorCapability?: McpNativeConnectorCapability }>): Promise<void> { await this.#service.revalidate(this.#sessionId, input.capability ? operationCapability(input.capability) : undefined, input.connectorCapability) }

  async authorizeTool(input: Readonly<{ operationId: string; toolName: string; capability: McpNativeCapability; connectorCapability: McpNativeConnectorCapability; input: unknown }>): Promise<Readonly<{ replay: AiToolOutput | null }>> {
    const capability = operationCapability(input.capability)
    const rate = this.#connector.rates[capability]
    const confirmation = (input.toolName === 'site_publish' || input.toolName === 'site_publish_components') ? ((input.input as { confirmation?: McpPublishConfirmationInput }).confirmation ?? null) : null
    await this.#service.revalidate(this.#sessionId, capability, input.connectorCapability)
    const result = await this.#service.beginOperation({
      sessionId: this.#sessionId,
      operationId: input.operationId,
      toolName: input.toolName,
      capability,
      connectorCapability: input.connectorCapability,
      inputHashSha256: await hashMcpValue(input.input),
      estimatedInputTokens: Math.min(rate.reserveInputTokens, tokenUnits(input.input)),
      estimatedOutputTokens: rate.reserveOutputTokens,
      confirmation,
    })
    if (!result.replay) this.#receipts.set(input.operationId, result.receipt)
    return { replay: result.replay }
  }

  async recordToolResult(input: Readonly<{ operationId: string; toolName: string; capability: McpNativeCapability; input: unknown; output: AiToolOutput }>): Promise<void> {
    const receipt = this.#receipts.get(input.operationId)
    if (!receipt) throw new Error('MCP operation receipt is unavailable.')
    const rate = this.#connector.rates[operationCapability(input.capability)]
    await this.#service.completeOperation({ receipt, output: input.output,
      inputTokens: Math.min(rate.reserveInputTokens, tokenUnits(input.input)),
      outputTokens: Math.min(rate.reserveOutputTokens, tokenUnits(input.output)) })
    this.#receipts.delete(input.operationId)
  }

  async abortTool(input: Readonly<{ operationId: string; toolName: string; capability: McpNativeCapability; input: unknown; reasonCode: string }>): Promise<void> {
    const receipt = this.#receipts.get(input.operationId)
    if (!receipt) return
    await this.#service.abortOperation(receipt, input.reasonCode)
    this.#receipts.delete(input.operationId)
  }
}

export function createMcpNativeHttpAuthority(input: Readonly<{
  service: McpService
  expectedScope(request: Request): Promise<McpScope>
  publisher: McpHostedPublishPort
}>): McpNativeHttpAuthority {
  return Object.freeze({
    async resolve(
      request: Request,
      identity: Parameters<McpNativeHttpAuthority['resolve']>[1],
    ): Promise<McpNativeResolvedSession | null> {
      const match = bearer.exec((request.headers.get('Authorization') ?? '').trim())
      if (!match) return null
      const tokenHash = await hashConnectorToken(match[1]!.trim())
      const requestedSession = request.headers.get('Mcp-Session-Id')
      const sessionId = validId(requestedSession) ? requestedSession : `http:${tokenHash.slice(0, 32)}`
      const expectedScope = await input.expectedScope(request)
      const authenticated = await input.service.authenticate({ tokenHash, sessionId, expectedScope }).catch(() => null)
      if (!authenticated) return null
      const connector = authenticated.connector
      const operationId = `${connector.connectorId}:${identity.operationId}`
      const authority = new HostedMcpExecutionAuthority(input.service, sessionId, connector)
      return {
        connectorId: connector.connectorId,
        userId: connector.actorId,
        capabilities: connector.toolCapabilities,
        operationId,
        bridgeSiteKey: connector.scope.siteId,
        connectorCapabilities: connector.capabilities,
        authority,
        publishRuntime: {
          connectorId: connector.connectorId,
          publish: async () => {
            await input.service.revalidate(sessionId, 'publish')
            return input.publisher.publish({ scope: connector.scope, actorId: connector.actorId, connectorId: connector.connectorId, operationId })
          },
        },
      }
    },
  })
}
