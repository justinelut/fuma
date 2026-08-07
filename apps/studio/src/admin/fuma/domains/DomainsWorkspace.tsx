import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'
import { Label } from '@admin/fuma/ui/label'
import { Badge } from '@admin/fuma/ui/badge'
import { RHYTHM } from '@admin/fuma/ui/rhythm'
import type {
  CloudflareBindingWire,
  CloudflareDomainCatalogWire,
  CloudflareDomainsHttpClient,
} from './client'
import { RegistrarSurface } from '../registrar'
import type { RegistrarHttpClient } from '../registrar/contracts'
import { DomainOperationsSurface } from '../domainOperations/DomainOperationsSurface'
import type { DomainOperationsClient, DomainOperationsView } from '../domainOperations/contracts'

type Client = Pick<CloudflareDomainsHttpClient, 'list' | 'create' | 'reconcile' | 'cutover' | 'rollback' | 'remove'>

function stateLabel(binding: CloudflareBindingWire | null): string {
  if (!binding) return 'Not configured'
  return binding.lifecycle.replaceAll('-', ' ')
}

/**
 * A lifecycle is reported with a variant rather than a colour alone, because colour is not a label -
 * the word is always rendered beside it.
 */
function lifecycleVariant(binding: CloudflareBindingWire | null): 'default' | 'secondary' | 'destructive' {
  if (!binding) return 'secondary'
  if (binding.lifecycle === 'active') return 'default'
  if (binding.lifecycle === 'detached' || binding.lifecycle === 'deleted') return 'destructive'
  return 'secondary'
}

/** Diagnostics carry a severity; an error must not read the same as a note. */
function severityClass(severity: string): string {
  return severity === 'error' ? 'text-destructive' : 'text-muted-foreground'
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
    <section aria-labelledby="domains-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Customer-owned DNS · Fuma-managed TLS
          </p>
          <h1 id="domains-title" className={`${RHYTHM.TIGHT} text-lg font-semibold text-foreground`}>Domains</h1>
          <p className={`${RHYTHM.TIGHT} max-w-2xl text-sm text-muted-foreground`}>
            Connect a hostname without moving nameservers or sharing a Cloudflare account. Fuma
            provisions the edge and certificate; you keep authoritative DNS.
          </p>
        </div>
        <Badge variant="secondary">{catalog?.domains.length ?? 0} connected</Badge>
      </header>

      {loading ? <p className={`${RHYTHM.GROUP} text-sm text-muted-foreground`} role="status">Loading domains…</p> : null}
      {error ? <p className={`${RHYTHM.GROUP} text-sm text-destructive`} role="alert">{error}</p> : null}
      {message ? <p className={`${RHYTHM.GROUP} text-sm text-foreground`} role="status">{message}</p> : null}

      {!loading ? (
        <div className={`${RHYTHM.SECTION} grid ${RHYTHM.GROUP_GAP} lg:grid-cols-[18rem_1fr]`}>
          <aside aria-label="Connected domains">
            <form onSubmit={(event) => void create(event)}>
              <Label htmlFor="new-domain-hostname">Add a hostname</Label>
              <div className={`${RHYTHM.TIGHT} flex ${RHYTHM.RELATED_GAP}`}>
                <Input
                  id="new-domain-hostname"
                  type="text"
                  inputMode="url"
                  required
                  placeholder="www.example.co.ke"
                  value={hostname}
                  disabled={!canWrite || busy}
                  onChange={(event) => setHostname(event.target.value)}
                />
                <Button variant="secondary" size="sm" type="submit" disabled={!canWrite || busy || hostname.trim().length < 3}>Add</Button>
              </div>
              <p className={`${RHYTHM.TIGHT} text-xs text-muted-foreground`}>
                Start with www for the fastest CNAME path. Apex domains receive safe alternatives.
              </p>
            </form>
            {catalog?.domains.length ? (
              <ul className={`${RHYTHM.GROUP} flex flex-col ${RHYTHM.RELATED_GAP}`}>
                {catalog.domains.map((item) => (
                  <li key={item.domain.domainId}>
                    <button
                      type="button"
                      aria-pressed={item.domain.domainId === selectedId}
                      onClick={() => { setSelectedId(item.domain.domainId); setConfirmDelete(false); setError(''); setMessage('') }}
                      className={`w-full rounded-md border px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                        item.domain.domainId === selectedId
                          ? 'border-primary bg-accent'
                          : 'border-border hover:bg-accent/50'
                      }`}
                    >
                      <strong className="block truncate text-sm font-medium text-foreground">{item.domain.unicodeHostname}</strong>
                      <span className="block text-xs text-muted-foreground">{stateLabel(item.binding)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={`${RHYTHM.GROUP} rounded-md border border-border p-4`}>
                <strong className="block text-sm font-medium text-foreground">No custom domains yet</strong>
                <span className={`${RHYTHM.TIGHT} block text-sm text-muted-foreground`}>
                  Add www.your-domain.tld to begin DNS prevalidation.
                </span>
              </div>
            )}
          </aside>

          <main>
            {selected ? (
              <>
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Custom hostname</p>
                    <h2 className={`${RHYTHM.TIGHT} text-base font-semibold text-foreground`}>{selected.domain.unicodeHostname}</h2>
                  </div>
                  <Badge variant={lifecycleVariant(selected.binding)}>{stateLabel(selected.binding)}</Badge>
                </header>

                <section className={`${RHYTHM.GROUP} grid ${RHYTHM.RELATED_GAP} sm:grid-cols-3`} aria-label="Domain state">
                  <dl className="rounded-md border border-border p-3">
                    <dt className="text-xs text-muted-foreground">DNS ownership</dt>
                    <dd className={`${RHYTHM.TIGHT} text-sm text-foreground`}>{selected.binding?.ownershipVerified ? 'Verified' : 'Pending'}</dd>
                  </dl>
                  <dl className="rounded-md border border-border p-3">
                    <dt className="text-xs text-muted-foreground">TLS certificate</dt>
                    <dd className={`${RHYTHM.TIGHT} text-sm text-foreground`}>{selected.binding?.sslStatus ?? selected.domain.certificate}</dd>
                  </dl>
                  <dl className="rounded-md border border-border p-3">
                    <dt className="text-xs text-muted-foreground">Edge status</dt>
                    <dd className={`${RHYTHM.TIGHT} text-sm text-foreground`}>{selected.binding?.providerStatus ?? 'Not provisioned'}</dd>
                  </dl>
                </section>

                <section className={RHYTHM.SECTION} aria-labelledby="dns-records-title">
                  <h3 id="dns-records-title" className="text-sm font-medium text-foreground">Exact DNS records</h3>
                  <p className={`${RHYTHM.TIGHT} text-sm text-muted-foreground`}>
                    Add every record at your current DNS provider. Do not enter any Cloudflare credentials here.
                  </p>
                  {selected.binding?.instructions.length ? (
                    <div className={`${RHYTHM.RELATED} overflow-x-auto`}>
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-border text-xs text-muted-foreground">
                            <th scope="col" className="py-2 pr-3 font-medium">Type</th>
                            <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                            <th scope="col" className="py-2 pr-3 font-medium">Value</th>
                            <th scope="col" className="py-2 font-medium">Purpose</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.binding.instructions.map((record) => (
                            <tr className="border-b border-border/60" key={`${record.type}:${record.name}:${record.purpose}`}>
                              <td className="py-2 pr-3 font-medium text-foreground">{record.type}</td>
                              <td className="py-2 pr-3"><code className="text-xs">{record.name}</code></td>
                              <td className="py-2 pr-3"><code className="text-xs break-all">{record.value}</code></td>
                              <td className="py-2 text-muted-foreground">{record.purpose}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className={`${RHYTHM.RELATED} text-sm text-muted-foreground`}>
                      No DNS instructions are available yet.
                    </p>
                  )}
                </section>

                {selected.binding?.diagnostics.length ? (
                  <section className={RHYTHM.SECTION} aria-labelledby="domain-diagnostics-title">
                    <h3 id="domain-diagnostics-title" className="text-sm font-medium text-foreground">Diagnostics</h3>
                    <ul className={`${RHYTHM.RELATED} flex flex-col ${RHYTHM.RELATED_GAP}`}>
                      {selected.binding.diagnostics.map((item, index) => (
                        <li key={`${item.code}:${index}`} className={`text-sm ${severityClass(item.severity)}`}>{item.message}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className={RHYTHM.SECTION} aria-labelledby="domain-actions-title">
                  <h3 id="domain-actions-title" className="text-sm font-medium text-foreground">Lifecycle controls</h3>
                  <p className={`${RHYTHM.TIGHT} text-sm text-muted-foreground`}>
                    Refresh provider evidence before cutover. Rollback preserves your authoritative DNS.
                  </p>
                  <div className={`${RHYTHM.RELATED} flex flex-wrap ${RHYTHM.RELATED_GAP}`}>
                    <Button variant="secondary" size="sm" disabled={!canWrite || busy || !selected.binding} onClick={() => void update(client.reconcile.bind(client), 'Cloudflare status refreshed.')}>Refresh status</Button>
                    <Button size="sm" disabled={!canWrite || busy || selected.binding?.lifecycle !== 'ready'} onClick={() => void update(client.cutover.bind(client), 'Cutover completed after ownership and TLS verification.')}>Cut over</Button>
                    <Button variant="secondary" size="sm" disabled={!canWrite || busy || !selected.binding || ['detached', 'deleted'].includes(selected.binding.lifecycle)} onClick={() => void update(client.rollback.bind(client), 'Domain rolled back and edge cache purged.')}>Roll back</Button>
                    <Button variant="ghost" size="sm" disabled={!canWrite || busy || !selected.binding || selected.binding.lifecycle === 'deleted'} onClick={() => setConfirmDelete(true)}>Remove</Button>
                  </div>
                  {confirmDelete ? (
                    <div className={`${RHYTHM.RELATED} rounded-md border border-destructive/50 p-4`} role="alert">
                      <p className="text-sm text-foreground">
                        Remove this hostname from Fuma edge and revoke its managed certificate? DNS remains at your provider.
                      </p>
                      <div className={`${RHYTHM.RELATED} flex ${RHYTHM.RELATED_GAP}`}>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void update(client.remove.bind(client), 'Domain removed from Fuma edge.')}>Confirm removal</Button>
                      </div>
                    </div>
                  ) : null}
                  {!canWrite ? (
                    <p className={`${RHYTHM.RELATED} text-sm text-muted-foreground`}>
                      Your role can inspect domain status but cannot change routing.
                    </p>
                  ) : null}
                </section>
              </>
            ) : (
              <div className="rounded-md border border-border p-6">
                <strong className="block text-sm font-medium text-foreground">Connect the site’s public address</strong>
                <p className={`${RHYTHM.TIGHT} text-sm text-muted-foreground`}>
                  Add a hostname to receive exact DNS and certificate instructions.
                </p>
              </div>
            )}
          </main>
        </div>
      ) : null}
      {operationsClient && operationsView ? <DomainOperationsSurface view={operationsView} client={operationsClient} canWrite={canWrite} /> : null}
      {registrarClient ? <RegistrarSurface client={registrarClient} canWrite={canWrite} /> : null}
    </section>
  )
}
