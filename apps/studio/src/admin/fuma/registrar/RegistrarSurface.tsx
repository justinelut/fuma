import { useEffect, useState, type FormEvent } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@ui/components/Button'
import type { RegistrarHttpClient } from './contracts'
import type {
  RegistrarContactWire,
  RegistrarPurchaseReceiptWire,
  RegistrarQuoteWire,
  RegistrarRegistrationWire,
  RegistrarRenewalReceiptWire,
} from './contracts'
import styles from './RegistrarSurface.module.css'

export type RegistrarSurfaceProps = Readonly<{
  client: RegistrarHttpClient
  canWrite: boolean
}>

function money(amountMinor: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
  }).format(amountMinor / 100)
}

function requestId(kind: 'purchase' | 'renew'): string {
  return `${kind}:${Date.now()}:${crypto.randomUUID()}`
}

export function RegistrarSurface({ client, canWrite }: RegistrarSurfaceProps) {
  const [hostname, setHostname] = useState('')
  const [periodYears, setPeriodYears] = useState('1')
  const [quote, setQuote] = useState<RegistrarQuoteWire | null>(null)
  const [registrations, setRegistrations] = useState<readonly RegistrarRegistrationWire[]>([])
  const [confirmation, setConfirmation] = useState('')
  const [stepUpProof, setStepUpProof] = useState('')
  const [contact, setContact] = useState<RegistrarContactWire>({
    name: '', email: '', phoneE164: '+254', address: '', country: 'KE',
  })
  const [receipt, setReceipt] = useState<RegistrarPurchaseReceiptWire | RegistrarRenewalReceiptWire | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void client.registrations().then((value) => {
      if (active) setRegistrations(value)
    }).catch((caught) => {
      if (active) setError(getErrorMessage(caught, 'Registrations could not be loaded.'))
    })
    return () => { active = false }
  }, [client])

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const years = Number(periodYears)
    if (!Number.isSafeInteger(years) || years < 1 || years > 10) {
      setError('Registration period must be between one and ten years.')
      return
    }
    setBusy(true)
    setError('')
    setReceipt(null)
    try {
      const next = await client.search({ hostname, periodYears: years })
      setQuote(next)
      setConfirmation('')
      setStatus('Exact quote loaded. Review every term before confirming.')
    } catch (caught) {
      setQuote(null)
      setStatus('')
      setError(getErrorMessage(caught, 'Registrar quote could not be loaded.'))
    } finally {
      setBusy(false)
    }
  }

  async function purchase(): Promise<void> {
    if (!quote || !canWrite || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await client.purchase({
        requestId: requestId('purchase'),
        quoteId: quote.quoteId,
        expectedHostname: quote.hostname,
        expectedAmountMinor: quote.registrationAmountMinor,
        currency: quote.currency,
        expectedTermsHash: quote.termsHash,
        contacts: { registrant: contact, administrative: contact, technical: contact, billing: contact },
        confirmation,
        stepUpProof,
      })
      setReceipt(result)
      setRegistrations(await client.registrations())
      setStatus('Purchase receipt persisted. Managed DNS onboarding was handed off durably.')
    } catch (caught) {
      setError(getErrorMessage(caught, 'Domain purchase could not be confirmed.'))
    } finally {
      setBusy(false)
    }
  }

  async function renew(registration: RegistrarRegistrationWire): Promise<void> {
    if (!quote || !canWrite || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await client.renew({
        requestId: requestId('renew'),
        registrationId: registration.registrationId,
        quoteId: quote.quoteId,
        expectedHostname: registration.hostname,
        expectedPreviousExpiresAt: registration.expiresAt,
        expectedAmountMinor: quote.renewalAmountMinor,
        currency: quote.currency,
        periodYears: quote.periodYears,
        expectedTermsHash: quote.termsHash,
        confirmation,
        stepUpProof,
      })
      setReceipt(result)
      setRegistrations(await client.registrations())
      setStatus('Renewal receipt persisted against the exact previous expiry.')
    } catch (caught) {
      setError(getErrorMessage(caught, 'Domain renewal could not be confirmed.'))
    } finally {
      setBusy(false)
    }
  }

  const matchingRegistration = registrations.find((entry) => entry.hostname === quote?.hostname)
  return (
    <section className={styles.surface} aria-labelledby="registrar-title">
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Fuma-managed registration</p><h2 id="registrar-title">Domain registrar</h2></div>
        <span className={styles.currency}>KES only</span>
      </header>
      <p className={styles.intro}>Search first, then confirm the exact hostname, amount, terms, and registration period. Provider timeouts remain ambiguous until reconciled; a successful purchase hands the domain to managed DNS without exposing provider credentials.</p>
      {!canWrite ? <p className={styles.notice}>Read-only access. Site settings write permission and fresh step-up are required to confirm.</p> : null}
      <form className={styles.form} onSubmit={(event) => { void search(event) }}>
        <label>Domain name<input required value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="example.co.ke" /></label>
        <label>Period (years)<input required min="1" max="10" inputMode="numeric" value={periodYears} onChange={(event) => setPeriodYears(event.target.value)} /></label>
        <Button type="submit" variant="primary" size="md" disabled={busy}>Search and quote</Button>
      </form>
      {quote ? (
        <section className={styles.quote} aria-labelledby="registrar-quote-title">
          <header><div><p className={styles.eyebrow}>Expires {new Date(quote.expiresAt).toLocaleString()}</p><h3 id="registrar-quote-title">{quote.hostname}</h3></div><strong>{matchingRegistration ? money(quote.renewalAmountMinor) : money(quote.registrationAmountMinor)}</strong></header>
          <dl><div><dt>Currency</dt><dd>{quote.currency}</dd></div><div><dt>Period</dt><dd>{quote.periodYears} year(s)</dd></div><div><dt>Minor units</dt><dd>{matchingRegistration ? quote.renewalAmountMinor : quote.registrationAmountMinor}</dd></div><div><dt>Terms hash</dt><dd title={quote.termsHash}>{quote.termsHash.slice(0, 16)}…</dd></div></dl>
          {!matchingRegistration ? (
            <div className={styles.contacts}>
              <label>Registrant name<input required value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} /></label>
              <label>Email<input required type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /></label>
              <label>Kenyan phone<input required value={contact.phoneE164} onChange={(event) => setContact({ ...contact, phoneE164: event.target.value })} /></label>
              <label>Address<input required value={contact.address} onChange={(event) => setContact({ ...contact, address: event.target.value })} /></label>
            </div>
          ) : null}
          <label className={styles.confirm}>Type <code>{matchingRegistration ? `RENEW ${quote.hostname}` : `PURCHASE ${quote.hostname}`}</code><input required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <label className={styles.confirm}>Fresh step-up proof<input required type="password" autoComplete="one-time-code" value={stepUpProof} onChange={(event) => setStepUpProof(event.target.value)} /></label>
          <Button type="button" variant="primary" size="md" disabled={!canWrite || busy} onClick={() => { if (matchingRegistration) void renew(matchingRegistration); else void purchase() }}>{matchingRegistration ? 'Confirm exact renewal' : 'Confirm exact purchase'}</Button>
        </section>
      ) : null}
      {receipt ? <p className={styles.receipt} role="status">Receipt <code>{receipt.receiptId}</code> · {money(receipt.amountMinor)} · expires {new Date(receipt.expiresAt).toLocaleDateString()}</p> : null}
      {status ? <p className={styles.status} role="status">{status}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  )
}
