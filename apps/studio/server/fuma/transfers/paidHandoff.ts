import type { FumaRequestContext } from '../context'
import type { TransferAggregate } from './repository'
import type {
  ConfirmTransferInput,
  ProposeTransferInput,
  ResumeTransferInput,
  StartTransferInput,
  TransferService,
} from './service'
import {
  PAID_HANDOFF_ASSET_OWNERS,
  PaidHandoffReadinessSchema,
  PaidHandoffReviewSchema,
  PreparePaidHandoffSchema,
  parsePaidHandoff,
  type PaidHandoffAsset,
  type PaidHandoffBlockedReason,
  type PaidHandoffReadiness,
  type PaidHandoffReview,
  type PaidHandoffSelections,
} from './paidHandoffContracts'

export interface PaidHandoffReadinessAuthority {
  /** Must reconstruct every field from current server-owned authorities on every call. */
  resolve(commandId: string): Promise<unknown>
}

export type PaidHandoffChoiceInput<Asset extends PaidHandoffAsset = PaidHandoffAsset> = Readonly<{
  asset: Asset
  ownerTicket: (typeof PAID_HANDOFF_ASSET_OWNERS)[Asset]
  transferId: string
  source: PaidHandoffReadiness['source']
  destination: PaidHandoffReadiness['destination']
  selection: PaidHandoffSelections[Asset]
  recordedAt: string
}>

/** Each delegate writes only its canonical domain authority and must converge by transfer ID. */
export interface PaidHandoffAssetChoiceAuthority<Asset extends PaidHandoffAsset = PaidHandoffAsset> {
  readonly asset: Asset
  readonly ownerTicket: (typeof PAID_HANDOFF_ASSET_OWNERS)[Asset]
  record(input: PaidHandoffChoiceInput<Asset>): Promise<void>
}
export interface PaidHandoffChoiceAuthority {
  record(input: Readonly<{
    transferId: string
    source: PaidHandoffReadiness['source']
    destination: PaidHandoffReadiness['destination']
    selections: PaidHandoffSelections
    recordedAt: string
  }>): Promise<void>
}

export function createRegisteredPaidHandoffChoiceAuthority(
  authorities: readonly PaidHandoffAssetChoiceAuthority[],
): PaidHandoffChoiceAuthority {
  const expected = Object.keys(PAID_HANDOFF_ASSET_OWNERS) as PaidHandoffAsset[]
  const byAsset = new Map(authorities.map((authority) => [authority.asset, authority] as const))
  if (byAsset.size !== expected.length || authorities.length !== expected.length) {
    throw new TypeError('Paid handoff requires exactly one authority for every registered asset owner.')
  }
  for (const asset of expected) {
    const authority = byAsset.get(asset)
    if (!authority || authority.ownerTicket !== PAID_HANDOFF_ASSET_OWNERS[asset]) {
      throw new TypeError(`Paid handoff asset owner is missing or substituted: ${asset}.`)
    }
  }
  return Object.freeze({
    async record(input: Parameters<PaidHandoffChoiceAuthority['record']>[0]) {
      for (const asset of expected) {
        const authority = byAsset.get(asset)!
        await authority.record(Object.freeze({
          asset,
          ownerTicket: PAID_HANDOFF_ASSET_OWNERS[asset],
          transferId: input.transferId,
          source: structuredClone(input.source),
          destination: structuredClone(input.destination),
          selection: input.selections[asset],
          recordedAt: input.recordedAt,
        }) as PaidHandoffChoiceInput)
      }
    },
  })
}

/** Mutates only the existing FUMA-056 outbox; transfer state remains in TransferService. */
export interface PaidHandoffOutboxAuthority {
  transition(input: Readonly<{
    commandId: string
    from: 'pending' | 'failed' | 'delivered'
    to: 'pending' | 'failed' | 'delivered'
    transferId: string
    occurredAt: string
  }>): Promise<void>
}

export interface PaidHandoffNotificationAuthority {
  /** The deterministic delivery key is mandatory; implementations must deduplicate it durably. */
  send(input: Readonly<{
    deliveryKey: string
    commandId: string
    transferId: string
    event: 'confirmation-requested' | 'started' | 'recovery-requested' | 'failed' | 'completed' | 'refund-escalated'
    locale: 'en-KE'
    timezone: 'Africa/Nairobi'
  }>): Promise<void>
}

export interface PaidHandoffCompletionAuthority {
  /** Delegates to existing FUMA-057 quota/assignment and managed-ownership authorities; retries must converge. */
  complete(input: Readonly<{
    commandId: string
    transferId: string
    contractId: string
    source: PaidHandoffReadiness['source']
    destination: PaidHandoffReadiness['destination']
    completedAt: string
    internalGrantExcluded: true
  }>): Promise<void>
}

export interface PaidHandoffRefundEscalationAuthority {
  /** Records an idempotent human-review escalation only; it never mutates verified payment or issues a refund. */
  escalate(input: Readonly<{
    escalationKey: string
    commandId: string
    transferId: string
    contractId: string
    reasonCode: string
    requestedAt: string
  }>): Promise<void>
}

export interface PaidHandoffAuditAuthority {
  /** The deterministic event key is mandatory; implementations must deduplicate it durably. */
  record(context: FumaRequestContext, input: Readonly<{
    eventKey: string
    action: 'transfer.proposed' | 'transfer.started' | 'transfer.resumed'
    commandId: string
    transferId: string
    outcome: 'success' | 'failure'
    failureCode: string | null
  }>): Promise<void>
}

export interface PaidHandoffTransferAuthority {
  propose(input: ProposeTransferInput): Promise<TransferAggregate>
  confirm(input: ConfirmTransferInput): Promise<TransferAggregate>
  start(input: StartTransferInput): Promise<TransferAggregate>
  resume(input: ResumeTransferInput): Promise<TransferAggregate>
}

export class PaidHandoffError extends Error {
  readonly code: 'not-ready' | 'identity-mismatch' | 'invalid-state'
  constructor(code: PaidHandoffError['code'], message: string) {
    super(message)
    this.name = 'PaidHandoffError'
    this.code = code
  }
}

const money = new Intl.NumberFormat('en-KE', {
  style: 'currency', currency: 'KES', currencyDisplay: 'code',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const dateTime = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi',
})

function sameCoordinate(left: PaidHandoffReadiness['source'], right: PaidHandoffReadiness['source']): boolean {
  return left.platformId === right.platformId && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId && left.siteId === right.siteId
}
function blocked(readiness: PaidHandoffReadiness): PaidHandoffBlockedReason[] {
  const reasons: PaidHandoffBlockedReason[] = []
  if (readiness.paymentState !== 'paid-transfer-pending') reasons.push('payment-state')
  if (!readiness.destinationActive) reasons.push('destination-inactive')
  if (!readiness.quotaAccepted) reasons.push('quota-unaccepted')
  if (!readiness.policyAcceptanceCurrent) reasons.push('policy-acceptance-stale')
  if (!readiness.meteringEvidenceCurrent) reasons.push('metering-evidence-stale')
  if (readiness.outboxState === 'delivered') reasons.push('already-delivered')
  return reasons
}
function key(commandId: string, event: string): string { return `paid-handoff:${commandId}:${event}` }
function failureCode(error: unknown): string {
  if (error instanceof PaidHandoffError) return error.code
  if (error instanceof Error && 'code' in error && typeof error.code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(error.code)) return error.code
  return 'operation-failed'
}

export function projectPaidHandoffReview(value: unknown): PaidHandoffReview {
  const readiness = parsePaidHandoff(PaidHandoffReadinessSchema, value, 'paid handoff readiness')
  const blockedReasons = blocked(readiness)
  const activated = new Date(readiness.activatedAt)
  if (!Number.isFinite(activated.getTime())) throw new PaidHandoffError('invalid-state', 'Paid handoff activation time is invalid.')
  return parsePaidHandoff(PaidHandoffReviewSchema, {
    ...readiness,
    setupAmount: money.format(readiness.setupAmountMinor / 100),
    recurringAmount: money.format(readiness.recurringAmountMinor / 100),
    activatedAtLocal: dateTime.format(activated),
    canPrepare: readiness.outboxState === 'pending' && blockedReasons.length === 0,
    canRecover: readiness.outboxState === 'failed' && blockedReasons.length === 0,
    blockedReasons,
  }, 'paid handoff review')
}

export type PaidHandoffServiceOptions = Readonly<{
  readiness: PaidHandoffReadinessAuthority
  choices: PaidHandoffChoiceAuthority
  outbox: PaidHandoffOutboxAuthority
  transfer: PaidHandoffTransferAuthority | Pick<TransferService, 'propose' | 'confirm' | 'start' | 'resume'>
  notifications: PaidHandoffNotificationAuthority
  completion: PaidHandoffCompletionAuthority
  refundEscalations: PaidHandoffRefundEscalationAuthority
  audit: PaidHandoffAuditAuthority
  now?: () => Date
}>

export class PaidHandoffService {
  readonly #options: PaidHandoffServiceOptions
  readonly #now: () => Date
  constructor(options: PaidHandoffServiceOptions) {
    this.#options = options
    this.#now = options.now ?? (() => new Date())
  }

  async review(commandId: string): Promise<PaidHandoffReview> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(commandId)) throw new PaidHandoffError('identity-mismatch', 'Paid handoff command ID is invalid.')
    return projectPaidHandoffReview(await this.#options.readiness.resolve(commandId))
  }

  async prepare(inputValue: unknown, proposal: ProposeTransferInput): Promise<TransferAggregate> {
    const input = parsePaidHandoff(PreparePaidHandoffSchema, inputValue, 'prepare paid handoff')
    const context = proposal.authority.context
    try {
      let readiness = await this.#required(input.commandId, input.transferId, 'prepare')
      this.#assertManifest(readiness, proposal)
      const occurredAt = this.#instant()
      await this.#options.choices.record({ transferId: input.transferId, source: readiness.source, destination: readiness.destination, selections: input.selections, recordedAt: occurredAt })
      readiness = await this.#required(input.commandId, input.transferId, 'prepare')
      this.#assertManifest(readiness, proposal)
      const aggregate = await this.#options.transfer.propose(proposal)
      await this.#options.notifications.send({ deliveryKey: key(input.commandId, 'confirmation-requested'), commandId: input.commandId, transferId: input.transferId, event: 'confirmation-requested', locale: 'en-KE', timezone: 'Africa/Nairobi' })
      await this.#audit(context, 'transfer.proposed', input.commandId, input.transferId, 'success', null)
      return aggregate
    } catch (error) {
      await this.#audit(context, 'transfer.proposed', input.commandId, input.transferId, 'failure', failureCode(error))
      throw error
    }
  }

  confirm(input: ConfirmTransferInput): Promise<TransferAggregate> {
    return this.#options.transfer.confirm(input)
  }

  async start(commandId: string, input: StartTransferInput): Promise<TransferAggregate> {
    const context = input.authority.context
    try {
      const readiness = await this.#required(commandId, input.transferId, 'start')
      if (!sameCoordinate(input.source, readiness.source)) throw new PaidHandoffError('identity-mismatch', 'Start scope differs from the paid handoff source.')
      const aggregate = await this.#options.transfer.start(input)
      // Delivery and audit precede the terminal outbox transition. Their deterministic keys make a crash replay safe.
      await this.#options.notifications.send({ deliveryKey: key(commandId, 'started'), commandId, transferId: input.transferId, event: 'started', locale: 'en-KE', timezone: 'Africa/Nairobi' })
      await this.#audit(context, 'transfer.started', commandId, input.transferId, 'success', null)
      await this.#options.outbox.transition({ commandId, from: 'pending', to: 'delivered', transferId: input.transferId, occurredAt: this.#instant() })
      return aggregate
    } catch (error) {
      await this.#audit(context, 'transfer.started', commandId, input.transferId, 'failure', failureCode(error))
      throw error
    }
  }

  async resume(commandId: string, input: ResumeTransferInput): Promise<TransferAggregate> {
    const context = input.authority.context
    try {
      const readiness = await this.#required(commandId, input.transferId, 'recover')
      if (!sameCoordinate(input.source, readiness.source)) throw new PaidHandoffError('identity-mismatch', 'Recovery scope differs from the paid handoff source.')
      const aggregate = await this.#options.transfer.resume(input)
      await this.#options.notifications.send({ deliveryKey: key(commandId, 'recovery-requested'), commandId, transferId: input.transferId, event: 'recovery-requested', locale: 'en-KE', timezone: 'Africa/Nairobi' })
      await this.#audit(context, 'transfer.resumed', commandId, input.transferId, 'success', null)
      await this.#options.outbox.transition({ commandId, from: 'failed', to: 'pending', transferId: input.transferId, occurredAt: this.#instant() })
      return aggregate
    } catch (error) {
      await this.#audit(context, 'transfer.resumed', commandId, input.transferId, 'failure', failureCode(error))
      throw error
    }
  }

  async reconcile(commandId: string, aggregate: TransferAggregate): Promise<PaidHandoffReadiness> {
    const readiness = parsePaidHandoff(PaidHandoffReadinessSchema, await this.#options.readiness.resolve(commandId), 'paid handoff readiness')
    if (readiness.commandId !== commandId || readiness.transferId !== aggregate.proposal.id) {
      throw new PaidHandoffError('identity-mismatch', 'Reconciliation transfer identity changed.')
    }
    if (!sameCoordinate(readiness.source, aggregate.proposal.source)
      || !sameCoordinate(readiness.destination, aggregate.proposal.destination)) {
      throw new PaidHandoffError('identity-mismatch', 'Reconciliation ownership identity changed.')
    }
    const occurredAt = this.#instant()
    if (aggregate.proposal.state === 'running' && readiness.outboxState === 'pending') {
      await this.#options.notifications.send({ deliveryKey: key(commandId, 'started'), commandId, transferId: readiness.transferId, event: 'started', locale: 'en-KE', timezone: 'Africa/Nairobi' })
      await this.#options.outbox.transition({ commandId, from: 'pending', to: 'delivered', transferId: readiness.transferId, occurredAt })
    } else if (aggregate.proposal.state === 'resume-requested' && readiness.outboxState === 'failed') {
      await this.#options.notifications.send({ deliveryKey: key(commandId, 'recovery-requested'), commandId, transferId: readiness.transferId, event: 'recovery-requested', locale: 'en-KE', timezone: 'Africa/Nairobi' })
      await this.#options.outbox.transition({ commandId, from: 'failed', to: 'pending', transferId: readiness.transferId, occurredAt })
    } else if (aggregate.proposal.state === 'failed' && readiness.outboxState !== 'failed') {
      await this.#options.outbox.transition({ commandId, from: readiness.outboxState, to: 'failed', transferId: readiness.transferId, occurredAt })
      await this.#options.notifications.send({ deliveryKey: key(commandId, 'failed'), commandId, transferId: readiness.transferId, event: 'failed', locale: 'en-KE', timezone: 'Africa/Nairobi' })
    } else if (aggregate.proposal.state === 'completed') {
      // Completion and notification ports are durably idempotent. Always replay them:
      // the command outbox may already be delivered from start while quota and managed
      // ownership completion still need to recover from a later crash.
      await this.#options.completion.complete({
        commandId, transferId: readiness.transferId, contractId: readiness.contractId,
        source: readiness.source, destination: readiness.destination, completedAt: occurredAt,
        internalGrantExcluded: true,
      })
      if (readiness.outboxState !== 'delivered') {
        await this.#options.outbox.transition({ commandId, from: readiness.outboxState, to: 'delivered', transferId: readiness.transferId, occurredAt })
      }
      await this.#options.notifications.send({ deliveryKey: key(commandId, 'completed'), commandId, transferId: readiness.transferId, event: 'completed', locale: 'en-KE', timezone: 'Africa/Nairobi' })
    }
    return parsePaidHandoff(PaidHandoffReadinessSchema, await this.#options.readiness.resolve(commandId), 'reconciled paid handoff readiness')
  }

  async escalateRefund(commandId: string, aggregate: TransferAggregate, reasonCode: string): Promise<PaidHandoffReadiness> {
    const readiness = parsePaidHandoff(PaidHandoffReadinessSchema, await this.#options.readiness.resolve(commandId), 'paid handoff readiness')
    if (readiness.transferId !== aggregate.proposal.id || aggregate.proposal.state !== 'failed' || readiness.outboxState !== 'failed') {
      throw new PaidHandoffError('invalid-state', 'Refund escalation requires one compensated failed transfer with verified payment preserved.')
    }
    const requestedAt = this.#instant()
    await this.#options.refundEscalations.escalate({
      escalationKey: key(commandId, `refund:${reasonCode}`), commandId, transferId: readiness.transferId,
      contractId: readiness.contractId, reasonCode, requestedAt,
    })
    await this.#options.notifications.send({ deliveryKey: key(commandId, 'refund-escalated'), commandId, transferId: readiness.transferId, event: 'refund-escalated', locale: 'en-KE', timezone: 'Africa/Nairobi' })
    return readiness
  }

  async #required(commandId: string, transferId: string, phase: 'prepare' | 'start' | 'recover'): Promise<PaidHandoffReadiness> {
    const readiness = parsePaidHandoff(PaidHandoffReadinessSchema, await this.#options.readiness.resolve(commandId), 'paid handoff readiness')
    if (readiness.commandId !== commandId || readiness.transferId !== transferId) throw new PaidHandoffError('identity-mismatch', 'Paid handoff command or transfer identity changed.')
    const reasons = blocked(readiness)
    const expectedState = phase === 'recover' ? 'failed' : 'pending'
    if (readiness.outboxState !== expectedState || reasons.length > 0) {
      throw new PaidHandoffError('not-ready', `Paid handoff is not ready for ${phase}: ${reasons.join(', ') || readiness.outboxState}.`)
    }
    return readiness
  }

  #assertManifest(readiness: PaidHandoffReadiness, proposal: ProposeTransferInput): void {
    if (proposal.manifest.transferId !== readiness.transferId
      || !sameCoordinate(proposal.manifest.source, readiness.source)
      || !sameCoordinate(proposal.manifest.destination, readiness.destination)) {
      throw new PaidHandoffError('identity-mismatch', 'Paid handoff and immutable transfer manifest identities differ.')
    }
  }

  async #audit(context: FumaRequestContext, action: 'transfer.proposed' | 'transfer.started' | 'transfer.resumed', commandId: string, transferId: string, outcome: 'success' | 'failure', code: string | null): Promise<void> {
    await this.#options.audit.record(context, { eventKey: key(commandId, `${action}:${outcome}`), action, commandId, transferId, outcome, failureCode: code })
  }

  #instant(): string {
    const now = this.#now()
    if (!Number.isFinite(now.getTime())) throw new PaidHandoffError('invalid-state', 'Paid handoff clock is invalid.')
    return now.toISOString()
  }
}
