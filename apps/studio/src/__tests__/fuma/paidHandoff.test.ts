import { describe, expect, test } from 'bun:test'
import type { FumaRequestContext } from '../../../server/fuma/context'
import {
  PAID_HANDOFF_ASSET_OWNERS,
  PaidHandoffService,
  createRegisteredPaidHandoffChoiceAuthority,
  projectPaidHandoffReview,
  type PaidHandoffReadiness,
} from '../../../server/fuma/transfers'
import type { TransferAggregate } from '../../../server/fuma/transfers/repository'
import type { ProposeTransferInput, ResumeTransferInput, StartTransferInput } from '../../../server/fuma/transfers/service'

const source = Object.freeze({ platformId: 'platform-ke', organizationId: 'org-source', workspaceId: 'workspace-source', siteId: 'site-ke' })
const destination = Object.freeze({ platformId: 'platform-ke', organizationId: 'org-destination', workspaceId: 'workspace-destination', siteId: 'site-ke' })
const context = { requestId: 'request-paid-handoff' } as FumaRequestContext
const aggregate = { proposal: { state: 'proposed' }, version: '2026-07-31T06:00:00.000Z' } as unknown as TransferAggregate

function readiness(outboxState: PaidHandoffReadiness['outboxState'] = 'pending'): PaidHandoffReadiness {
  return {
    commandId: 'command-paid-1', transferId: 'transfer-paid-1', contractId: 'contract-paid-1',
    offerId: 'offer-paid-1', offerVersion: 3, source, destination, outboxState,
    paymentState: 'paid-transfer-pending', destinationActive: true, quotaAccepted: true,
    policyAcceptanceCurrent: true, meteringEvidenceCurrent: true, internalGrantExcluded: true,
    assetOwners: PAID_HANDOFF_ASSET_OWNERS, setupAmountMinor: 123456, recurringAmountMinor: 78900,
    currency: 'KES', cadence: 'monthly', locale: 'en-KE', timezone: 'Africa/Nairobi',
    activatedAt: '2026-07-31T06:00:00.000Z',
  }
}

const selections = Object.freeze({
  domain: 'move-with-site' as const,
  ai: 'rekey' as const,
  mcp: 'rescope' as const,
  plugins: 'rekey' as const,
  payments: 'rekey' as const,
  collaborators: 'preserve' as const,
})

function proposal(): ProposeTransferInput {
  return {
    authority: { context } as ProposeTransferInput['authority'],
    manifest: {
      transferId: 'transfer-paid-1', source, destination,
    } as ProposeTransferInput['manifest'],
  }
}

function startInput(): StartTransferInput {
  return {
    authority: { context } as StartTransferInput['authority'], source, transferId: 'transfer-paid-1',
    expectedVersion: '2026-07-31T06:00:00.000Z', lockId: 'lock-paid-1', jobId: 'job-paid-1', runId: 'run-paid-1',
  }
}

function resumeInput(): ResumeTransferInput {
  return {
    authority: { context } as ResumeTransferInput['authority'], source, transferId: 'transfer-paid-1',
    expectedVersion: '2026-07-31T06:00:00.000Z', fence: 1, reasonCode: 'retry-failed-step',
  }
}

describe('FUMA-074 paid transfer handoff', () => {
  test('projects explicit Kenya locale, KES amounts, and current readiness', () => {
    const review = projectPaidHandoffReview(readiness())
    expect(review).toMatchObject({
      locale: 'en-KE', timezone: 'Africa/Nairobi', currency: 'KES',
      canPrepare: true, canRecover: false, blockedReasons: [],
    })
    expect(review.setupAmount).toContain('KES')
    expect(review.recurringAmount).toContain('789.00')
    expect(review.activatedAtLocal).toBeTruthy()
    expect(projectPaidHandoffReview(readiness('failed'))).toMatchObject({ canPrepare: false, canRecover: true })
    expect(projectPaidHandoffReview(readiness('delivered'))).toMatchObject({ blockedReasons: ['already-delivered'] })
  })

  test('requires every registered asset owner and revalidates after recording choices', async () => {
    expect(() => createRegisteredPaidHandoffChoiceAuthority([])).toThrow('exactly one authority')
    const recorded: string[] = []
    const choices = createRegisteredPaidHandoffChoiceAuthority(Object.entries(PAID_HANDOFF_ASSET_OWNERS).map(([asset, ownerTicket]) => ({
      asset: asset as keyof typeof PAID_HANDOFF_ASSET_OWNERS,
      ownerTicket,
      record: async (input: { asset: string; ownerTicket: string }) => { recorded.push(`${input.asset}:${input.ownerTicket}`) },
    })))
    let resolves = 0
    const notifications: string[] = []
    const audits: string[] = []
    const service = new PaidHandoffService({
      readiness: { resolve: async () => { resolves += 1; return readiness() } },
      choices,
      outbox: { transition: async () => { throw new Error('prepare cannot transition outbox') } },
      transfer: {
        propose: async () => aggregate, confirm: async () => aggregate,
        start: async () => aggregate, resume: async () => aggregate,
      },
      notifications: { send: async ({ deliveryKey }) => { notifications.push(deliveryKey) } },
      completion: { complete: async () => undefined },
      refundEscalations: { escalate: async () => undefined },
      audit: { record: async (_context, event) => { audits.push(`${event.action}:${event.outcome}`) } },
      now: () => new Date('2026-07-31T06:00:00Z'),
    })
    expect(await service.prepare({ commandId: 'command-paid-1', transferId: 'transfer-paid-1', selections }, proposal())).toBe(aggregate)
    expect(resolves).toBe(2)
    expect(recorded).toHaveLength(6)
    expect(new Set(recorded)).toEqual(new Set(Object.entries(PAID_HANDOFF_ASSET_OWNERS).map(([asset, owner]) => `${asset}:${owner}`)))
    expect(notifications).toEqual(['paid-handoff:command-paid-1:confirmation-requested'])
    expect(audits).toEqual(['transfer.proposed:success'])
  })

  test('orders idempotent notification/audit before exact outbox start and recovery transitions', async () => {
    let state: PaidHandoffReadiness['outboxState'] = 'pending'
    const events: string[] = []
    const service = new PaidHandoffService({
      readiness: { resolve: async () => readiness(state) },
      choices: { record: async () => undefined },
      outbox: { transition: async ({ from, to }) => { events.push(`outbox:${from}:${to}`); state = to } },
      transfer: {
        propose: async () => aggregate, confirm: async () => aggregate,
        start: async () => { events.push('transfer:start'); return aggregate },
        resume: async () => { events.push('transfer:resume'); return aggregate },
      },
      notifications: { send: async ({ event }) => { events.push(`notify:${event}`) } },
      completion: { complete: async () => { events.push('completion') } },
      refundEscalations: { escalate: async () => { events.push('refund') } },
      audit: { record: async (_context, event) => { events.push(`audit:${event.action}:${event.outcome}`) } },
      now: () => new Date('2026-07-31T06:00:00Z'),
    })
    expect(await service.start('command-paid-1', startInput())).toBe(aggregate)
    expect(events).toEqual(['transfer:start', 'notify:started', 'audit:transfer.started:success', 'outbox:pending:delivered'])
    state = 'failed'; events.length = 0
    expect(await service.resume('command-paid-1', resumeInput())).toBe(aggregate)
    expect(events).toEqual(['transfer:resume', 'notify:recovery-requested', 'audit:transfer.resumed:success', 'outbox:failed:pending'])
  })

  test('replays completion after command delivery without moving an internal grant', async () => {
    const completions: Array<{ internalGrantExcluded: true; transferId: string }> = []
    const events: string[] = []
    const completed = {
      proposal: { id: 'transfer-paid-1', source, destination, state: 'completed', failure: null },
      version: '2026-07-31T06:00:00.000Z', confirmations: { status: 'confirmed' }, lock: null, steps: [],
    } as unknown as TransferAggregate
    const service = new PaidHandoffService({
      readiness: { resolve: async () => readiness('delivered') },
      choices: { record: async () => undefined },
      outbox: { transition: async () => { throw new Error('already delivered must not transition') } },
      transfer: { propose: async () => completed, confirm: async () => completed, start: async () => completed, resume: async () => completed },
      notifications: { send: async ({ event }) => { events.push(event) } },
      completion: { complete: async (input) => { completions.push({ internalGrantExcluded: input.internalGrantExcluded, transferId: input.transferId }) } },
      refundEscalations: { escalate: async () => undefined },
      audit: { record: async () => undefined },
      now: () => new Date('2026-07-31T06:00:00Z'),
    })
    await service.reconcile('command-paid-1', completed)
    await service.reconcile('command-paid-1', completed)
    expect(completions).toEqual([
      { internalGrantExcluded: true, transferId: 'transfer-paid-1' },
      { internalGrantExcluded: true, transferId: 'transfer-paid-1' },
    ])
    expect(events).toEqual(['completed', 'completed'])
  })
})
