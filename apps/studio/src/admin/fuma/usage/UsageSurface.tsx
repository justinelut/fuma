import { useState } from 'react'
import { Button } from '@ui/components/Button'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Link } from '@admin/lib/routing'
import type { QuotaSelfServiceHttpClient } from './client'
import {
  QUOTA_CLASS_NAMES,
  type QuotaSelfServiceWire,
} from './contracts'
import styles from './UsageSurface.module.css'

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
    <ul className={styles.usageGrid} aria-label="Quota usage">
      {model.usage.map((item) => (
        <li className={styles.usageCard} key={item.quotaClass}>
          <div className={styles.usageHeading}>
            <strong>{LABELS[item.quotaClass]}</strong>
            <span>{item.percent}%</span>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label={`${LABELS[item.quotaClass]} usage`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={item.percent}
          >
            <span className={styles.progressValue} style={{ width: `${item.percent}%` }} />
          </div>
          <p className={styles.measure}>
            {quantity(item.quotaClass, item.used)} used
            {item.reserved > 0 ? ` · ${quantity(item.quotaClass, item.reserved)} reserved` : ''}
          </p>
          <p className={styles.limit}>
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
    <section className={styles.section} aria-labelledby="quota-notices-title">
      <h3 id="quota-notices-title">Limit notices</h3>
      <ul className={styles.compactList}>
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
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <h3>Request additional allowance</h3>
      <div className={styles.formGrid}>
        <label>
          Quota
          <select value={quotaClass} onChange={(event) => setQuotaClass(event.target.value as typeof quotaClass)} disabled={disabled || pending}>
            {QUOTA_CLASS_NAMES.map((value) => <option key={value} value={value}>{LABELS[value]}</option>)}
          </select>
        </label>
        <label>
          Units
          <input type="number" min="1" step="1" value={units} onChange={(event) => setUnits(event.target.value)} disabled={disabled || pending} />
        </label>
      </div>
      <label>
        Reason
        <textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} disabled={disabled || pending} />
      </label>
      <Button type="submit" variant="primary" size="sm" disabled={disabled || pending}>
        {pending ? 'Submitting' : 'Submit request'}
      </Button>
      {status && <p className={styles.status} role="status">{status}</p>}
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
    <div className={styles.accountGrid}>
      <section className={styles.section} aria-labelledby="account-status-title">
        <h3 id="account-status-title">Account status</h3>
        <p className={styles.accountState} data-state={model.billing.account.paymentState}>
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
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>

      <section className={styles.section} aria-labelledby="contracts-title">
        <h3 id="contracts-title">Contracts</h3>
        {model.billing.contracts.length === 0 ? <p>No customer contract records.</p> : (
          <ul className={styles.compactList}>
            {model.billing.contracts.map((contract) => (
              <li key={contract.contractId}>
                <strong>{contract.sourceId}</strong> · {contract.cadence} · {contract.state}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="invoices-title">
        <h3 id="invoices-title">Invoices and receipts</h3>
        {model.billing.invoices.length === 0 ? <p>No invoices yet.</p> : (
          <ul className={styles.compactList}>
            {model.billing.invoices.map((invoice) => (
              <li key={invoice.invoiceId}>
                <strong>{invoice.kind}</strong> · {money(invoice.amountMinor)} · {invoice.state}
                {invoice.paidAt ? ` · paid ${date(invoice.paidAt)}` : ''}
              </li>
            ))}
          </ul>
        )}
        <p className={styles.muted}>
          {model.billing.transactions.length} transactions · {model.billing.receipts.length} receipts
        </p>
      </section>

      <section className={styles.section} aria-labelledby="adjustments-title">
        <h3 id="adjustments-title">Audited allowances</h3>
        {model.billing.adjustments.length === 0 ? <p>No allowance adjustments.</p> : (
          <ul className={styles.compactList}>
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
      <section className={styles.root} aria-labelledby="customer-account-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Customer self-service</p>
            <h2 id="customer-account-title">Plan and billing</h2>
            <p>Review contracts, invoices, transactions, receipts, allowances, and account status.</p>
          </div>
        </header>
        <CustomerAccount model={model as QuotaSelfServiceWire & { billing: NonNullable<QuotaSelfServiceWire['billing']> }} client={client} canWrite={canWrite} />
      </section>
    )
  }
  return (
    <section className={styles.root} aria-labelledby="usage-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{internal ? 'Protected internal grant' : 'Entitlement usage'}</p>
          <h2 id="usage-title">Usage and quotas</h2>
          <p>Creating new resources stops at the limit. Existing data remains readable and exportable.</p>
        </div>
        <a className={styles.exportLink} href={client.exportUrl()} download>Export usage</a>
      </header>
      <UsageGrid model={model} />
      <NoticeHistory model={model} />
      {!internal && (
        <p className={styles.accountLink}>
          <Link to="/admin/settings/billing">Manage plan and account</Link>
        </p>
      )}
    </section>
  )
}
