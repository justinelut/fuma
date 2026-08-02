import { useMemo, useState } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { ExpertDiscoveryHttpClient, type ExpertClientTarget, type ExpertManagementWire } from './client'
import styles from './ExpertDiscoveryRouteContent.module.css'

export type ExpertDiscoveryRouteContentProps = Readonly<{ target: ExpertClientTarget; client?: ExpertDiscoveryHttpClient }>
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
export function ExpertDiscoveryRouteContent({ target, client: provided }: ExpertDiscoveryRouteContentProps) {
  const defaultClient = useMemo(() => new ExpertDiscoveryHttpClient(target), [target])
  const client = provided ?? defaultClient
  const [expertId, setExpertId] = useState('')
  const [model, setModel] = useState<ExpertManagementWire | null>(null)
  const [message, setMessage] = useState('')
  const [pluginId, setPluginId] = useState('')
  const [transferId, setTransferId] = useState('')
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<string | null>(null); const [error, setError] = useState<string | null>(null)
  async function run(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(null); setNotice(null); try { await work() } catch (caught) { setError(getErrorMessage(caught, 'Expert operation failed.')) } finally { setBusy(false) } }
  async function reload() { if (!expertId) return; setModel(await client.management(expertId)) }
  const profile = model?.profile
  return <section className={styles.root} aria-labelledby="expert-discovery-title">
    <header><p className={styles.eyebrow}>Opt-in marketplace authority</p><h2 id="expert-discovery-title">Expert discovery</h2><p>Manage one approved expert profile in the current organization. Public records exclude recipient and tenant identity.</p></header>
    <div className={styles.sentinel} role="status"><strong>Production authority active</strong><span>FUMA-073 uses existing hosted schema <code>000037_operations_experts_transfer</code>; tenant and transfer scopes are resolved server-side.</span></div>
    {notice && <p className={styles.notice} role="status">{notice}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
    <form className={styles.lookup} onSubmit={(event) => { event.preventDefault(); void run(reload) }}><label>Expert ID<Input required value={expertId} onChange={(event) => setExpertId(event.currentTarget.value)} /></label><Button type="submit" variant="primary" disabled={busy}>Load management record</Button></form>
    {profile ? <div className={styles.grid}>
      <section className={styles.panel} aria-labelledby="visibility-title"><h3 id="visibility-title">Public visibility</h3><p><strong>{profile.public.publicName}</strong> · {profile.public.expertType} · revision {profile.publicRevision}</p><p>{profile.supportedProfiles.join(' + ')} · {profile.availability}</p><Button disabled={busy} variant={profile.optedIn ? 'destructive' : 'primary'} onClick={() => void run(async () => { await client.visibility({ expertId: profile.expertId, optedIn: !profile.optedIn, availability: profile.availability, expectedPublicRevision: profile.publicRevision }); await reload(); setNotice(profile.optedIn ? 'Expert opted out and hidden immediately.' : 'Expert opted in for approved discovery.') })}>{profile.optedIn ? 'Opt out and hide' : 'Opt in to discovery'}</Button></section>
      <form className={styles.panel} onSubmit={(event) => { event.preventDefault(); void run(async () => { await client.inquiry({ inquiryId: id('inquiry'), expertId: profile.expertId, message }); setMessage(''); await reload(); setNotice('Inquiry encrypted and queued without exposing a recipient address.') }) }}><h3>Mediated inquiry</h3><label>Message<textarea required minLength={20} maxLength={8000} value={message} onChange={(event) => setMessage(event.currentTarget.value)} /></label><Button type="submit" variant="primary" disabled={busy || !profile.optedIn}>Encrypt and queue inquiry</Button><small>{model.inquiryCount} queued or processed inquiries; bodies are never returned.</small></form>
      <form className={styles.panel} onSubmit={(event) => { event.preventDefault(); void run(async () => { await client.linkPlugin({ expertId: profile.expertId, pluginId, expectedPublicRevision: profile.publicRevision }); setPluginId(''); await reload(); setNotice('Current reviewed plugin authority linked.') }) }}><h3>Reviewed plugin evidence</h3><label>Plugin ID<Input required value={pluginId} onChange={(event) => setPluginId(event.currentTarget.value)} /></label><Button type="submit" variant="secondary" disabled={busy}>Verify and link</Button><ul>{model.pluginLinks.map((link) => <li key={link.pluginId}>{link.pluginId} · {link.publisherOrganizationId}</li>)}</ul></form>
      <form className={styles.panel} onSubmit={(event) => { event.preventDefault(); void run(async () => { await client.transfer({ expertId: profile.expertId, transferId, expectedPublicRevision: profile.publicRevision }); setTransferId(''); await reload(); setNotice('Expert transferred through current transfer authority and opted out pending destination review.') }) }}><h3>Transfer ownership</h3><label>Transfer ID<Input required value={transferId} onChange={(event) => setTransferId(event.currentTarget.value)} /></label><p>The completed transfer record supplies the destination tenant and owner generation; browser input cannot override them.</p><Button type="submit" variant="destructive" disabled={busy}>Revalidate and transfer</Button></form>
    </div> : <p className={styles.empty}>Load an approved expert to manage opt-in, inquiries, reviewed plugins, and transfers.</p>}
  </section>
}
