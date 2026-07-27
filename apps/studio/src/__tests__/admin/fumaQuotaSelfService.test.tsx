import { cleanup, render, screen } from '@testing-library/react'
import { QuotaSelfServiceHttpClient } from '@admin/fuma/usage/client'
import { QUOTA_CLASS_NAMES, type QuotaSelfServiceWire } from '@admin/fuma/usage/contracts'
import { UsageSurface } from '@admin/fuma/usage/UsageSurface'

function usage() {
  return QUOTA_CLASS_NAMES.map((quotaClass) => ({
    quotaClass,
    limit: 100,
    used: 25,
    reserved: 0,
    topUp: 0,
    remaining: 75,
    percent: 25,
  }))
}

function model(internal: boolean): QuotaSelfServiceWire {
  return {
    organizationId: internal ? 'fuma-platform' : 'organization-a',
    source: internal ? 'platform-internal' : 'public-contract',
    sourceId: internal ? 'platform-internal' : 'contract-a',
    sourceVersion: 'v1',
    usage: usage(),
    notices: [{
      organizationId: internal ? 'fuma-platform' : 'organization-a',
      quotaClass: 'pages',
      percent: 50,
      used: 50,
      limit: 100,
      emittedAt: '2026-07-29T09:00:00.000Z',
    }],
    billing: internal ? null : {
      account: { paymentState: 'grace', graceEndsAt: '2026-08-05T09:00:00.000Z', cancellationRequestedAt: null },
      contracts: [{
        contractId: 'contract-a',
        source: 'public-contract',
        sourceId: 'business',
        sourceVersion: 'book-v1',
        cadence: 'annual',
        state: 'active',
        activatedAt: '2026-07-29T09:00:00.000Z',
      }],
      invoices: [{
        invoiceId: 'invoice-a',
        contractId: 'contract-a',
        kind: 'recurring',
        amountMinor: 120_000,
        currency: 'KES',
        state: 'paid',
        issuedAt: '2026-07-29T08:00:00.000Z',
        paidAt: '2026-07-29T09:00:00.000Z',
      }],
      transactions: [{
        transactionId: 'transaction-a',
        invoiceId: 'invoice-a',
        amountMinor: 120_000,
        currency: 'KES',
        settledAt: '2026-07-29T09:00:00.000Z',
      }],
      receipts: [{
        receiptId: 'receipt-a',
        transactionId: 'transaction-a',
        issuedAt: '2026-07-29T09:00:00.000Z',
      }],
      adjustments: [{
        adjustmentId: 'grant-a',
        quotaClass: 'pages',
        units: 10,
        kind: 'grant',
        state: 'active',
        effectiveAt: '2026-07-29T00:00:00.000Z',
        expiresAt: '2026-08-05T00:00:00.000Z',
        approvedBy: 'admin-a',
      }],
      actions: { planChanges: true, cancellation: true, topUpRequest: true },
    },
  }
}

function client(): QuotaSelfServiceHttpClient {
  return new QuotaSelfServiceHttpClient({
    organizationId: 'organization-a',
    workspaceId: 'workspace-a',
    siteId: 'site-a',
    fetch: async () => new Response('{}', { status: 500 }),
  })
}

afterEach(cleanup)

describe('FUMA-057 usage and account UI', () => {
  it('renders protected internal quotas without customer, provider, dunning, or shadow-cost controls', () => {
    render(<UsageSurface model={model(true)} client={client()} canWrite mode="account" />)
    expect(screen.getByRole('heading', { name: 'Usage and quotas' })).toBeTruthy()
    expect(screen.getAllByRole('progressbar')).toHaveLength(14)
    expect(screen.getByText('Protected internal grant')).toBeTruthy()
    for (const forbidden of [
      /plan and billing/i,
      /invoice/i,
      /transaction/i,
      /receipt/i,
      /checkout/i,
      /cancellation/i,
      /grace access/i,
      /provider/i,
      /shadow cost/i,
    ]) expect(screen.queryByText(forbidden)).toBeNull()
  })

  it('renders customer contracts, invoices, receipts, grace, audited grants, and account actions', () => {
    render(<UsageSurface model={model(false)} client={client()} canWrite mode="account" />)
    expect(screen.getByRole('heading', { name: 'Plan and billing' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Contracts' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Invoices and receipts' })).toBeTruthy()
    expect(screen.getByText(/Grace access ends/)).toBeTruthy()
    expect(screen.getByText(/grant/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Request cancellation' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Submit request' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
