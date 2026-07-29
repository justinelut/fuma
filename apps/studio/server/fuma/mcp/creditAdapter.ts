import type { AiCreditService } from '../aiCredits'
import type { AiTurnMode } from '../aiCredits/contracts'
import type { McpScope } from './contracts'
import type { McpCreditAuthorityPort } from './service'

type ReserveCommand = Parameters<McpCreditAuthorityPort['reserve']>[0]
type SettleCommand = Parameters<McpCreditAuthorityPort['settle']>[0]
type ReleaseCommand = Parameters<McpCreditAuthorityPort['release']>[0]

export interface McpCreditAccountBinding {
  accountId: string
  providerId: string
  modelId: string
  mode: AiTurnMode
  byokCredentialId: string | null
}
export interface McpCreditAccountLocator { locate(scope: McpScope): Promise<McpCreditAccountBinding> }

const creditScope = (scope: McpScope) => ({ platformId: scope.platformId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId, ownerKey: scope.ownerKey, ownerGeneration: scope.ownerGeneration })
const audience = (scope: McpScope) => ({ kind: 'customer' as const, platformId: scope.platformId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, siteId: scope.siteId, profile: scope.profileId })

export function createMcpCreditAuthority(input: Readonly<{
  credits: Pick<AiCreditService, 'view' | 'reserve' | 'settle' | 'release'>
  accounts: McpCreditAccountLocator
  now?: () => Date
}>): McpCreditAuthorityPort {
  const now = input.now ?? (() => new Date())
  return Object.freeze({
    async reserve(command: ReserveCommand) {
      const binding = await input.accounts.locate(command.scope)
      const view = await input.credits.view(binding.accountId)
      await input.credits.reserve({ reservationId: command.reservationId, accountId: binding.accountId,
        scope: creditScope(command.scope), audience: audience(command.scope), providerId: binding.providerId,
        modelId: binding.modelId, estimatedInputTokens: command.estimatedInputTokens,
        estimatedOutputTokens: command.estimatedOutputTokens, mode: binding.mode,
        byokCredentialId: binding.byokCredentialId,
        expiresAt: new Date(now().getTime() + 30 * 60_000).toISOString(),
        expectedAccountVersion: view.version, idempotencyKey: `mcp-reserve:${command.operationId}` })
    },
    async settle(command: SettleCommand) {
      await input.credits.settle({ reservationId: command.reservationId, inputTokens: command.inputTokens,
        outputTokens: command.outputTokens, idempotencyKey: `mcp-settle:${command.operationId}`,
        expectedReservationVersion: 1 })
    },
    async release(command: ReleaseCommand) {
      await input.credits.release({ reservationId: command.reservationId,
        idempotencyKey: `mcp-release:${command.operationId}:${command.reasonCode}`,
        expectedReservationVersion: 1 })
    },
  })
}
