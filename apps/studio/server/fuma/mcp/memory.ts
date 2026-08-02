import { parseMcpContract, McpAuditFactSchema, McpConnectorSchema, McpSessionSchema, McpToolReceiptSchema, McpTransferChoiceSchema, McpUsageWindowSchema, sameMcpScope, type McpAuditFact, type McpConnector, type McpSession, type McpToolReceipt, type McpTransferChoice, type McpUsageWindow } from './contracts'
import { McpRepositoryError, type McpReceiptClaim, type McpRepository, type McpTransferState } from './repository'

const clone = <T>(value: T): T => structuredClone(value)
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
const receiptIdentity = (value: McpToolReceipt) => canonical({ sessionId: value.sessionId, connectorId: value.connectorId, operationId: value.operationId, toolName: value.toolName, capability: value.capability, inputHashSha256: value.inputHashSha256, reservationId: value.reservationId })

export class MemoryMcpRepository implements McpRepository {
  readonly connectors = new Map<string, McpConnector>()
  readonly sessions = new Map<string, McpSession>()
  readonly receipts = new Map<string, McpToolReceipt>()
  readonly usage = new Map<string, McpUsageWindow>()
  readonly audits: McpAuditFact[] = []
  readonly transfers = new Map<string, McpTransferState>()
  #tail: Promise<void> = Promise.resolve()
  #fail: string | null = null

  failNext(operation: string): void { this.#fail = operation }
  async #locked<T>(operation: string, run: () => T | Promise<T>): Promise<T> {
    const prior = this.#tail
    let release!: () => void
    this.#tail = new Promise<void>((resolve) => { release = resolve })
    await prior
    try {
      if (this.#fail === operation) { this.#fail = null; throw new Error(`Injected MCP ${operation} failure.`) }
      return await run()
    } finally { release() }
  }

  async putConnector(raw: McpConnector): Promise<McpConnector> { return this.#locked('putConnector', () => { const value = parseMcpContract(McpConnectorSchema, raw, 'mcp.repository.connector'); const prior = this.connectors.get(value.connectorId); if (prior && canonical(prior) !== canonical(value)) throw new McpRepositoryError('conflict', 'Connector identity changed.'); for (const item of this.connectors.values()) if (item.tokenHash === value.tokenHash && item.connectorId !== value.connectorId) throw new McpRepositoryError('conflict', 'Token hash is already bound.'); this.connectors.set(value.connectorId, clone(value)); return clone(value) }) }
  async connector(id: string) { return clone(this.connectors.get(id) ?? null) }
  async connectorByTokenHash(hash: string) { return clone([...this.connectors.values()].find((value) => value.tokenHash === hash) ?? null) }
  async listConnectors(scope: McpConnector['scope']) { return clone([...this.connectors.values()].filter((value) => sameMcpScope(value.scope, scope))) }
  async updateConnector(raw: McpConnector, expectedVersion: number): Promise<boolean> { return this.#locked('updateConnector', () => { const value = parseMcpContract(McpConnectorSchema, raw, 'mcp.repository.connectorUpdate'); const prior = this.connectors.get(value.connectorId); if (!prior || prior.version !== expectedVersion) return false; this.connectors.set(value.connectorId, clone(value)); return true }) }
  async putSession(raw: McpSession): Promise<McpSession> { return this.#locked('putSession', () => { const value = parseMcpContract(McpSessionSchema, raw, 'mcp.repository.session'); const prior = this.sessions.get(value.sessionId); if (prior && (prior.connectorId !== value.connectorId || !sameMcpScope(prior.scope, value.scope))) throw new McpRepositoryError('conflict', 'Session identity changed.'); this.sessions.set(value.sessionId, clone(value)); return clone(value) }) }
  async session(id: string) { return clone(this.sessions.get(id) ?? null) }
  async closeSessions(connectorId: string, state: 'closed' | 'revoked', at: string) { await this.#locked('closeSessions', () => { for (const [id, value] of this.sessions) if (value.connectorId === connectorId && value.state === 'active') this.sessions.set(id, { ...value, state, closedAt: at, lastValidatedAt: at }) }) }
  async claimReceipt(raw: McpToolReceipt): Promise<McpReceiptClaim> { return this.#locked('claimReceipt', () => { const value = parseMcpContract(McpToolReceiptSchema, raw, 'mcp.repository.receipt'); const prior = this.receipts.get(value.operationId); if (!prior) { this.receipts.set(value.operationId, clone(value)); return { outcome: 'claimed', receipt: clone(value) } } if (receiptIdentity(prior) !== receiptIdentity(value)) return { outcome: 'conflict', receipt: clone(prior) }; if (prior.state === 'started') return { outcome: 'in-flight', receipt: clone(prior) }; return { outcome: 'replay', receipt: clone(prior) } }) }
  async completeReceipt(raw: McpToolReceipt): Promise<McpToolReceipt> { return this.#locked('completeReceipt', () => { const value = parseMcpContract(McpToolReceiptSchema, raw, 'mcp.repository.receiptComplete'); const prior = this.receipts.get(value.operationId); if (!prior || receiptIdentity(prior) !== receiptIdentity(value)) throw new McpRepositoryError('conflict', 'Receipt completion changed identity.'); if (prior.state !== 'started') { if (canonical(prior) !== canonical(value)) throw new McpRepositoryError('conflict', 'Terminal receipt evidence changed.'); return clone(prior) } this.receipts.set(value.operationId, clone(value)); return clone(value) }) }
  async admitUsage(raw: McpUsageWindow, maximum: number): Promise<McpUsageWindow> { return this.#locked('admitUsage', () => { const value = parseMcpContract(McpUsageWindowSchema, raw, 'mcp.repository.usage'); const key = `${value.connectorId}:${value.capability}:${value.windowStartedAt}`; const prior = this.usage.get(key); const next = prior ? { ...value, requestsUsed: prior.requestsUsed + 1, inputTokens: prior.inputTokens + value.inputTokens, outputTokens: prior.outputTokens + value.outputTokens } : value; if (next.requestsUsed > maximum) throw new McpRepositoryError('rate', 'MCP connector request rate exceeded.'); this.usage.set(key, clone(next)); return clone(next) }) }
  async appendAudit(raw: McpAuditFact) { await this.#locked('appendAudit', () => { const value = parseMcpContract(McpAuditFactSchema, raw, 'mcp.repository.audit'); if (this.audits.some((item) => item.auditId === value.auditId)) throw new McpRepositoryError('conflict', 'Audit identity changed.'); this.audits.push(clone(value)) }) }
  async auditForConnector(id: string) { return clone(this.audits.filter((value) => value.connectorId === id)) }
  async recordTransferChoice(raw: McpTransferChoice): Promise<McpTransferState> { return this.#locked('recordTransferChoice', () => { const choice = parseMcpContract(McpTransferChoiceSchema, raw, 'mcp.repository.transferChoice'); const prior = this.transfers.get(choice.transferId); if (prior) { if (canonical(prior.choice) !== canonical(choice)) throw new McpRepositoryError('conflict', 'Transfer choice changed.'); return clone(prior) } const source = this.connectors.get(choice.connectorId); if (!source) throw new McpRepositoryError('not-found', 'Connector is unavailable.'); const state = { choice, source: clone(source), current: clone(source), appliedFence: null, compensatedFence: null }; this.transfers.set(choice.transferId, state); return clone(state) }) }
  async transferState(id: string) { return clone(this.transfers.get(id) ?? null) }
  async applyTransfer(id: string, fence: number): Promise<McpTransferState> { return this.#locked('applyTransfer', async () => { const value = this.transfers.get(id); if (!value) throw new McpRepositoryError('not-found', 'Transfer choice is unavailable.'); if (value.appliedFence !== null) { if (value.appliedFence !== fence) throw new McpRepositoryError('conflict', 'Transfer fence changed.'); return clone(value) } const current: McpConnector = value.choice.choice === 'revoke' ? { ...value.current, state: 'revoked', revokedAt: value.choice.recordedAt, version: value.current.version + 1 } : { ...value.current, scope: value.choice.destinationScope, state: 'active', version: value.current.version + 1 }; this.connectors.set(current.connectorId, clone(current)); for (const [sessionId, session] of this.sessions) if (session.connectorId === current.connectorId && session.state === 'active') this.sessions.set(sessionId, { ...session, state: 'revoked', closedAt: value.choice.recordedAt, lastValidatedAt: value.choice.recordedAt }); const next = { ...value, current, appliedFence: fence }; this.transfers.set(id, next); return clone(next) }) }
  async compensateTransfer(id: string, fence: number): Promise<McpTransferState> { return this.#locked('compensateTransfer', () => { const value = this.transfers.get(id); if (!value || value.appliedFence !== fence) throw new McpRepositoryError('conflict', 'Transfer compensation fence changed.'); if (value.compensatedFence !== null) return clone(value); this.connectors.set(value.source.connectorId, clone(value.source)); const next = { ...value, current: clone(value.source), compensatedFence: fence }; this.transfers.set(id, next); return clone(next) }) }
}
