import { describe, expect, test } from 'bun:test'
import { createFreshPaidHandoffCommandAuthority, PaidHandoffFreshSessionError, projectPaidHandoffDashboard, projectPaidHandoffReview, type PaidHandoffReadiness } from '../../../server/fuma/transfers'
import type { FumaScopedRouteHandlerInput } from '../../../server/fuma/context'
import type { TransferAggregate } from '../../../server/fuma/transfers/repository'

const source = { platformId: 'platform-ke', organizationId: 'org-source', workspaceId: 'workspace-source', siteId: 'site-ke' }
const destination = { platformId: 'platform-ke', organizationId: 'org-destination', workspaceId: 'workspace-destination', siteId: 'site-ke' }
function readiness(outboxState: PaidHandoffReadiness['outboxState']): PaidHandoffReadiness { return { commandId: 'command-ke', transferId: 'transfer-ke', contractId: 'contract-ke', offerId: 'offer-ke', offerVersion: 4, source, destination, outboxState, paymentState: 'paid-transfer-pending', destinationActive: true, quotaAccepted: true, policyAcceptanceCurrent: true, meteringEvidenceCurrent: true, internalGrantExcluded: true, assetOwners: { domain: 'FUMA-062', ai: 'FUMA-064', mcp: 'FUMA-066', plugins: 'FUMA-067', payments: 'FUMA-069', collaborators: 'FUMA-023' }, setupAmountMinor: 125000, recurringAmountMinor: 75000, currency: 'KES', cadence: 'monthly', locale: 'en-KE', timezone: 'Africa/Nairobi', activatedAt: '2026-07-31T06:00:00.000Z' } }
function aggregate(state: 'proposed' | 'awaiting-confirmations' | 'ready' | 'running' | 'failed' | 'completed'): TransferAggregate { return { proposal: { id: 'transfer-ke', state, failure: state === 'failed' ? { code: 'plugin-compensated' } : null }, version: '2026-07-31T06:10:00.000Z', confirmations: state === 'proposed' ? { status: 'unconfirmed', source: null, destination: null } : state === 'awaiting-confirmations' ? { status: 'partially-confirmed', source: { side: 'source' }, destination: null } : { status: 'confirmed', source: { side: 'source' }, destination: { side: 'destination' } }, lock: ['running','failed','completed'].includes(state) ? { fence: 7 } : null, steps: [{ kind: 'forward', definitionId: 'transfer.base-ownership', sequence: 1, state: state === 'failed' ? 'failed' : state === 'completed' ? 'succeeded' : 'pending' }] } as unknown as TransferAggregate }

describe('FUMA-074 paid handoff application authority', () => {
  test('projects confirmations, failure recovery, completion and applied-once ownership state', () => {
    expect(projectPaidHandoffDashboard(projectPaidHandoffReview(readiness('pending')), aggregate('proposed')).nextAction).toBe('confirm-source')
    expect(projectPaidHandoffDashboard(projectPaidHandoffReview(readiness('pending')), aggregate('awaiting-confirmations')).nextAction).toBe('confirm-destination')
    expect(projectPaidHandoffDashboard(projectPaidHandoffReview(readiness('failed')), aggregate('failed'))).toMatchObject({ progressPercent: 100, nextAction: 'recover', managedOwnership: 'retained', customerQuotaApplication: 'pending', internalGrantExcluded: true })
    expect(projectPaidHandoffDashboard(projectPaidHandoffReview(readiness('delivered')), aggregate('completed'))).toMatchObject({ progressPercent: 100, nextAction: 'complete', managedOwnership: 'removed', customerQuotaApplication: 'applied-once', internalGrantExcluded: true })
  })

  test('re-resolves one matching fresh direct Better Auth session for every mutation', async () => {
    let calls = 0
    const commands = { proposal: async () => { calls += 1; return {} as never }, confirmation: async () => { calls += 1; return {} as never }, start: async () => { calls += 1; return {} as never }, recovery: async () => { calls += 1; return {} as never }, assertAdmin: async () => { calls += 1 } }
    const authority = createFreshPaidHandoffCommandAuthority({ commands, resolveSession: async () => ({ userId: 'staff-ke', sessionId: 'session-ke', createdAt: new Date('2026-07-31T06:09:30Z'), impersonatedBy: null } as never), now: () => new Date('2026-07-31T06:10:00Z') })
    const request = { request: new Request('https://5174.blyss.co.ke/api/fuma'), context: { actor: { kind: 'staff', userId: 'staff-ke', sessionId: 'session-ke', impersonator: null } } } as FumaScopedRouteHandlerInput
    await authority.assertAdmin(request, 'reconcile')
    expect(calls).toBe(1)
    const stale = createFreshPaidHandoffCommandAuthority({ commands, resolveSession: async () => ({ userId: 'staff-ke', sessionId: 'session-ke', createdAt: new Date('2026-07-31T05:00:00Z'), impersonatedBy: null } as never), now: () => new Date('2026-07-31T06:10:00Z') })
    await expect(stale.assertAdmin(request, 'refund-escalate')).rejects.toBeInstanceOf(PaidHandoffFreshSessionError)
    expect(calls).toBe(1)
  })
})
