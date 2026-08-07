import { useEffect, useState, type FormEvent } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import type { PlatformCheckoutHttpClient } from './client'
import type { PlatformCheckoutSource, PlatformCheckoutWire } from './contracts'

export type PlatformCheckoutSurfaceProps = Readonly<{
  client: PlatformCheckoutHttpClient
  canCheckout: boolean
  initialCheckoutId?: string | null
  callbackReference?: string | null
}>

function money(amountMinor: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
  }).format(amountMinor / 100)
}

function statusLabel(state: PlatformCheckoutWire['recurring']['state']): string {
  if (state === 'callback-verified') return 'Callback verified — settlement pending'
  if (state === 'ready') return 'Ready for payment'
  if (state === 'failed') return 'Provider initialization failed'
  if (state === 'initializing') return 'Initializing securely'
  return 'Pending initialization'
}

function AuthorizationLink({ obligation }: Readonly<{
  obligation: PlatformCheckoutWire['recurring']
}>) {
  if (!obligation.authorizationUrl || !['ready', 'callback-verified'].includes(obligation.state)) {
    return null
  }
  return (
    <a
      className="mt-2 w-fit text-sm font-semibold text-primary underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      href={obligation.authorizationUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      Continue to secure payment
    </a>
  )
}

function CheckoutSummary({ checkout }: Readonly<{ checkout: PlatformCheckoutWire }>) {
  return (
    <section className="grid gap-6 min-w-0 rounded-md border border-border bg-card p-8" aria-labelledby="checkout-summary-title">
      <header className="flex items-center justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exact checkout</p>
          <h3 id="checkout-summary-title">Bound consideration</h3>
        </div>
        <span className="rounded-md border border-border px-3 py-1 text-xs font-semibold capitalize text-muted-foreground">{checkout.state.replace('-', ' ')}</span>
      </header>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Destination: organization {checkout.destination.organizationId}, workspace{' '}
        {checkout.destination.workspaceId}, site {checkout.destination.siteId}
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <article className="grid content-start gap-2 rounded-md border border-border bg-muted/40 p-6 [&_strong]:font-mono [&_strong]:text-xl [&_strong]:text-foreground [&_p]:text-sm [&_p]:text-muted-foreground [&_h4]:text-foreground" aria-labelledby="setup-consideration-title">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">One-time</p>
          <h4 id="setup-consideration-title">Setup/import fee</h4>
          <strong>{checkout.setup ? money(checkout.setup.amountMinor) : money(0)}</strong>
          <p>{checkout.setup ? statusLabel(checkout.setup.state) : 'No setup fee for this plan'}</p>
          {checkout.setup ? <AuthorizationLink obligation={checkout.setup} /> : null}
        </article>
        <article className="grid content-start gap-2 rounded-md border border-border bg-muted/40 p-6 [&_strong]:font-mono [&_strong]:text-xl [&_strong]:text-foreground [&_p]:text-sm [&_p]:text-muted-foreground [&_h4]:text-foreground" aria-labelledby="recurring-consideration-title">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{checkout.cadence}</p>
          <h4 id="recurring-consideration-title">Recurring consideration</h4>
          <strong>{money(checkout.recurring.amountMinor)}</strong>
          <p>{statusLabel(checkout.recurring.state)}</p>
          <AuthorizationLink obligation={checkout.recurring} />
        </article>
      </div>
      <p className="border-l-2 border-border bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        A browser callback verifies the exact reference only. It does not settle either
        obligation, activate a contract, or transfer a site.
      </p>
    </section>
  )
}

export function PlatformCheckoutSurface({
  client,
  canCheckout,
  initialCheckoutId = null,
  callbackReference = null,
}: PlatformCheckoutSurfaceProps) {
  const [planId, setPlanId] = useState('')
  const [priceBookVersion, setPriceBookVersion] = useState('')
  const [cadence, setCadence] = useState<'monthly' | 'annual'>('annual')
  const [offerId, setOfferId] = useState('')
  const [offerVersion, setOfferVersion] = useState('1')
  const [checkout, setCheckout] = useState<PlatformCheckoutWire | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!initialCheckoutId) return
    let active = true
    async function load(): Promise<void> {
      await Promise.resolve()
      if (!active || !initialCheckoutId) return
      setBusy(true)
      setError('')
      setStatus(callbackReference ? 'Verifying the exact callback reference…' : 'Loading checkout…')
      try {
        const result = callbackReference
          ? await client.verifyCallback(initialCheckoutId, callbackReference)
          : await client.find(initialCheckoutId)
        if (!active) return
        setCheckout(result)
        setStatus(callbackReference
          ? 'Callback verified. Settlement and activation are still pending.'
          : 'Checkout loaded.')
      } catch (caught) {
        if (!active) return
        setError(getErrorMessage(caught, 'Checkout could not be loaded.'))
        setStatus('')
      } finally {
        if (active) setBusy(false)
      }
    }
    void load()
    return () => { active = false }
  }, [callbackReference, client, initialCheckoutId])

  async function begin(source: PlatformCheckoutSource): Promise<void> {
    if (!canCheckout || busy) return
    setBusy(true)
    setError('')
    setStatus('Creating one exact checkout…')
    try {
      const result = await client.initialize(source)
      setCheckout(result)
      setStatus('Checkout ready. Setup and recurring consideration remain separate.')
    } catch (caught) {
      setError(getErrorMessage(caught, 'Checkout could not be initialized.'))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  async function cancel(): Promise<void> {
    if (!checkout || !canCheckout || busy) return
    setBusy(true)
    setError('')
    setStatus('Cancelling checkout…')
    try {
      const result = await client.cancel(checkout.checkoutId)
      setCheckout(result)
      setStatus('Checkout cancelled. No callback can activate it.')
    } catch (caught) {
      setError(getErrorMessage(caught, 'Checkout could not be cancelled.'))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  function submitPlan(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void begin({ kind: 'public-plan', planId, priceBookVersion, cadence })
  }
  function submitOffer(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const version = Number(offerVersion)
    if (!Number.isSafeInteger(version) || version < 1) {
      setError('Offer version must be a positive integer.')
      return
    }
    void begin({ kind: 'private-offer', offerId, offerVersion: version })
  }

  return (
    <section className="grid min-w-0 gap-8 rounded-md bg-muted/40 p-8 text-foreground" aria-labelledby="platform-checkout-title">
      <header className="flex items-center justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Platform billing</p>
          <h2 id="platform-checkout-title">Checkout</h2>
        </div>
        <span className="rounded-md border border-border px-3 py-1 text-xs font-semibold capitalize text-muted-foreground">KES only</span>
      </header>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Start a checkout from a current published plan or an exact issued private offer.
        Customer identity, price, destination, channels, and callback are bound by the server.
      </p>
      {!canCheckout ? (
        <p className="border-l-2 border-border bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground" role="status">
          You can inspect checkout status, but site settings write permission is required to pay or cancel.
        </p>
      ) : null}
      <div className="grid gap-6 sm:grid-cols-2">
        <form className="min-w-0 rounded-md border border-border bg-card" onSubmit={submitPlan}>
          <fieldset disabled={!canCheckout || busy}>
            <legend>Current public plan</legend>
            <label>
              Plan ID
              <input required maxLength={255} value={planId} onChange={(event) => setPlanId(event.target.value)} />
            </label>
            <label>
              Price-book version
              <input required maxLength={100} value={priceBookVersion} onChange={(event) => setPriceBookVersion(event.target.value)} />
            </label>
            <label>
              Recurring cadence
              <select value={cadence} onChange={(event) => setCadence(event.target.value as 'monthly' | 'annual')}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <Button type="submit" disabled={!canCheckout || busy}>Initialize plan checkout</Button>
          </fieldset>
        </form>
        <form className="min-w-0 rounded-md border border-border bg-card" onSubmit={submitOffer}>
          <fieldset disabled={!canCheckout || busy}>
            <legend>Exact private offer</legend>
            <label>
              Offer ID
              <input required maxLength={255} value={offerId} onChange={(event) => setOfferId(event.target.value)} />
            </label>
            <label>
              Offer version
              <input required type="number" min="1" step="1" value={offerVersion} onChange={(event) => setOfferVersion(event.target.value)} />
            </label>
            <p className="text-sm leading-relaxed text-muted-foreground">The issued snapshot fixes setup fee, recurring amount, cadence, and destination.</p>
            <Button type="submit" disabled={!canCheckout || busy}>Initialize offer checkout</Button>
          </fieldset>
        </form>
      </div>
      {checkout ? <CheckoutSummary checkout={checkout} /> : null}
      {checkout?.state === 'awaiting-payment' && canCheckout ? (
        <div className="flex items-center justify-end gap-6">
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void cancel()}>
            Cancel checkout
          </Button>
        </div>
      ) : null}
      {status ? <p className="rounded-md bg-muted px-4 py-3 text-sm text-foreground" role="status" aria-live="polite">{status}</p> : null}
      {error ? <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p> : null}
    </section>
  )
}
