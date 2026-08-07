import { useMemo, useState } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'
import { PaidHandoffHttpClient, type PaidHandoffClientTarget, type PaidHandoffDashboardWire, type PaidHandoffSelectionsWire } from './client'

export type PaidHandoffRouteContentProps = Readonly<{ target: PaidHandoffClientTarget; client?: PaidHandoffHttpClient }>
const INITIAL_SELECTIONS: PaidHandoffSelectionsWire = Object.freeze({ domain: 'move-with-site', ai: 'rekey', mcp: 'rescope', plugins: 'rekey', payments: 'rekey', collaborators: 'preserve' })
const LABELS: Readonly<Record<keyof PaidHandoffSelectionsWire, string>> = Object.freeze({ domain: 'Domain choice', ai: 'AI/BYOK choice', mcp: 'MCP connectors', plugins: 'Plugin settings and secrets', payments: 'Payment merchant', collaborators: 'Collaborators' })
const OPTIONS: Readonly<Record<keyof PaidHandoffSelectionsWire, readonly string[]>> = Object.freeze({ domain: ['move-with-site', 'retain-with-source', 'detach'], ai: ['rekey', 'detach'], mcp: ['rescope', 'revoke'], plugins: ['rekey', 'remove'], payments: ['rekey', 'detach'], collaborators: ['preserve', 'remove'] })

export function PaidHandoffRouteContent({ target, client: provided }: PaidHandoffRouteContentProps) {
  const defaultClient = useMemo(() => new PaidHandoffHttpClient(target), [target])
  const client = provided ?? defaultClient
  const [commandId, setCommandId] = useState('')
  const [dashboard, setDashboard] = useState<PaidHandoffDashboardWire | null>(null)
  const [selections, setSelections] = useState<PaidHandoffSelectionsWire>(INITIAL_SELECTIONS)
  const [recoveryReason, setRecoveryReason] = useState('retry-compensated-transfer')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(work: () => Promise<string>) {
    if (busy) return
    setBusy(true); setError(null); setNotice(null)
    try { setNotice(await work()) } catch (caught) { setError(getErrorMessage(caught, 'Paid handoff operation failed.')) } finally { setBusy(false) }
  }
  async function reload(): Promise<PaidHandoffDashboardWire> {
    if (!commandId) throw new Error('Enter the paid handoff command ID.')
    const value = await client.dashboard(commandId)
    setDashboard(value)
    return value
  }
  async function mutate(work: (model: PaidHandoffDashboardWire) => Promise<unknown>, message: string): Promise<string> {
    const model = dashboard ?? await reload()
    await work(model)
    await reload()
    return message
  }
  const transfer = dashboard?.transfer
  const review = dashboard?.review
  const next = dashboard?.nextAction

  return <section className="grid w-full min-w-0 gap-4 p-4 text-foreground" aria-labelledby="paid-handoff-title">
    <header><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Current paid-contract authority</p><h2 id="paid-handoff-title">Site handoff</h2><p>Confirm the exact destination, select every owned asset outcome, and follow the resumable transfer without moving the platform internal grant.</p></header>
    <div className="min-w-0 max-w-full rounded-md border border-border p-3.5 flex flex-wrap justify-between gap-x-4 gap-y-2" role="status"><strong>Production orchestration active</strong><span>en-KE · KES · Africa/Nairobi</span><span>Canonical transfer saga · internal grant excluded</span></div>
    {notice && <p className="min-w-0 max-w-full rounded-md border border-border p-3.5 border-primary" role="status">{notice}</p>}{error && <p className="min-w-0 max-w-full rounded-md border border-border p-3.5 border-destructive text-destructive" role="alert">{error}</p>}
    <form className="flex flex-wrap items-end gap-3 [&_label]:grid [&_label]:min-w-48 [&_label]:flex-1 [&_label]:gap-1" onSubmit={(event) => { event.preventDefault(); void run(async () => { await reload(); return 'Current paid contract and transfer authority revalidated.' }) }}>
      <label>Paid handoff command ID<Input required value={commandId} onChange={(event) => setCommandId(event.currentTarget.value)} /></label>
      <Button type="submit" variant="default" disabled={busy}>Load handoff</Button>
    </form>
    {dashboard && review ? <>
      <section className="min-w-0 max-w-full rounded-md border border-border p-3.5" aria-labelledby="handoff-authority-title"><h3 id="handoff-authority-title">Managed site, offer and payment</h3><dl className="m-0 grid gap-2 sm:grid-cols-2 [&>div]:min-w-0 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:mt-0.5 [&_dd]:break-words">
        <div><dt>Contract</dt><dd>{review.contractId}</dd></div><div><dt>Payment</dt><dd>{review.paymentState}</dd></div>
        <div><dt>Offer</dt><dd>{review.offerId} · version {review.offerVersion}</dd></div><div><dt>Activated</dt><dd>{review.activatedAtLocal}</dd></div>
        <div><dt>Setup</dt><dd>{review.setupAmount}</dd></div><div><dt>Recurring</dt><dd>{review.recurringAmount} · {review.cadence}</dd></div>
        <div><dt>Exact source</dt><dd>{review.source.organizationId} / {review.source.workspaceId} / {review.source.siteId}</dd></div><div><dt>Exact destination</dt><dd>{review.destination.organizationId} / {review.destination.workspaceId} / {review.destination.siteId}</dd></div>
        <div><dt>Managed ownership</dt><dd>{dashboard.managedOwnership}</dd></div><div><dt>Customer quota</dt><dd>{dashboard.customerQuotaApplication}</dd></div>
      </dl><p>Destination active: {String(review.destinationActive)} · quota accepted: {String(review.quotaAccepted)} · policy current: {String(review.policyAcceptanceCurrent)} · metering current: {String(review.meteringEvidenceCurrent)}</p></section>
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
        <section className="min-w-0 max-w-full rounded-md border border-border p-3.5 grid content-start gap-3 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:break-words [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold" aria-labelledby="asset-choices-title"><h3 id="asset-choices-title">Owned asset outcomes</h3>{(Object.keys(LABELS) as Array<keyof PaidHandoffSelectionsWire>).map((asset) => <label key={asset}>{LABELS[asset]}<select aria-label={LABELS[asset]} value={selections[asset]} disabled={busy || transfer !== null} onChange={(event) => setSelections({ ...selections, [asset]: event.currentTarget.value } as PaidHandoffSelectionsWire)}>{OPTIONS[asset].map((option) => <option key={option} value={option}>{option}</option>)}</select><small>{review.assetOwners[asset]}</small></label>)}
          <Button variant="default" disabled={busy || next !== 'choose-assets'} onClick={() => void run(() => mutate((model) => client.prepare(commandId, model.review.transferId, selections), 'Asset outcomes recorded once; source confirmation requested.'))}>Record choices and request confirmation</Button>
        </section>
        <section className="min-w-0 max-w-full rounded-md border border-border p-3.5 grid content-start gap-3 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:break-words [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold" aria-labelledby="handoff-progress-title"><h3 id="handoff-progress-title">Confirmation and progress</h3><progress className="w-full" max={100} value={dashboard.progressPercent}>{dashboard.progressPercent}%</progress><p>{dashboard.progressPercent}% · {transfer?.state ?? 'not prepared'} · next: {next}</p>
          <div className="flex flex-wrap items-end gap-3">
            {next === 'confirm-source' && transfer ? <Button variant="default" disabled={busy} onClick={() => void run(() => mutate((model) => client.confirm(commandId, model.review.transferId, 'source', model.transfer!.version), 'Source owner confirmed with fresh direct authority.'))}>Confirm as source owner</Button> : null}
            {next === 'confirm-destination' && transfer ? <Button variant="default" disabled={busy} onClick={() => void run(() => mutate((model) => client.confirm(commandId, model.review.transferId, 'destination', model.transfer!.version), 'Destination owner confirmed the exact organization and workspace.'))}>Confirm exact destination</Button> : null}
            {next === 'start' && transfer ? <Button variant="default" disabled={busy} onClick={() => void run(() => mutate((model) => client.start(commandId, model.review.transferId, model.transfer!.version), 'Resumable compensated handoff started.'))}>Start resumable handoff</Button> : null}
            {next === 'recover' && transfer?.fence ? <Button variant="default" disabled={busy} onClick={() => void run(() => mutate((model) => client.recover(commandId, model.review.transferId, model.transfer!.version, model.transfer!.fence!, recoveryReason), 'Recovery requested on the current transfer fence.'))}>Resume compensated handoff</Button> : null}
          </div>
          {transfer?.steps.length ? <ol className="m-0 pl-5 [&_li]:my-1">{transfer.steps.map((step) => <li key={`${step.sequence}:${step.definitionId}`}>{step.definitionId} · {step.state}</li>)}</ol> : <p>Transfer steps appear after the canonical registry is snapshotted.</p>}
          {transfer?.failureCode ? <p className="text-destructive" role="alert">Failure: {transfer.failureCode}. Verified payment remains preserved for recovery.</p> : null}
          {next === 'complete' ? <p>Ownership removed from the source and customer quota applied once. The platform internal grant was never transferable.</p> : null}
        </section>
        <section className="min-w-0 max-w-full rounded-md border border-border p-3.5 grid content-start gap-3 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:break-words [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold" aria-labelledby="admin-recovery-title"><h3 id="admin-recovery-title">Admin recovery</h3><p>Reconcile durable saga and outbox state. Refund escalation opens human review; it never changes verified payment or silently issues a refund.</p><label>Recovery reason<Input required value={recoveryReason} onChange={(event) => setRecoveryReason(event.currentTarget.value)} /></label><div className="flex flex-wrap items-end gap-3">
          <Button variant="secondary" disabled={busy || !transfer} onClick={() => void run(() => mutate((model) => client.reconcile(commandId, model.review.transferId, model.transfer!.version), 'Durable transfer and handoff outbox reconciled.'))}>Reconcile current state</Button>
          <Button variant="destructive" disabled={busy || transfer?.state !== 'failed'} onClick={() => void run(() => mutate((model) => client.escalateRefund(commandId, model.review.transferId, model.transfer!.version, recoveryReason), 'Refund review escalated without mutating verified payment.'))}>Escalate refund review</Button>
        </div></section>
      </div>
    </> : <p className="p-8 text-center text-muted-foreground">Load a paid handoff to review the managed site, offer, payment, confirmations, progress, and recovery.</p>}
  </section>
}
