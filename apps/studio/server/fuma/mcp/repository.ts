import type { McpAuditFact, McpConnector, McpScope, McpSession, McpToolReceipt, McpTransferChoice, McpUsageWindow } from './contracts'

export type McpReceiptClaim = Readonly<{
  outcome: 'claimed' | 'replay' | 'in-flight' | 'conflict'
  receipt: McpToolReceipt
}>

export type McpTransferState = Readonly<{
  choice: McpTransferChoice
  source: McpConnector
  current: McpConnector
  appliedFence: number | null
  compensatedFence: number | null
}>

export interface McpRepository {
  putConnector(connector: McpConnector): Promise<McpConnector>
  connector(connectorId: string): Promise<McpConnector | null>
  connectorByTokenHash(tokenHash: string): Promise<McpConnector | null>
  listConnectors(scope: McpScope): Promise<readonly McpConnector[]>
  updateConnector(connector: McpConnector, expectedVersion: number): Promise<boolean>
  putSession(session: McpSession): Promise<McpSession>
  session(sessionId: string): Promise<McpSession | null>
  closeSessions(connectorId: string, state: 'closed' | 'revoked', at: string): Promise<void>
  claimReceipt(receipt: McpToolReceipt): Promise<McpReceiptClaim>
  completeReceipt(receipt: McpToolReceipt): Promise<McpToolReceipt>
  admitUsage(window: McpUsageWindow, maximumRequests: number): Promise<McpUsageWindow>
  appendAudit(fact: McpAuditFact): Promise<void>
  auditForConnector(connectorId: string): Promise<readonly McpAuditFact[]>
  recordTransferChoice(choice: McpTransferChoice): Promise<McpTransferState>
  transferState(transferId: string): Promise<McpTransferState | null>
  applyTransfer(transferId: string, fence: number): Promise<McpTransferState>
  compensateTransfer(transferId: string, fence: number): Promise<McpTransferState>
}

export class McpRepositoryError extends Error {
  override readonly name = 'McpRepositoryError'
  readonly code: 'conflict' | 'rate' | 'not-found'

  constructor(code: 'conflict' | 'rate' | 'not-found', message: string) {
    super(message)
    this.code = code
  }
}
