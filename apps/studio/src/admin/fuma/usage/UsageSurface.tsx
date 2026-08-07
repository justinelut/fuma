import { useState } from 'react'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'
import { Label } from '@admin/fuma/ui/label'
import { Textarea } from '@admin/fuma/ui/textarea'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Link } from '@admin/lib/routing'
import type { QuotaSelfServiceHttpClient } from './client'
import {
  QUOTA_CLASS_NAMES,
  type QuotaSelfServiceWire,
} from './contracts'

const LABELS: Readonly<Record<(typeof QUOTA_CLASS_NAMES)[number], string>> = Object.freeze({
  sites: 'Sites',
  pages: 'Pages',
  cmsItems: 'CMS items',
  members: 'Members',
  storageBytes: 'Storage',
  bandwidthBytes: 'Bandwidth',
  emailRecipientsDay: 'Email recipients today',
  emailRecipientsMonth: 'Email recipients this month',
  buildPublishMinutes: 'Build and publish minutes',
  pluginComputeMinutes: 'Plugin compute minutes',
  aiCredits: 'AI credits',
  releaseRetentionBytes: 'Release retention',
  collaborators: 'Collaborators',
  customDomains: 'Custom domains',
})

function quantity(quotaClass: string, value: number): string {
  if (quotaClass.endsWith('Bytes')) {
    if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(1)} GiB`
    if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(1)} MiB`
    if (value >= 1_024) return `${(value / 1_024).toFixed(1)} KiB`
  }
  return new Intl.NumberFormat().format(value)
}

function money(amountMinor: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
  }).format(amountMinor / 100)
}

function date(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function UsageGrid({ model }: Readonly<{ model: QuotaSelfServiceWire }>) {
  return (
    <ul className="grid list-none grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-6 p-0" aria-label="Quota usage">
      {model.usage.map((item) => (
        <li className="rounded-md border border-border bg-card p-6" key={item.quotaClass}>
          <div className="flex justify-between gap-6">
            <strong>{LABELS[item.quotaClass]}</strong>
            <span>{item.percent}%</span>
          </div>
          <div
            className="my-6 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`${LABELS[item.quotaClass]} usage`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={item.percent}
          >
            <span className="block h-full rounded-[inherit] bg-primary" style={{ width: `${item.percent}%` }} />
          </div>
          <p className="text-sm text-foreground">
            {quantity(item.quotaClass, item.used)} used
            {item.reserved > 0 ? ` · ${quantity(item.quotaClass, item.reserved)} reserved` : ''}
          </p>
          <p className="text-sm text-muted-foreground">
            {quantity(item.quotaClass, item.remaining)} remaining of{' '}
            {quantity(item.quotaClass, item.limit + item.topUp)}
            {item.topUp > 0 ? ` (${quantity(item.quotaClass, item.topUp)} adjustment)` : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}

function NoticeHistory({ model }: Readonly<{ model: QuotaSelfServiceWire }>) {
  if (model.notices.length === 0) return null
  return (
    <section className="rounded-md border border-border bg-card p-6" aria-labelledby="quota-notices-title">
      <h3 id="quota-notices-title">Limit notices</h3>
      <ul className="mt-6 grid gap-3 pl-6 text-muted-foreground">
        {model.notices.map((notice, index) => (
          <li key={`${notice.quotaClass}:${notice.percent}:${index}`}>
            <strong>{LABELS[notice.quotaClass]}</strong> reached {notice.percent}%
            {notice.emittedAt ? ` on ${date(notice.emittedAt)}` : ''}.
          </li>
        ))}
      </ul>
    </section>
  )
}

function TopUpRequest({
  client,
  disabled,
}: Readonly<{
  client: QuotaSelfServiceHttpClient
  disabled: boolean
}>) {
  const [quotaClass, setQuotaClass] = useState<(typeof QUOTA_CLASS_NAMES)[number]>('pages')
  const [units, setUnits] = useState('1')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedUnits = Number(units)
    if (!Number.isSafeInteger(parsedUnits) || parsedUnits < 1 || reason.trim().length < 1) {
      setStatus('Enter a positive quantity and a reason.')
      return
    }
    setPending(true)
    setStatus(null)
    try {
      await client.requestTopUp({
        idempotencyKey: crypto.randomUUID(),
        quotaClass,
        units: parsedUnits,
        reason: reason.trim(),
      })
      setStatus('Request submitted for review. No allowance changes until approval.')
      setReason('')
    } catch (error) {
      setStatus(getErrorMessage(error, 'Top-up request failed.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="grid gap-6 rounded-md border border-border bg-card p-6" onSubmit={(event) => void submit(event)}>
      <h3>Request additional allowance</h3>
      <div className="grid gap-6 sm:grid-cols-[1fr_8rem]">
        <div className="grid gap-1.5">
          <Label htmlFor="quota-class">Quota</Label>
          <select
            id="quota-class"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
            value={quotaClass}
            onChange={(event) => setQuotaClass(event.target.value as typeof quotaClass)}
            disabled={disabled || pending}
          >
            {QUOTA_CLASS_NAMES.map((value) => <option key={value} value={value}>{LABELS[value]}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="quota-units">Units</Label>
          <Input id="quota-units" type="number" min="1" step="1" value={units} onChange={(event) => setUnits(event.target.value)} disabled={disabled || pending} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="quota-reason">Reason</Label>
        <Textarea id="quota-reason" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} disabled={disabled || pending} />
      </div>
      <Button type="submit" size="sm" disabled={disabled || pending}>
        {pending ? 'Submitting' : 'Submit request'}
      </Button>
      {status && <p className="text-sm text-muted-foreground" role="status">{status}</p>}
    </form>
  )
}

function CustomerAccount({
  model,
  client,
  canWrite,
}: Readonly<{
  model: QuotaSelfServiceWire & { billing: NonNullable<QuotaSelfServiceWire['billing']> }
  client: QuotaSelfServiceHttpClient
  canWrite: boolean
}>) {
  const [cancelling, setCancelling] = useState(false)
  const [cancelled, setCancelled] = useState(model.billing.account.cancellationRequestedAt !== null)
  const [error, setError] = useState<string | null>(null)

  async function cancel() {
    setCancelling(true)
    setError(null)
    try {
      await client.requestCancellation()
      setCancelled(true)
    } catch (caught) {
      setError(getErrorMessage(caught, 'Cancellation request failed.'))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] gap-6">
      <section className="rounded-md border border-border bg-card p-6" aria-labelledby="account-status-title">
        <h3 id="account-status-title">Account status</h3>
        <p className="inline-flex rounded-full bg-muted px-3 py-1 font-semibold capitalize text-foreground" data-state={model.billing.account.paymentState}>
          {model.billing.account.paymentState.replace('-', ' ')}
        </p>
        {model.billing.account.graceEndsAt && (
          <p>Grace access ends {date(model.billing.account.graceEndsAt)}. Existing data remains available to read and export.</p>
        )}
        {cancelled && <p role="status">Cancellation has been requested. Existing data will not be deleted.</p>}
        {model.billing.actions.cancellation && !cancelled && (
          <Button variant="secondary" size="sm" disabled={!canWrite || cancelling} onClick={() => void cancel()}>
            {cancelling ? 'Requesting' : 'Request cancellation'}
          </Button>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </section>

      <section className="rounded-md border border-border bg-card p-6" aria-labelledby="contracts-title">
        <h3 id="contracts-title">Contracts</h3>
        {model.billing.contracts.length === 0 ? <p>No customer contract records.</p> : (
          <ul className="mt-6 grid gap-3 pl-6 text-muted-foreground">
            {model.billing.contracts.map((contract) => (
              <li key={contract.contractId}>
                <strong>{contract.sourceId}</strong> · {contract.cadence} · {contract.state}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-border bg-card p-6" aria-labelledby="invoices-title">
        <h3 id="invoices-title">Invoices and receipts</h3>
        {model.billing.invoices.length === 0 ? <p>No invoices yet.</p> : (
          <ul className="mt-6 grid gap-3 pl-6 text-muted-foreground">
            {model.billing.invoices.map((invoice) => (
              <li key={invoice.invoiceId}>
                <strong>{invoice.kind}</strong> · {money(invoice.amountMinor)} · {invoice.state}
                {invoice.paidAt ? ` · paid ${date(invoice.paidAt)}` : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">
          {model.billing.transactions.length} transactions · {model.billing.receipts.length} receipts
        </p>
      </section>

      <section className="rounded-md border border-border bg-card p-6" aria-labelledby="adjustments-title">
        <h3 id="adjustments-title">Audited allowances</h3>
        {model.billing.adjustments.length === 0 ? <p>No allowance adjustments.</p> : (
          <ul className="mt-6 grid gap-3 pl-6 text-muted-foreground">
            {model.billing.adjustments.map((adjustment) => (
              <li key={adjustment.adjustmentId}>
                <strong>{adjustment.kind}</strong> · {LABELS[adjustment.quotaClass]} +{quantity(adjustment.quotaClass, adjustment.units)} · {adjustment.state}
                {' '}until {date(adjustment.expiresAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {model.billing.actions.topUpRequest && <TopUpRequest client={client} disabled={!canWrite} />}
    </div>
  )
}

export function UsageSurface({
  model,
  client,
  canWrite,
  mode,
}: Readonly<{
  model: QuotaSelfServiceWire
  client: QuotaSelfServiceHttpClient
  canWrite: boolean
  mode: 'usage' | 'account'
}>) {
  const internal = model.billing === null
  if (mode === 'account' && !internal) {
    return (
      <section className="grid gap-10 p-6 text-foreground" aria-labelledby="customer-account-title">
        <header className="flex flex-col items-start justify-between gap-6 sm:flex-row">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer self-service</p>
            <h2 id="customer-account-title">Plan and billing</h2>
            <p>Review contracts, invoices, transactions, receipts, allowances, and account status.</p>
          </div>
        </header>
        <CustomerAccount model={model as QuotaSelfServiceWire & { billing: NonNullable<QuotaSelfServiceWire['billing']> }} client={client} canWrite={canWrite} />
      </section>
    )
  }
  return (
    <section className="grid gap-10 p-6 text-foreground" aria-labelledby="usage-title">
      <header className="flex flex-col items-start justify-between gap-6 sm:flex-row">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{internal ? 'Protected internal grant' : 'Entitlement usage'}</p>
          <h2 id="usage-title">Usage and quotas</h2>
          <p>Creating new resources stops at the limit. Existing data remains readable and exportable.</p>
        </div>
        <a className="shrink-0 rounded-md border border-border px-4 py-2 font-medium text-foreground no-underline hover:bg-accent" href={client.exportUrl()} download>Export usage</a>
      </header>
      <UsageGrid model={model} />
      <NoticeHistory model={model} />
      {!internal && (
        <p className="text-sm [&_a]:font-medium [&_a]:text-primary">
          <Link to="/admin/settings/billing">Manage plan and account</Link>
        </p>
      )}
    </section>
  )
}
