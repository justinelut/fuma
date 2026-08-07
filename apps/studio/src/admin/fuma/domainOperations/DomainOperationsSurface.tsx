import { useState, type FormEvent } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import type {
  DomainDiagnosticWire,
  DomainOperationsClient,
  DomainOperationsView,
  RegistrarTransferView,
} from './contracts'

export type DomainOperationsSurfaceProps = Readonly<{
  view: DomainOperationsView
  client: DomainOperationsClient
  canWrite: boolean
}>

export function DomainOperationsSurface({
  view,
  client,
  canWrite,
}: DomainOperationsSurfaceProps) {
  const [diagnostics, setDiagnostics] = useState<readonly DomainDiagnosticWire[]>([])
  const [transfer, setTransfer] = useState<RegistrarTransferView | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [outcome, setOutcome] = useState<
    'retain-with-source' | 'move-with-site' | 'detach-and-manual'
  >('move-with-site')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (caught) {
      setError(getErrorMessage(caught, 'Domain operation failed.'))
    } finally {
      setBusy(false)
    }
  }

  async function inbound(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      const value = await client.startInbound({
        domainId: view.domainId,
        hostname: view.hostname,
        authCode,
        authCodeExpiresAt: new Date(expiresAt).toISOString(),
      })
      setAuthCode('')
      setTransfer(value)
      setStatus('Inbound transfer saved. Resume after removing any registrar lock.')
    })
  }

  return (
    <section className="grid min-w-0 gap-6 rounded-md bg-muted/40 p-8 [&_header]:flex [&_header]:items-center [&_header]:justify-between [&_header]:gap-4 [&_h2]:m-0 [&_h3]:m-0" aria-labelledby="domain-operations-title">
      <header>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer-retained authoritative DNS</p>
          <h2 id="domain-operations-title">{view.hostname}</h2>
        </div>
        <span className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground">{view.launchState}</span>
      </header>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Keep DNS at your provider. Add these exact records; no Cloudflare account or token is
        required. Optional customer-managed automation can be attached after launch.
      </p>

      <section className="grid gap-4 p-6 rounded-md border border-border">
        <h3>Exact DNS records</h3>
        <div className="grid gap-3 [&_dl]:m-0 [&_dl]:grid [&_dl]:gap-3 [&_dl]:sm:grid-cols-[5rem_minmax(8rem,1fr)_minmax(12rem,2fr)_minmax(7rem,1fr)] [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:break-words [&_dd]:font-mono [&_dd]:text-sm">
          {view.records.map((record) => (
            <dl key={`${record.type}:${record.name}:${record.purpose}`}>
              <div><dt>Type</dt><dd>{record.type}</dd></div>
              <div><dt>Name</dt><dd>{record.name}</dd></div>
              <div><dt>Value</dt><dd>{record.value}</dd></div>
              <div><dt>Purpose</dt><dd>{record.purpose}</dd></div>
            </dl>
          ))}
        </div>
        <Button
          variant="secondary"
          size="lg"
          disabled={busy}
          onClick={() => void run(async () => {
            setDiagnostics(await client.diagnose(view.domainId))
            setStatus('DNS and TLS diagnostics refreshed.')
          })}
        >
          Diagnose records
        </Button>
        {diagnostics.map((entry) => (
          <p
            key={`${entry.code}:${entry.expected?.name ?? ''}`}
            className={entry.severity === 'error' ? 'text-sm leading-relaxed text-muted-foreground text-destructive' : 'text-sm leading-relaxed text-muted-foreground'}
          >
            {entry.message}
            {entry.expected
              ? ` Expected ${entry.expected.type} ${entry.expected.name} = ${entry.expected.value}`
              : ''}
          </p>
        ))}
      </section>

      <section className="grid gap-4 p-6 rounded-md border border-border">
        <h3>Apex alternatives</h3>
        <ul>
          {view.apexAlternatives.map((item) => (
            <li key={item.kind} data-available={item.available}>{item.instruction}</li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4 p-6 rounded-md border border-border">
        <h3>Registrar transfer</h3>
        <form className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => void inbound(event)}>
          <label>
            Inbound authorization code
            <input
              type="password"
              autoComplete="off"
              required
              value={authCode}
              onChange={(event) => setAuthCode(event.target.value)}
            />
          </label>
          <label>
            Code expiry
            <input
              type="datetime-local"
              required
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <Button variant="default" size="lg" type="submit" disabled={!canWrite || busy}>
            Start inbound transfer
          </Button>
        </form>
        <Button
          variant="secondary"
          size="lg"
          disabled={!canWrite || busy}
          onClick={() => void run(async () => {
            const value = await client.startOutbound({
              domainId: view.domainId,
              hostname: view.hostname,
            })
            setTransfer(value)
            setStatus('Outbound transfer authorization is encrypted and renewal handoff is pending.')
          })}
        >
          Start outbound transfer
        </Button>
        {transfer ? (
          <div className="grid gap-4 p-6 rounded-md border border-border">
            <strong>{transfer.direction} · {transfer.state}</strong>
            <span>Ownership: {transfer.ownership}</span>
            <span>Renewal: {transfer.renewalHandoff}</span>
            {transfer.registrarLocked ? <span>Unlock at the registrar, then resume.</span> : null}
            <Button
              variant="secondary"
              size="lg"
              disabled={busy}
              onClick={() => void run(async () => {
                setTransfer(await client.resume(transfer.transferOperationId))
              })}
            >
              Resume
            </Button>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 p-6 rounded-md border border-border">
        <h3>Site transfer domain outcome</h3>
        <label>
          Explicit outcome
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as typeof outcome)}
          >
            <option value="retain-with-source">Retain with source</option>
            <option value="move-with-site">Move with site (automation credential stays behind)</option>
            <option value="detach-and-manual">Detach and manage manually</option>
          </select>
        </label>
        <Button
          variant="default"
          size="lg"
          disabled={!canWrite || busy}
          onClick={() => void run(async () => {
            await client.choose(outcome)
            setStatus('Explicit site-transfer domain outcome recorded.')
          })}
        >
          Record domain outcome
        </Button>
      </section>

      {status ? <p role="status" className="text-sm leading-relaxed text-muted-foreground">{status}</p> : null}
      {error ? <p role="alert" className="text-sm leading-relaxed text-muted-foreground text-destructive">{error}</p> : null}
    </section>
  )
}
