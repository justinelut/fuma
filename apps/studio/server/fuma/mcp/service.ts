import type { AiToolOutput } from '@core/ai'
import { BeginMcpOperationSchema, McpConnectorSchema, McpSessionSchema, McpToolReceiptSchema, McpTransferChoiceSchema, parseMcpContract, sameMcpScope, type BeginMcpOperation, type McpAuditActionSchema, type McpAuditFact, type McpConnector, type McpConnectorCapability, type McpOperationCapability, type McpPublishConfirmation, type McpScope, type McpSession, type McpToolReceipt, type McpTransferChoice, type McpUsageWindow } from './contracts'
import { McpRepositoryError, type McpRepository } from './repository'

export interface McpLiveAuthorityPort {
  load(connector: McpConnector): Promise<Readonly<{ active: boolean; actorId: string; scope: McpScope; revision: number }> | null>
}
export interface McpCreditAuthorityPort {
  reserve(input: Readonly<{ reservationId: string; operationId: string; scope: McpScope; estimatedInputTokens: number; estimatedOutputTokens: number }>): Promise<void>
  settle(input: Readonly<{ reservationId: string; operationId: string; inputTokens: number; outputTokens: number }>): Promise<void>
  release(input: Readonly<{ reservationId: string; operationId: string; reasonCode: string }>): Promise<void>
}
export interface McpPublishConfirmationPort {
  verify(input: Readonly<{ connector: McpConnector; session: McpSession; operationId: string; confirmation: McpPublishConfirmation }>): Promise<void>
}
export interface McpPublishConfirmationIssuerPort {
  issue(input: Readonly<{ connector: McpConnector; operationId: string; request: Request }>): Promise<McpPublishConfirmation>
}

export class McpAuthorityError extends Error {
  override readonly name = 'McpAuthorityError'
  readonly code: 'denied' | 'conflict' | 'not-found' | 'rate' | 'confirmation'

  constructor(code: 'denied' | 'conflict' | 'not-found' | 'rate' | 'confirmation', message: string) {
    super(message)
    this.code = code
  }
}

const SESSION_TTL_MS = 15 * 60_000
const capabilityName = (value: McpOperationCapability): McpConnectorCapability => value === 'read' ? 'site.read' : value === 'mutate' ? 'site.mutate' : 'site.publish'
const minute = (date: Date): string => new Date(Math.floor(date.getTime() / 60_000) * 60_000).toISOString()
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
export async function hashMcpValue(value: unknown): Promise<string> { const bytes = new TextEncoder().encode(canonical(value)); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('') }

type AuditAction = typeof McpAuditActionSchema.static

export class McpService {
  readonly #repository: McpRepository
  readonly #live: McpLiveAuthorityPort
  readonly #credits: McpCreditAuthorityPort
  readonly #confirmations: McpPublishConfirmationPort
  readonly #now: () => Date
  readonly #id: () => string
  constructor(input: Readonly<{ repository: McpRepository; liveAuthority: McpLiveAuthorityPort; credits: McpCreditAuthorityPort; confirmations: McpPublishConfirmationPort; now?: () => Date; generateId?: () => string }>) {
    this.#repository = input.repository; this.#live = input.liveAuthority; this.#credits = input.credits; this.#confirmations = input.confirmations; this.#now = input.now ?? (() => new Date()); this.#id = input.generateId ?? (() => crypto.randomUUID())
  }
  instant(): string { return this.#now().toISOString() }
  repository(): McpRepository { return this.#repository }

  async #audit(action: AuditAction, connector: McpConnector, input: Readonly<{ sessionId?: string | null; operationId?: string | null; outcome: McpAuditFact['outcome']; reasonCode?: string | null }>): Promise<void> {
    await this.#repository.appendAudit({ auditId: this.#id(), action, scope: connector.scope, actorId: connector.actorId, connectorId: connector.connectorId, sessionId: input.sessionId ?? null, operationId: input.operationId ?? null, outcome: input.outcome, reasonCode: input.reasonCode ?? null, occurredAt: this.instant() })
  }

  async createConnector(raw: unknown): Promise<McpConnector> {
    const value = parseMcpContract(McpConnectorSchema, raw, 'mcp.createConnector')
    if (value.state !== 'active' || value.version !== 1 || value.revokedAt !== null || Date.parse(value.expiresAt) <= this.#now().getTime()) throw new McpAuthorityError('denied', 'A new connector must be active and unexpired.')
    const live = await this.#live.load(value)
    if (!live?.active || live.actorId !== value.actorId || !sameMcpScope(live.scope, value.scope)) throw new McpAuthorityError('denied', 'Exact live site authority is required to create a connector.')
    const stored = await this.#repository.putConnector(value)
    await this.#audit('mcp.connector.created', stored, { outcome: 'success' })
    return stored
  }

  async revoke(connectorId: string, expectedScope: McpScope, actorId: string): Promise<McpConnector> {
    const current = await this.#repository.connector(connectorId)
    if (!current || current.actorId !== actorId || !sameMcpScope(current.scope, expectedScope)) throw new McpAuthorityError('not-found', 'Connector is unavailable.')
    if (current.state === 'revoked') return current
    const now = this.instant(); const next: McpConnector = { ...current, state: 'revoked', version: current.version + 1, revokedAt: now }
    if (!await this.#repository.updateConnector(next, current.version)) throw new McpAuthorityError('conflict', 'Connector changed concurrently.')
    await this.#repository.closeSessions(connectorId, 'revoked', now)
    await this.#audit('mcp.connector.revoked', next, { outcome: 'success' })
    return next
  }

  async authenticate(input: Readonly<{ tokenHash: string; sessionId: string; expectedScope: McpScope }>): Promise<Readonly<{ connector: McpConnector; session: McpSession }>> {
    const connector = await this.#repository.connectorByTokenHash(input.tokenHash)
    if (!connector || !sameMcpScope(connector.scope, input.expectedScope)) throw new McpAuthorityError('denied', 'Connector authority denied.')
    const now = this.#now(); const at = now.toISOString()
    try { await this.#assertLive(connector) } catch (error) { await this.#repository.closeSessions(connector.connectorId, 'revoked', at); await this.#audit('mcp.session.denied', connector, { sessionId: input.sessionId, outcome: 'denied', reasonCode: 'connector-inactive' }); throw error }
    const prior = await this.#repository.session(input.sessionId)
    if (prior && (prior.connectorId !== connector.connectorId || prior.actorId !== connector.actorId || !sameMcpScope(prior.scope, connector.scope))) throw new McpAuthorityError('denied', 'Session identity changed.')
    if (prior && prior.state !== 'active') throw new McpAuthorityError('denied', 'Session is closed.')
    const session = parseMcpContract(McpSessionSchema, { sessionId: input.sessionId, connectorId: connector.connectorId, actorId: connector.actorId, scope: connector.scope, connectorVersion: connector.version, state: 'active', openedAt: prior?.openedAt ?? at, expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(), lastValidatedAt: at, closedAt: null }, 'mcp.session')
    await this.#repository.putSession(session)
    if (!prior) await this.#audit('mcp.session.opened', connector, { sessionId: session.sessionId, outcome: 'success' })
    return { connector, session }
  }

  async #assertLive(connector: McpConnector): Promise<void> {
    const current = await this.#repository.connector(connector.connectorId)
    const live = current && await this.#live.load(current)
    if (!current || current.state !== 'active' || current.revokedAt !== null || Date.parse(current.expiresAt) <= this.#now().getTime() || current.version !== connector.version || !live?.active || live.actorId !== current.actorId || !sameMcpScope(live.scope, current.scope)) throw new McpAuthorityError('denied', 'Live connector authority denied.')
  }

  async revalidate(sessionId: string, capability?: McpOperationCapability): Promise<Readonly<{ connector: McpConnector; session: McpSession }>> {
    const session = await this.#repository.session(sessionId)
    if (!session || session.state !== 'active' || Date.parse(session.expiresAt) <= this.#now().getTime()) throw new McpAuthorityError('denied', 'MCP session is unavailable.')
    const connector = await this.#repository.connector(session.connectorId)
    if (!connector || connector.version !== session.connectorVersion || !sameMcpScope(connector.scope, session.scope) || (capability && !connector.capabilities.includes(capabilityName(capability)))) { await this.#repository.closeSessions(session.connectorId, 'revoked', this.instant()); throw new McpAuthorityError('denied', 'MCP session authority changed.') }
    await this.#assertLive(connector)
    return { connector, session }
  }

  async beginOperation(raw: unknown): Promise<Readonly<{ receipt: McpToolReceipt; replay: AiToolOutput | null }>> {
    const command = parseMcpContract(BeginMcpOperationSchema, raw, 'mcp.beginOperation') as BeginMcpOperation
    const { connector, session } = await this.revalidate(command.sessionId, command.capability)
    const rate = connector.rates[command.capability]
    if (command.estimatedInputTokens > rate.reserveInputTokens || command.estimatedOutputTokens > rate.reserveOutputTokens) throw new McpAuthorityError('rate', 'MCP operation exceeds its credit reservation bound.')
    const reservationId = `mcp:${connector.connectorId}:${command.operationId}`
    const receipt = parseMcpContract(McpToolReceiptSchema, { sessionId: session.sessionId, connectorId: connector.connectorId, operationId: command.operationId, toolName: command.toolName, capability: command.capability, inputHashSha256: command.inputHashSha256, reservationId, state: 'started', output: null, createdAt: this.instant(), completedAt: null }, 'mcp.receipt') as McpToolReceipt
    const claim = await this.#repository.claimReceipt(receipt)
    if (claim.outcome === 'conflict') throw new McpAuthorityError('conflict', 'Operation replay evidence changed.')
    if (claim.outcome === 'in-flight') throw new McpAuthorityError('conflict', 'Operation is already in flight.')
    if (claim.outcome === 'replay') return { receipt: claim.receipt, replay: claim.receipt.output }
    try {
      if (command.capability === 'publish') {
        if (!command.confirmation) throw new McpAuthorityError('confirmation', 'Explicit publish confirmation and step-up are required.')
        await this.#confirmations.verify({ connector, session, operationId: command.operationId, confirmation: command.confirmation })
        await this.#audit('mcp.publish.confirmed', connector, { sessionId: session.sessionId, operationId: command.operationId, outcome: 'success' })
      } else if (command.confirmation !== null) throw new McpAuthorityError('confirmation', 'Publish confirmation cannot authorize another capability.')
      const usage: McpUsageWindow = { connectorId: connector.connectorId, siteId: connector.scope.siteId, capability: command.capability, windowStartedAt: minute(this.#now()), requestsUsed: 1, inputTokens: command.estimatedInputTokens, outputTokens: command.estimatedOutputTokens }
      await this.#repository.admitUsage(usage, rate.requestsPerMinute).catch((error) => { if (error instanceof McpRepositoryError && error.code === 'rate') throw new McpAuthorityError('rate', error.message); throw error })
    } catch (error) {
      await this.#terminal(receipt, { ok: false, error: 'MCP operation admission denied.' }, 'denied')
      await this.#audit('mcp.tool.denied', connector, { sessionId: session.sessionId, operationId: command.operationId, outcome: 'denied', reasonCode: error instanceof McpAuthorityError ? error.code : 'confirmation' })
      throw error
    }
    try { await this.#credits.reserve({ reservationId, operationId: command.operationId, scope: connector.scope, estimatedInputTokens: command.estimatedInputTokens, estimatedOutputTokens: command.estimatedOutputTokens }) } catch (error) { await this.#terminal(receipt, { ok: false, error: 'MCP credit reservation denied.' }, 'failed'); throw error }
    await this.#audit('mcp.tool.started', connector, { sessionId: session.sessionId, operationId: command.operationId, outcome: 'success' })
    return { receipt, replay: null }
  }

  async completeOperation(input: Readonly<{ receipt: McpToolReceipt; output: AiToolOutput; inputTokens: number; outputTokens: number }>): Promise<void> {
    const { connector, session } = await this.revalidate(input.receipt.sessionId, input.receipt.capability)
    if (session.connectorId !== input.receipt.connectorId) throw new McpAuthorityError('denied', 'Receipt session changed.')
    if (input.output.ok) await this.#credits.settle({ reservationId: input.receipt.reservationId, operationId: input.receipt.operationId, inputTokens: input.inputTokens, outputTokens: input.outputTokens })
    else await this.#credits.release({ reservationId: input.receipt.reservationId, operationId: input.receipt.operationId, reasonCode: 'tool-failed' })
    await this.#terminal(input.receipt, input.output, input.output.ok ? 'completed' : 'failed')
    await this.#audit(input.output.ok ? 'mcp.tool.completed' : 'mcp.tool.failed', connector, { sessionId: session.sessionId, operationId: input.receipt.operationId, outcome: input.output.ok ? 'success' : 'failure', reasonCode: input.output.ok ? null : 'tool-failed' })
  }

  async abortOperation(receipt: McpToolReceipt, reasonCode: string): Promise<void> {
    await this.#credits.release({ reservationId: receipt.reservationId, operationId: receipt.operationId, reasonCode }).catch(() => {})
    const output: AiToolOutput = { ok: false, error: 'MCP operation was closed before completion.' }
    await this.#terminal(receipt, output, reasonCode === 'authority-revoked' ? 'denied' : 'failed').catch(() => {})
    const connector = await this.#repository.connector(receipt.connectorId)
    if (connector) await this.#audit(reasonCode === 'authority-revoked' ? 'mcp.tool.denied' : 'mcp.tool.failed', connector, { sessionId: receipt.sessionId, operationId: receipt.operationId, outcome: reasonCode === 'authority-revoked' ? 'denied' : 'failure', reasonCode })
  }

  async #terminal(receipt: McpToolReceipt, output: AiToolOutput, state: 'completed' | 'failed' | 'denied'): Promise<void> { await this.#repository.completeReceipt({ ...receipt, state, output: structuredClone(output), completedAt: this.instant() }) }

  async recordTransferChoice(raw: unknown) { const choice = parseMcpContract(McpTransferChoiceSchema, raw, 'mcp.transfer.choice') as McpTransferChoice; const connector = await this.#repository.connector(choice.connectorId); if (!connector || choice.destinationScope.ownerGeneration <= connector.scope.ownerGeneration || choice.destinationScope.ownerKey === connector.scope.ownerKey) throw new McpAuthorityError('denied', 'Transfer requires a new owner and higher generation.'); return this.#repository.recordTransferChoice(choice) }
}
