import { useState, type FormEvent } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@ui/components/Button'
import type {
  DomainDiagnosticWire,
  DomainOperationsClient,
  DomainOperationsView,
  RegistrarTransferView,
} from './contracts'
import styles from './DomainOperationsSurface.module.css'

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
    <section className={styles.surface} aria-labelledby="domain-operations-title">
      <header>
        <div>
          <p className={styles.eyebrow}>Customer-retained authoritative DNS</p>
          <h2 id="domain-operations-title">{view.hostname}</h2>
        </div>
        <span className={styles.state}>{view.launchState}</span>
      </header>
      <p className={styles.intro}>
        Keep DNS at your provider. Add these exact records; no Cloudflare account or token is
        required. Optional customer-managed automation can be attached after launch.
      </p>

      <section className={styles.panel}>
        <h3>Exact DNS records</h3>
        <div className={styles.records}>
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
            className={entry.severity === 'error' ? styles.error : styles.notice}
          >
            {entry.message}
            {entry.expected
              ? ` Expected ${entry.expected.type} ${entry.expected.name} = ${entry.expected.value}`
              : ''}
          </p>
        ))}
      </section>

      <section className={styles.panel}>
        <h3>Apex alternatives</h3>
        <ul>
          {view.apexAlternatives.map((item) => (
            <li key={item.kind} data-available={item.available}>{item.instruction}</li>
          ))}
        </ul>
      </section>

      <section className={styles.panel}>
        <h3>Registrar transfer</h3>
        <form className={styles.form} onSubmit={(event) => void inbound(event)}>
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
          <Button variant="primary" size="lg" type="submit" disabled={!canWrite || busy}>
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
          <div className={styles.transfer}>
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

      <section className={styles.panel}>
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
          variant="primary"
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

      {status ? <p role="status" className={styles.notice}>{status}</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </section>
  )
}
