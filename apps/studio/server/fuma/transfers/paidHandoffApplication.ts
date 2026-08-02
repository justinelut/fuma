import { Value, type Static } from '@core/utils/typeboxHelpers'
import type { FumaScopedRouteHandlerInput } from '../context'
import type { TransferAggregate } from './repository'
import {
  TransferServiceError,
  type ConfirmTransferInput,
  type ProposeTransferInput,
  type ResumeTransferInput,
  type StartTransferInput,
} from './service'
import { PaidHandoffService, type PaidHandoffReadinessAuthority } from './paidHandoff'
import {
  PaidHandoffAdminReceiptSchema,
  PaidHandoffConfirmCommandSchema,
  PaidHandoffDashboardSchema,
  PaidHandoffOperationReceiptSchema,
  PaidHandoffReadinessSchema,
  PaidHandoffReviewSchema,
  PaidHandoffReconcileCommandSchema,
  PaidHandoffRecoveryCommandSchema,
  PaidHandoffRefundEscalationCommandSchema,
  PaidHandoffStartCommandSchema,
  PreparePaidHandoffSchema,
  parsePaidHandoff,
  type PaidHandoffAdminReceipt,
  type PaidHandoffDashboard,
  type PaidHandoffReadiness,
  type PaidHandoffSelections,
} from './paidHandoffContracts'

type ConfirmCommand = Static<typeof PaidHandoffConfirmCommandSchema>
type StartCommand = Static<typeof PaidHandoffStartCommandSchema>
type RecoveryCommand = Static<typeof PaidHandoffRecoveryCommandSchema>

/**
 * Resolves fresh Better Auth and permission authority server-side. Browser bodies
 * contain only intent and concurrency evidence; they can never supply actors,
 * scopes, destinations, permissions, lock IDs, job IDs, or run IDs.
 */
export interface PaidHandoffCommandAuthority {
  proposal(input: FumaScopedRouteHandlerInput, readiness: PaidHandoffReadiness, selections: PaidHandoffSelections): Promise<ProposeTransferInput>
  confirmation(input: FumaScopedRouteHandlerInput, readiness: PaidHandoffReadiness, command: ConfirmCommand): Promise<ConfirmTransferInput>
  start(input: FumaScopedRouteHandlerInput, readiness: PaidHandoffReadiness, command: StartCommand): Promise<StartTransferInput>
  recovery(input: FumaScopedRouteHandlerInput, readiness: PaidHandoffReadiness, command: RecoveryCommand): Promise<ResumeTransferInput>
  assertAdmin(input: FumaScopedRouteHandlerInput, action: 'reconcile' | 'refund-escalate'): Promise<void>
}

export interface PaidHandoffTransferApplicationAuthority {
  get(source: PaidHandoffReadiness['source'], transferId: string): Promise<TransferAggregate>
}

function receipt(commandId: string, aggregate: TransferAggregate) {
  return parsePaidHandoff(PaidHandoffOperationReceiptSchema, {
    commandId,
    transferId: aggregate.proposal.id,
    state: aggregate.proposal.state,
    version: aggregate.version,
  }, 'paid handoff operation receipt')
}

function nextAction(review: PaidHandoffReadiness extends never ? never : Awaited<ReturnType<PaidHandoffService['review']>>, aggregate: TransferAggregate | null): PaidHandoffDashboard['nextAction'] {
  if (!aggregate) return review.canPrepare ? 'choose-assets' : 'blocked'
  switch (aggregate.proposal.state) {
    case 'proposed': return 'confirm-source'
    case 'awaiting-confirmations': return aggregate.confirmations.source ? 'confirm-destination' : 'confirm-source'
    case 'ready': return 'start'
    case 'failed': return review.canRecover ? 'recover' : 'blocked'
    case 'completed': return 'complete'
    case 'running': case 'resume-requested': case 'compensating': return 'wait'
    default: return 'blocked'
  }
}

function progress(aggregate: TransferAggregate | null): number {
  if (!aggregate) return 0
  if (aggregate.proposal.state === 'completed') return 100
  if (aggregate.proposal.state === 'failed' || aggregate.proposal.state === 'cancelled') return 100
  const base = aggregate.proposal.state === 'proposed' ? 10
    : aggregate.proposal.state === 'awaiting-confirmations' ? 20
      : aggregate.proposal.state === 'ready' ? 35
        : aggregate.proposal.state === 'running' || aggregate.proposal.state === 'resume-requested' ? 45
          : aggregate.proposal.state === 'compensating' ? 70 : 0
  if (aggregate.steps.length === 0) return base
  const terminal = aggregate.steps.filter((step) => ['succeeded', 'skipped', 'failed'].includes(step.state)).length
  return Math.min(99, Math.max(base, 45 + Math.floor((terminal / aggregate.steps.length) * 50)))
}

export function projectPaidHandoffDashboard(reviewValue: unknown, aggregate: TransferAggregate | null): PaidHandoffDashboard {
  const formatted = parsePaidHandoff(PaidHandoffReviewSchema, reviewValue, 'paid handoff dashboard review')
  const transfer = aggregate === null ? null : {
    state: aggregate.proposal.state,
    version: aggregate.version,
    confirmationStatus: aggregate.confirmations.status,
    fence: aggregate.lock?.fence ?? null,
    failureCode: aggregate.proposal.failure?.code ?? null,
    steps: aggregate.steps.filter((step) => step.kind === 'forward').map((step) => ({
      definitionId: step.definitionId,
      sequence: step.sequence,
      state: step.state,
    })),
  }
  return parsePaidHandoff(PaidHandoffDashboardSchema, {
    review: formatted,
    transfer,
    progressPercent: progress(aggregate),
    nextAction: nextAction(formatted, aggregate),
    managedOwnership: aggregate?.proposal.state === 'completed' ? 'removed' : 'retained',
    customerQuotaApplication: aggregate?.proposal.state === 'completed' ? 'applied-once' : 'pending',
    internalGrantExcluded: true,
  }, 'paid handoff dashboard')
}

export class PaidHandoffApplicationService {
  readonly #handoff: PaidHandoffService
  readonly #readiness: PaidHandoffReadinessAuthority
  readonly #transfer: PaidHandoffTransferApplicationAuthority
  readonly #authority: PaidHandoffCommandAuthority
  readonly #now: () => Date

  constructor(input: Readonly<{
    handoff: PaidHandoffService
    readiness: PaidHandoffReadinessAuthority
    transfer: PaidHandoffTransferApplicationAuthority
    authority: PaidHandoffCommandAuthority
    now?: () => Date
  }>) {
    this.#handoff = input.handoff
    this.#readiness = input.readiness
    this.#transfer = input.transfer
    this.#authority = input.authority
    this.#now = input.now ?? (() => new Date())
  }

  async review(_input: FumaScopedRouteHandlerInput, commandId: string): Promise<PaidHandoffDashboard> {
    const review = await this.#handoff.review(commandId)
    return projectPaidHandoffDashboard(review, await this.#aggregate(review))
  }

  async prepare(input: FumaScopedRouteHandlerInput, commandId: string, raw: unknown) {
    const command = parsePaidHandoff(PreparePaidHandoffSchema, raw, 'prepare paid handoff route')
    if (command.commandId !== commandId) throw new TransferServiceError('invalid-input', 'Paid handoff path and command identity differ.', 'commandId')
    const readiness = await this.#current(commandId, command.transferId)
    const existing = await this.#aggregate(readiness)
    if (existing) return receipt(commandId, existing)
    const proposal = await this.#authority.proposal(input, readiness, command.selections)
    return receipt(commandId, await this.#handoff.prepare(command, proposal))
  }

  async confirm(input: FumaScopedRouteHandlerInput, commandId: string, raw: unknown) {
    const command = parsePaidHandoff(PaidHandoffConfirmCommandSchema, raw, 'confirm paid handoff route')
    const readiness = await this.#current(commandId, command.transferId)
    const existing = await this.#aggregate(readiness)
    if (existing?.confirmations[command.side]) return receipt(commandId, existing)
    return receipt(commandId, await this.#handoff.confirm(await this.#authority.confirmation(input, readiness, command)))
  }

  async start(input: FumaScopedRouteHandlerInput, commandId: string, raw: unknown) {
    const command = parsePaidHandoff(PaidHandoffStartCommandSchema, raw, 'start paid handoff route')
    const readiness = await this.#current(commandId, command.transferId)
    const existing = await this.#aggregate(readiness)
    if (existing && ['running', 'resume-requested', 'completed'].includes(existing.proposal.state)) {
      await this.#handoff.reconcile(commandId, existing)
      return receipt(commandId, existing)
    }
    return receipt(commandId, await this.#handoff.start(commandId, await this.#authority.start(input, readiness, command)))
  }

  async recover(input: FumaScopedRouteHandlerInput, commandId: string, raw: unknown) {
    const command = parsePaidHandoff(PaidHandoffRecoveryCommandSchema, raw, 'recover paid handoff route')
    const readiness = await this.#current(commandId, command.transferId)
    const existing = await this.#aggregate(readiness)
    if (existing?.proposal.state === 'resume-requested') {
      await this.#handoff.reconcile(commandId, existing)
      return receipt(commandId, existing)
    }
    return receipt(commandId, await this.#handoff.resume(commandId, await this.#authority.recovery(input, readiness, command)))
  }

  async reconcile(input: FumaScopedRouteHandlerInput, commandId: string, raw: unknown): Promise<PaidHandoffAdminReceipt> {
    const command = parsePaidHandoff(PaidHandoffReconcileCommandSchema, raw, 'reconcile paid handoff route')
    await this.#authority.assertAdmin(input, 'reconcile')
    const readiness = await this.#current(commandId, command.transferId)
    const aggregate = await this.#transfer.get(readiness.source, readiness.transferId)
    if (aggregate.version !== command.expectedVersion) throw new TransferServiceError('stale-version', 'Paid handoff reconciliation version is stale.', 'expectedVersion')
    const current = await this.#handoff.reconcile(commandId, aggregate)
    return this.#adminReceipt(commandId, aggregate, current.outboxState, 'reconciled')
  }

  async escalateRefund(input: FumaScopedRouteHandlerInput, commandId: string, raw: unknown): Promise<PaidHandoffAdminReceipt> {
    const command = parsePaidHandoff(PaidHandoffRefundEscalationCommandSchema, raw, 'refund escalation route')
    await this.#authority.assertAdmin(input, 'refund-escalate')
    const readiness = await this.#current(commandId, command.transferId)
    const aggregate = await this.#transfer.get(readiness.source, readiness.transferId)
    if (aggregate.version !== command.expectedVersion) throw new TransferServiceError('stale-version', 'Paid handoff escalation version is stale.', 'expectedVersion')
    const current = await this.#handoff.escalateRefund(commandId, aggregate, command.reasonCode)
    return this.#adminReceipt(commandId, aggregate, current.outboxState, 'refund-escalated')
  }

  async #current(commandId: string, transferId: string): Promise<PaidHandoffReadiness> {
    const value = parsePaidHandoff(PaidHandoffReadinessSchema, await this.#readiness.resolve(commandId), 'current paid handoff authority')
    if (value.commandId !== commandId || value.transferId !== transferId) throw new TransferServiceError('scope-mismatch', 'Paid handoff identity changed.', 'transferId')
    return value
  }

  async #aggregate(readiness: PaidHandoffReadiness): Promise<TransferAggregate | null> {
    try { return await this.#transfer.get(readiness.source, readiness.transferId) }
    catch (error) { if (error instanceof TransferServiceError && error.code === 'not-found') return null; throw error }
  }

  #adminReceipt(commandId: string, aggregate: TransferAggregate, outboxState: PaidHandoffReadiness['outboxState'], action: PaidHandoffAdminReceipt['action']): PaidHandoffAdminReceipt {
    const now = this.#now(); if (!Number.isFinite(now.getTime())) throw new Error('Paid handoff application clock is invalid.')
    const value = { commandId, transferId: aggregate.proposal.id, action, transferState: aggregate.proposal.state, outboxState, occurredAt: now.toISOString() }
    if (!Value.Check(PaidHandoffAdminReceiptSchema, value)) throw new Error('Paid handoff admin receipt failed strict validation.')
    return Object.freeze(value)
  }
}
