import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'
import { SupportOperationsHttpClient, type ModerationQueueWire, type SupportClientTarget, type SupportSessionWire } from './client'

const HASH_PATTERN = /^[a-f0-9]{64}$/
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
export type SupportOperationsRouteContentProps = Readonly<{
  target: SupportClientTarget
  pathname: string
  impersonatedBy: string | null
}>

export function SupportOperationsRouteContent({ target, pathname, impersonatedBy }: SupportOperationsRouteContentProps) {
  const { organizationId, workspaceId, siteId } = target
  const client = useMemo(() => new SupportOperationsHttpClient({ organizationId, workspaceId, siteId }), [organizationId, workspaceId, siteId])
  const [targetUserId, setTargetUserId] = useState('')
  const [reason, setReason] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('15')
  const [objectKey, setObjectKey] = useState('')
  const [hash, setHash] = useState('')
  const [current, setCurrent] = useState<SupportSessionWire | null>(null)
  const [queue, setQueue] = useState<ModerationQueueWire | null>(null)
  const [moderation, setModeration] = useState({ caseId: '', priorEvidenceId: '', subjectKind: 'site', subjectId: target.siteId, event: 'opened', reasonCode: '', reason: '', objectKey: '', hash: '' })
  const [recovery, setRecovery] = useState({ requestId: '', targetOwnerId: '', reason: '', objectKey: '', hash: '', approvalId: '', executionId: '', idempotencyKey: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!impersonatedBy) return
    let active = true
    void client.current().then((value) => { if (active) setCurrent(value) }, (caught) => { if (active) setError(getErrorMessage(caught, 'Support session is unavailable.')) })
    return () => { active = false }
  }, [client, impersonatedBy])

  async function run(work: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true); setError(null); setNotice(null)
    try { await work() } catch (caught) { setError(getErrorMessage(caught, 'Support operation failed.')) } finally { setBusy(false) }
  }
  function immutableEvidence(key: string, digest: string) {
    if (!key || !HASH_PATTERN.test(digest)) throw new Error('An existing immutable JSON object key and 64-character SHA-256 hash are required.')
    return { objectKey: key, hashSha256: digest }
  }
  async function begin(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      const session = await client.begin({ supportSessionId: id('support'), targetUserId, reason, durationMinutes: Number(durationMinutes), evidence: immutableEvidence(objectKey, hash) })
      setCurrent(session); setNotice('Support identity changed through Better Auth. Reloading the bounded session…')
      window.location.assign(pathname)
    })
  }
  async function end() {
    if (!current) return
    await run(async () => { await client.end(current.supportSessionId); window.location.assign(pathname) })
  }
  async function submitModeration(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      await client.recordModeration({
        evidenceId: id('moderation'), caseId: moderation.caseId, priorEvidenceId: moderation.priorEvidenceId || null,
        subject: { kind: moderation.subjectKind, id: moderation.subjectId }, event: moderation.event,
        reasonCode: moderation.reasonCode, reason: moderation.reason, evidence: immutableEvidence(moderation.objectKey, moderation.hash),
      })
      setNotice('Immutable moderation evidence recorded and canonical effects applied.')
      setQueue(await client.queue(moderation.event === 'appealed' ? 'appeal' : moderation.event === 'suspended' ? 'suspension' : 'moderation'))
    })
  }
  async function createRecovery(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      const requestId = recovery.requestId || id('recovery')
      await client.createRecovery({ requestId, targetOwnerId: recovery.targetOwnerId, reason: recovery.reason, expiresInMinutes: 10, evidence: immutableEvidence(recovery.objectKey, recovery.hash), channel: 'isolated-owner-recovery' })
      setRecovery((value) => ({ ...value, requestId })); setNotice('Recovery requested. Two other current staff sessions must approve.')
    })
  }
  async function approveRecovery() { await run(async () => { await client.approveRecovery({ approvalId: recovery.approvalId || id('approval'), requestId: recovery.requestId, evidence: immutableEvidence(recovery.objectKey, recovery.hash), channel: 'isolated-owner-recovery' }); setNotice('Current direct staff approval recorded.') }) }
  async function executeRecovery() { await run(async () => { await client.executeRecovery({ executionId: recovery.executionId || id('execution'), requestId: recovery.requestId, recoveryIdempotencyKey: recovery.idempotencyKey, channel: 'isolated-owner-recovery' }); setNotice('Isolated recovery executed by the separate executor.') }) }

  if (impersonatedBy) return (
    <section className="grid gap-4 p-5 rounded-md border border-border bg-card" aria-labelledby="active-support-title">
      <div className="grid gap-1 rounded-md border-2 border-amber-600 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
        <strong id="active-support-title">Support session active</strong>
        <span>Actions are performed as this account and are audited. Internal, owner, moderation, and break-glass authority cannot be inherited.</span>
      </div>
      {current ? <dl className="m-0 grid gap-2 grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] [&>div]:rounded-md [&>div]:border [&>div]:border-border [&>div]:p-3 [&_dt]:text-xs [&_dt]:uppercase [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:break-words"><div><dt>Support ID</dt><dd>{current.supportSessionId}</dd></div><div><dt>Expires</dt><dd>{new Date(current.expiresAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</dd></div><div><dt>Reason</dt><dd>{current.reason}</dd></div></dl> : <p role="status">Loading bounded support evidence…</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button variant="destructive" disabled={busy || !current} onClick={() => void end()}>End support and restore staff identity</Button>
    </section>
  )

  return (
    <section className="grid gap-4 p-5 rounded-md border border-border bg-card" aria-labelledby="support-operations-title">
      <header><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Internal authority only</p><h2 id="support-operations-title">Support, moderation and owner recovery</h2><p>Exact tenant: {target.organizationId} / {target.workspaceId} / {target.siteId}. Evidence must already exist as immutable tenant JSON.</p></header>
      {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}{error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <form className="grid content-start gap-3 rounded-md border border-border bg-muted/40 p-4 [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold [&_textarea]:min-h-10 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-2 [&_select]:min-h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-2" onSubmit={(event) => void begin(event)}><h3>Bounded support session</h3><label>Target user<Input required value={targetUserId} onChange={(event) => setTargetUserId(event.currentTarget.value)} /></label><label>Reason<textarea required minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.currentTarget.value)} /></label><label>Minutes<Input type="number" min="1" max="30" required value={durationMinutes} onChange={(event) => setDurationMinutes(event.currentTarget.value)} /></label><label>Evidence object<Input required value={objectKey} onChange={(event) => setObjectKey(event.currentTarget.value)} /></label><label>SHA-256<Input required value={hash} onChange={(event) => setHash(event.currentTarget.value)} /></label><Button variant="default" disabled={busy} type="submit">Begin through Better Auth</Button></form>
        <form className="grid content-start gap-3 rounded-md border border-border bg-muted/40 p-4 [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold [&_textarea]:min-h-10 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-2 [&_select]:min-h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-2" onSubmit={(event) => void submitModeration(event)}><h3>Moderation lineage</h3><div className="flex flex-wrap items-center justify-between gap-2"><label>Case<Input required value={moderation.caseId} onChange={(event) => setModeration({ ...moderation, caseId: event.currentTarget.value })} /></label><label>Prior evidence<Input value={moderation.priorEvidenceId} onChange={(event) => setModeration({ ...moderation, priorEvidenceId: event.currentTarget.value })} /></label></div><div className="flex flex-wrap items-center justify-between gap-2"><label>Subject<select value={moderation.subjectKind} onChange={(event) => setModeration({ ...moderation, subjectKind: event.currentTarget.value })}>{['user','organization','site','expert','plugin'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Subject ID<Input required value={moderation.subjectId} onChange={(event) => setModeration({ ...moderation, subjectId: event.currentTarget.value })} /></label></div><div className="flex flex-wrap items-center justify-between gap-2"><label>Event<select value={moderation.event} onChange={(event) => setModeration({ ...moderation, event: event.currentTarget.value })}>{['opened','suspended','appealed','resolved'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Reason code<Input required value={moderation.reasonCode} onChange={(event) => setModeration({ ...moderation, reasonCode: event.currentTarget.value })} /></label></div><label>Reason<textarea required minLength={10} value={moderation.reason} onChange={(event) => setModeration({ ...moderation, reason: event.currentTarget.value })} /></label><label>Evidence object<Input required value={moderation.objectKey} onChange={(event) => setModeration({ ...moderation, objectKey: event.currentTarget.value })} /></label><label>SHA-256<Input required value={moderation.hash} onChange={(event) => setModeration({ ...moderation, hash: event.currentTarget.value })} /></label><Button variant="default" disabled={busy} type="submit">Record immutable event</Button><div className="flex flex-wrap gap-2">{(['moderation','suspension','appeal'] as const).map((value) => <Button key={value} type="button" variant="secondary" onClick={() => void run(async () => setQueue(await client.queue(value)))}>{value}</Button>)}</div></form>
        <form className="grid content-start gap-3 rounded-md border border-border bg-muted/40 p-4 [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold [&_textarea]:min-h-10 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-2 [&_select]:min-h-10 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-2" onSubmit={(event) => void createRecovery(event)}><h3>Isolated owner recovery</h3><p>Requester, two approvers, executor, and protected owner must all remain distinct.</p><div className="flex flex-wrap items-center justify-between gap-2"><label>Request ID<Input value={recovery.requestId} onChange={(event) => setRecovery({ ...recovery, requestId: event.currentTarget.value })} /></label><label>Protected owner ID<Input required value={recovery.targetOwnerId} onChange={(event) => setRecovery({ ...recovery, targetOwnerId: event.currentTarget.value })} /></label></div><label>Reason<textarea required minLength={20} value={recovery.reason} onChange={(event) => setRecovery({ ...recovery, reason: event.currentTarget.value })} /></label><div className="flex flex-wrap items-center justify-between gap-2"><label>Evidence object<Input required value={recovery.objectKey} onChange={(event) => setRecovery({ ...recovery, objectKey: event.currentTarget.value })} /></label><label>SHA-256<Input required value={recovery.hash} onChange={(event) => setRecovery({ ...recovery, hash: event.currentTarget.value })} /></label></div><div className="flex flex-wrap gap-2"><Button variant="default" disabled={busy} type="submit">Create request</Button><Button disabled={busy || !recovery.requestId} type="button" variant="secondary" onClick={() => void approveRecovery()}>Approve as current staff</Button></div><div className="flex flex-wrap items-center justify-between gap-2"><label>Execution ID<Input value={recovery.executionId} onChange={(event) => setRecovery({ ...recovery, executionId: event.currentTarget.value })} /></label><label>Idempotency key<Input value={recovery.idempotencyKey} onChange={(event) => setRecovery({ ...recovery, idempotencyKey: event.currentTarget.value })} /></label></div><Button disabled={busy || !recovery.requestId || !recovery.idempotencyKey} type="button" variant="destructive" onClick={() => void executeRecovery()}>Execute as separate staff</Button></form>
      </div>
      {queue && <section className="grid gap-2" aria-label={`${queue.queue} queue`}><h3>{queue.queue} queue</h3>{queue.rows.length === 0 ? <p>No current cases.</p> : <ul>{queue.rows.map((row) => <li key={row.evidenceId}><strong>{row.subject.kind}: {row.subject.id}</strong><span>{row.event} · {row.reasonCode}</span><small>{row.evidenceId}</small></li>)}</ul>}</section>}
    </section>
  )
}
