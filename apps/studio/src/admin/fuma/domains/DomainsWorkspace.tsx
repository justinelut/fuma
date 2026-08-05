import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@ui/components/Button'
import type {
  CloudflareBindingWire,
  CloudflareDomainCatalogWire,
  CloudflareDomainsHttpClient,
} from './client'
import { RegistrarSurface } from '../registrar'
import type { RegistrarHttpClient } from '../registrar/contracts'
import { DomainOperationsSurface } from '../domainOperations/DomainOperationsSurface'
import type { DomainOperationsClient, DomainOperationsView } from '../domainOperations/contracts'
import styles from './DomainsWorkspace.module.css'

type Client = Pick<CloudflareDomainsHttpClient, 'list' | 'create' | 'reconcile' | 'cutover' | 'rollback' | 'remove'>

function stateLabel(binding: CloudflareBindingWire | null): string {
  if (!binding) return 'Not configured'
  return binding.lifecycle.replaceAll('-', ' ')
}

export function DomainsWorkspace({ client, registrarClient, operationsClient, canWrite }: Readonly<{
  client: Client
  registrarClient?: RegistrarHttpClient
  operationsClient?: DomainOperationsClient
  canWrite: boolean
}>) {
  const [catalog, setCatalog] = useState<CloudflareDomainCatalogWire | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hostname, setHostname] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [operationsView, setOperationsView] = useState<DomainOperationsView | null>(null)

  const load = async (preferred?: string) => {
    const value = await client.list()
    setCatalog(value)
    setSelectedId((current) => preferred ?? current ?? value.domains[0]?.domain.domainId ?? null)
  }

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setLoading(true)
      void client.list().then(
        (value) => {
          if (!active) return
          setCatalog(value)
          setSelectedId(value.domains[0]?.domain.domainId ?? null)
        },
        () => { if (active) setError('Domains could not be loaded.') },
      ).finally(() => { if (active) setLoading(false) })
    })
    return () => { active = false }
  }, [client])

  const selected = useMemo(
    () => catalog?.domains.find(({ domain }) => domain.domainId === selectedId) ?? null,
    [catalog, selectedId],
  )

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      if (!operationsClient || !selectedId) { setOperationsView(null); return }
      void operationsClient.exact(selectedId).then(
        (value) => { if (active) setOperationsView(value) },
        () => { if (active) setOperationsView(null) },
      )
    })
    return () => { active = false }
  }, [operationsClient, selectedId])

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await work()
      setMessage(success)
    } catch (caught) {
      setError(getErrorMessage(caught, 'Domain request could not be completed.'))
    } finally {
      setBusy(false)
    }
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const domainId = crypto.randomUUID()
    await run(async () => {
      await client.create({
        domainId,
        hostname: hostname.trim(),
        capability: {
          alias: false,
          aname: false,
          cnameFlattening: false,
          registrarRedirect: true,
          enterpriseApex: false,
          actualQuoteApproved: false,
          securityReviewApproved: false,
          marginGatePassed: false,
        },
      })
      await load(domainId)
      setHostname('')
    }, 'Domain added. Publish the exact DNS records before cutover.')
  }

  const update = async (
    action: (domainId: string) => Promise<CloudflareBindingWire>,
    success: string,
  ) => {
    if (!selected) return
    await run(async () => {
      await action(selected.domain.domainId)
      await load(selected.domain.domainId)
      setConfirmDelete(false)
    }, success)
  }

  return (
    <section className={styles.workspace} aria-labelledby="domains-title">
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Customer-owned DNS · Fuma-managed TLS</p>
          <h1 id="domains-title">Domains</h1>
          <p>Connect a hostname without moving nameservers or sharing a Cloudflare account. Fuma provisions the edge and certificate; you keep authoritative DNS.</p>
        </div>
        <span className={styles.count}>{catalog?.domains.length ?? 0} connected</span>
      </header>

      {loading ? <p className={styles.status} role="status">Loading domains…</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}

      {!loading ? (
        <div className={styles.layout}>
          <aside className={styles.sidebar} aria-label="Connected domains">
            <form className={styles.addForm} onSubmit={(event) => void create(event)}>
              <label htmlFor="new-domain-hostname">Add a hostname</label>
              <div>
                <input id="new-domain-hostname" type="text" inputMode="url" required placeholder="www.example.co.ke" value={hostname} disabled={!canWrite || busy} onChange={(event) => setHostname(event.target.value)} />
                <Button variant="secondary" size="sm" type="submit" disabled={!canWrite || busy || hostname.trim().length < 3}>Add</Button>
              </div>
              <small>Start with www for the fastest CNAME path. Apex domains receive safe alternatives.</small>
            </form>
            {catalog?.domains.length ? catalog.domains.map((item) => (
              <button key={item.domain.domainId} type="button" className={item.domain.domainId === selectedId ? styles.selectedDomain : styles.domain} aria-pressed={item.domain.domainId === selectedId} onClick={() => { setSelectedId(item.domain.domainId); setConfirmDelete(false); setError(''); setMessage('') }}>
                <strong>{item.domain.unicodeHostname}</strong>
                <span>{stateLabel(item.binding)}</span>
              </button>
            )) : <div className={styles.empty}><strong>No custom domains yet</strong><span>Add www.your-domain.tld to begin DNS prevalidation.</span></div>}
          </aside>

          <main className={styles.detail}>
            {selected ? (
              <>
                <header className={styles.detailHeader}>
                  <div><p>Custom hostname</p><h2>{selected.domain.unicodeHostname}</h2></div>
                  <span data-lifecycle={selected.binding?.lifecycle ?? 'none'}>{stateLabel(selected.binding)}</span>
                </header>

                <section className={styles.stateGrid} aria-label="Domain state">
                  <dl><dt>DNS ownership</dt><dd>{selected.binding?.ownershipVerified ? 'Verified' : 'Pending'}</dd></dl>
                  <dl><dt>TLS certificate</dt><dd>{selected.binding?.sslStatus ?? selected.domain.certificate}</dd></dl>
                  <dl><dt>Edge status</dt><dd>{selected.binding?.providerStatus ?? 'Not provisioned'}</dd></dl>
                </section>

                <section className={styles.records} aria-labelledby="dns-records-title">
                  <div><h3 id="dns-records-title">Exact DNS records</h3><p>Add every record at your current DNS provider. Do not enter any Cloudflare credentials here.</p></div>
                  {selected.binding?.instructions.length ? (
                    <div className={styles.recordTable} role="table" aria-label="Required DNS records">
                      <div className={styles.recordHead} role="row"><span role="columnheader">Type</span><span role="columnheader">Name</span><span role="columnheader">Value</span><span role="columnheader">Purpose</span></div>
                      {selected.binding.instructions.map((record) => (
                        <div className={styles.record} role="row" key={`${record.type}:${record.name}:${record.purpose}`}>
                          <strong role="cell">{record.type}</strong><code role="cell">{record.name}</code><code role="cell">{record.value}</code><span role="cell">{record.purpose}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className={styles.empty}>No DNS instructions are available yet.</p>}
                </section>

                {selected.binding?.diagnostics.length ? (
                  <section className={styles.diagnostics} aria-labelledby="domain-diagnostics-title">
                    <h3 id="domain-diagnostics-title">Diagnostics</h3>
                    {selected.binding.diagnostics.map((item, index) => <p key={`${item.code}:${index}`} data-severity={item.severity}>{item.message}</p>)}
                  </section>
                ) : null}

                <section className={styles.actions} aria-labelledby="domain-actions-title">
                  <div><h3 id="domain-actions-title">Lifecycle controls</h3><p>Refresh provider evidence before cutover. Rollback preserves your authoritative DNS.</p></div>
                  <div>
                    <Button variant="secondary" size="sm" disabled={!canWrite || busy || !selected.binding} onClick={() => void update(client.reconcile.bind(client), 'Cloudflare status refreshed.')}>Refresh status</Button>
                    <Button variant="primary" size="sm" disabled={!canWrite || busy || selected.binding?.lifecycle !== 'ready'} onClick={() => void update(client.cutover.bind(client), 'Cutover completed after ownership and TLS verification.')}>Cut over</Button>
                    <Button variant="secondary" size="sm" disabled={!canWrite || busy || !selected.binding || ['detached', 'deleted'].includes(selected.binding.lifecycle)} onClick={() => void update(client.rollback.bind(client), 'Domain rolled back and edge cache purged.')}>Roll back</Button>
                    <Button variant="ghost" size="sm" disabled={!canWrite || busy || !selected.binding || selected.binding.lifecycle === 'deleted'} onClick={() => setConfirmDelete(true)}>Remove</Button>
                  </div>
                  {confirmDelete ? <div className={styles.confirm} role="alert"><p>Remove this hostname from Fuma edge and revoke its managed certificate? DNS remains at your provider.</p><div><Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="secondary" size="sm" disabled={busy} onClick={() => void update(client.remove.bind(client), 'Domain removed from Fuma edge.')}>Confirm removal</Button></div></div> : null}
                  {!canWrite ? <p className={styles.readOnly}>Your role can inspect domain status but cannot change routing.</p> : null}
                </section>
              </>
            ) : <div className={styles.welcome}><strong>Connect the site’s public address</strong><p>Add a hostname to receive exact DNS and certificate instructions.</p></div>}
          </main>
        </div>
      ) : null}
      {operationsClient && operationsView ? <DomainOperationsSurface view={operationsView} client={operationsClient} canWrite={canWrite} /> : null}
      {registrarClient ? <RegistrarSurface client={registrarClient} canWrite={canWrite} /> : null}
    </section>
  )
}
