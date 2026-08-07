import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { PublicationMemberSegment } from '@core/fuma/publication'
import type { ResolvedEmailSettingsV2 } from '@core/fuma/publication/emailSettingsContracts'
import type {
  NewsletterAudienceEstimate,
  NewsletterAudienceQuery,
  NewsletterComposerDraft,
  NewsletterDraftAutosaveCommand,
  NewsletterProfileCommand,
  NewsletterSenderVerification,
  NewsletterSendReadiness,
  PublicationNewsletterProfile,
} from '@core/fuma/publication/newsletterComposerContracts'
import { Button } from '@admin/fuma/ui/button'

export type NewsletterComposerSurfaceProps = Readonly<{
  newsletters: readonly PublicationNewsletterProfile[]
  newsletter: PublicationNewsletterProfile | null
  draft: NewsletterComposerDraft | null
  segments: readonly PublicationMemberSegment[]
  settings: ResolvedEmailSettingsV2 | null
  senderVerification: NewsletterSenderVerification | null
  canRead: boolean
  canWrite: boolean
  canSend: boolean
  onSelect(newsletterId: string): void
  onSaveProfile(command: NewsletterProfileCommand): Promise<PublicationNewsletterProfile>
  onAutosave(command: NewsletterDraftAutosaveCommand): Promise<NewsletterComposerDraft>
  onEstimate(newsletterId: string, audience: NewsletterAudienceQuery): Promise<NewsletterAudienceEstimate>
  onReadiness(newsletterId: string): Promise<NewsletterSendReadiness>
  onEditSettings(): void
}>

export function NewsletterComposerSurface(props: NewsletterComposerSurfaceProps) {
  const { newsletter, draft, canWrite, onAutosave } = props
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState(newsletter?.name ?? '')
  const [slug, setSlug] = useState(newsletter?.slug ?? '')
  const [description, setDescription] = useState(newsletter?.description ?? '')
  const [webContentId, setWebContentId] = useState(newsletter?.webContentId ?? '')
  const [subject, setSubject] = useState(draft?.subject ?? '')
  const [previewText, setPreviewText] = useState(draft?.previewText ?? '')
  const [heading, setHeading] = useState(textFromDraft(draft, 'heading'))
  const [body, setBody] = useState(textFromDraft(draft, 'text'))
  const [buttonText, setButtonText] = useState(textFromDraft(draft, 'button'))
  const [buttonUrl, setButtonUrl] = useState(urlFromDraft(draft))
  const [segmentIds, setSegmentIds] = useState<readonly string[]>(draft?.audience.segmentIds ?? (newsletter?.defaultSegmentId ? [newsletter.defaultSegmentId] : []))
  const [match, setMatch] = useState<NewsletterAudienceQuery['match']>(draft?.audience.match ?? 'all')
  const [sequence, setSequence] = useState(draft?.sequence ?? 0)
  const [draftId, setDraftId] = useState<string | null>(draft?.draftId ?? null)
  const [dirtyRevision, setDirtyRevision] = useState(0)
  const [status, setStatus] = useState('')
  const [estimate, setEstimate] = useState<NewsletterAudienceEstimate | null>(null)
  const [readiness, setReadiness] = useState<NewsletterSendReadiness | null>(null)
  const scheduledRevision = useRef(0)

  const audience = useMemo<NewsletterAudienceQuery>(() => ({ segmentIds, match, subscription: 'subscribed', scanLimit: 500 }), [match, segmentIds])
  const activeNewsletterId = creating ? null : newsletter?.newsletterId ?? null

  useEffect(() => {
    if (!canWrite || activeNewsletterId === null || dirtyRevision === 0 || segmentIds.length === 0 || scheduledRevision.current >= dirtyRevision) return
    scheduledRevision.current = dirtyRevision
    const timer = window.setTimeout(() => {
      setStatus('Autosaving draft…')
      void onAutosave({
        newsletterId: activeNewsletterId,
        draftId,
        mutationId: crypto.randomUUID(),
        expectedSequence: sequence,
        subject,
        previewText,
        document: emailDocument(heading, body, buttonText, buttonUrl, previewText),
        audience,
      }).then((saved) => {
        setDraftId(saved.draftId)
        setSequence(saved.sequence)
        setStatus(`Draft autosaved at sequence ${saved.sequence}.`)
      }).catch(() => setStatus('Autosave conflict. Reload the draft before merging edits.'))
    }, 600)
    return () => window.clearTimeout(timer)
  }, [activeNewsletterId, audience, body, buttonText, buttonUrl, canWrite, dirtyRevision, draftId, heading, onAutosave, previewText, segmentIds.length, sequence, subject])

  if (!props.canRead) return <section className="grid gap-6 bg-card p-6 text-foreground [&_h2]:m-0 [&_h3]:m-0 [&_p]:m-0 [&_dl]:m-0" aria-labelledby="newsletter-composer-title"><h2 id="newsletter-composer-title">Newsletters</h2><p>You do not have permission to view newsletter drafts.</p></section>

  function markDirty() { setDirtyRevision((value) => value + 1); setReadiness(null) }
  function updateSegments(segmentId: string, checked: boolean) {
    setSegmentIds((current) => checked ? [...new Set([...current, segmentId])].sort() : current.filter((item) => item !== segmentId))
    markDirty()
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canWrite) return
    setStatus('Saving newsletter identity…')
    try {
      const current = creating ? null : newsletter
      const saved = await props.onSaveProfile({ newsletterId: current?.newsletterId ?? crypto.randomUUID(), name, slug, description, status: current?.status ?? 'active', defaultSegmentId: segmentIds[0] ?? null, webContentId: webContentId || null, expectedVersion: current?.version ?? null })
      setStatus(`Newsletter identity saved at version ${saved.version}.`)
      if (creating || newsletter === null) { setCreating(false); props.onSelect(saved.newsletterId) }
    } catch { setStatus('Newsletter identity changed concurrently or contains an invalid link.') }
  }
  async function estimateAudience() {
    if (!activeNewsletterId || segmentIds.length === 0) return
    setStatus('Estimating subscribed audience…')
    try { const value = await props.onEstimate(activeNewsletterId, audience); setEstimate(value); setStatus(`Audience estimate ready: ${value.estimatedSubscribed} subscribed.`) } catch { setStatus('Audience estimate could not be completed.') }
  }
  async function checkReadiness() {
    if (!activeNewsletterId) return
    setStatus('Checking sender and audience gates…')
    try { const value = await props.onReadiness(activeNewsletterId); setReadiness(value); setStatus(value.canSend ? 'Newsletter is ready to send.' : `Send blocked: ${value.reasons.join(', ')}.`) } catch { setStatus('Send readiness could not be checked.') }
  }

  return <section className="grid gap-6 bg-card p-6 text-foreground [&_h2]:m-0 [&_h3]:m-0 [&_p]:m-0 [&_dl]:m-0" aria-labelledby="newsletter-composer-title">
    <header className="flex items-center justify-between gap-3 [&>div>p]:text-muted-foreground"><div><p>Publication email</p><h2 id="newsletter-composer-title">Newsletter composer</h2></div><span>{props.newsletters.length} newsletter{props.newsletters.length === 1 ? '' : 's'}</span></header>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)]">
      <nav className="sticky top-3 grid gap-2 rounded-md border border-border p-3 [&_button]:grid [&_button]:h-auto [&_button]:justify-items-start [&_button]:text-left [&_small]:block [&_small]:text-xs [&_small]:font-normal [&_small]:text-muted-foreground" aria-label="Newsletters">
        <h3>Newsletters</h3>
        {props.newsletters.length === 0 ? <p>No newsletters yet.</p> : props.newsletters.map((item) => <Button className="justify-start text-left" key={item.newsletterId} variant="ghost" aria-pressed={!creating && item.newsletterId === newsletter?.newsletterId} onClick={() => { setCreating(false); props.onSelect(item.newsletterId) }}>{item.name}<small>{item.slug} · {item.status}</small></Button>)}
        <Button variant="secondary" size="sm" onClick={() => { setCreating(true); setName(''); setSlug(''); setDescription(''); setWebContentId(''); setSubject(''); setPreviewText(''); setHeading(''); setBody(''); setButtonText(''); setButtonUrl(''); setSegmentIds([]); setSequence(0); setDraftId(null); setDirtyRevision(0); scheduledRevision.current = 0; setEstimate(null); setReadiness(null); setStatus('Enter the new newsletter identity.'); }} disabled={!canWrite}>New newsletter</Button>
      </nav>

      <div className="grid min-w-0 gap-6">
        <form className="grid gap-3 rounded-md border border-border p-6 [&_label]:grid [&_label]:gap-1 [&_label]:font-semibold [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-transparent [&_input]:p-2 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-2 [&_textarea]:min-h-28 [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-2 [&_input:focus-visible]:ring-2 [&_input:focus-visible]:ring-ring [&_input:focus-visible]:outline-none [&_textarea:focus-visible]:ring-2 [&_textarea:focus-visible]:ring-ring [&_textarea:focus-visible]:outline-none [&_select:focus-visible]:ring-2 [&_select:focus-visible]:ring-ring [&_select:focus-visible]:outline-none" onSubmit={saveProfile} aria-labelledby="newsletter-identity-title">
          <h3 id="newsletter-identity-title">Identity and web linkage</h3>
          <div className="grid gap-3 sm:grid-cols-2"><label>Name<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} disabled={!canWrite} /></label><label>Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={160} value={slug} onChange={(event) => setSlug(event.target.value)} disabled={!canWrite} /></label></div>
          <label>Description<textarea maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canWrite} /></label>
          <label>Linked universal web content ID<input value={webContentId} onChange={(event) => setWebContentId(event.target.value)} disabled={!canWrite} aria-describedby="web-link-hint" /></label><p id="web-link-hint" className="text-muted-foreground">The ID is resolved in this site’s universal content store; the composer does not copy web content.</p>
          <Button type="submit" variant="secondary" size="sm" disabled={!canWrite}>Save identity</Button>
        </form>

        <section className="grid gap-3 rounded-md border border-border p-6 [&_label]:grid [&_label]:gap-1 [&_label]:font-semibold [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-transparent [&_input]:p-2 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-2 [&_textarea]:min-h-28 [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-2 [&_input:focus-visible]:ring-2 [&_input:focus-visible]:ring-ring [&_input:focus-visible]:outline-none [&_textarea:focus-visible]:ring-2 [&_textarea:focus-visible]:ring-ring [&_textarea:focus-visible]:outline-none [&_select:focus-visible]:ring-2 [&_select:focus-visible]:ring-ring [&_select:focus-visible]:outline-none" aria-labelledby="newsletter-sender-title">
          <div className="flex items-center justify-between gap-3"><h3 id="newsletter-sender-title">Sender and reply-to</h3><Button variant="ghost" size="sm" onClick={props.onEditSettings} disabled={!canWrite || activeNewsletterId === null}>Edit inherited settings</Button></div>
          {!creating && props.settings ? <dl className="grid gap-2 sm:grid-cols-3 [&>div]:grid [&>div]:content-start [&>div]:gap-1 [&>div]:rounded-md [&>div]:border [&>div]:border-border [&>div]:p-2 [&_dt]:font-semibold [&_dd]:m-0 [&_dd:last-child]:text-muted-foreground"><div><dt>From</dt><dd>{props.settings.values.senderName} &lt;{props.settings.values.senderEmail}&gt;</dd><dd>{provenance(props.settings, 'senderEmail')}</dd></div><div><dt>Reply-to</dt><dd>{props.settings.values.replyToEmail}</dd><dd>{provenance(props.settings, 'replyToEmail')}</dd></div><div><dt>Verification</dt><dd>{props.senderVerification?.state ?? 'not checked'}</dd></div></dl> : <p>Select a newsletter to resolve inherited settings.</p>}
        </section>

        <section className="grid gap-3 rounded-md border border-border p-6 [&_label]:grid [&_label]:gap-1 [&_label]:font-semibold [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-transparent [&_input]:p-2 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-2 [&_textarea]:min-h-28 [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-2 [&_input:focus-visible]:ring-2 [&_input:focus-visible]:ring-ring [&_input:focus-visible]:outline-none [&_textarea:focus-visible]:ring-2 [&_textarea:focus-visible]:ring-ring [&_textarea:focus-visible]:outline-none [&_select:focus-visible]:ring-2 [&_select:focus-visible]:ring-ring [&_select:focus-visible]:outline-none" aria-labelledby="newsletter-document-title">
          <h3 id="newsletter-document-title">EmailDocument</h3>
          <div className="grid gap-3 sm:grid-cols-2"><label>Subject<input required maxLength={300} value={subject} onChange={(event) => { setSubject(event.target.value); markDirty() }} disabled={!canWrite || activeNewsletterId === null} /></label><label>Preview text<input maxLength={200} value={previewText} onChange={(event) => { setPreviewText(event.target.value); markDirty() }} disabled={!canWrite || activeNewsletterId === null} /></label></div>
          <label>Heading<input maxLength={500} value={heading} onChange={(event) => { setHeading(event.target.value); markDirty() }} disabled={!canWrite || activeNewsletterId === null} /></label>
          <label>Body<textarea maxLength={8000} value={body} onChange={(event) => { setBody(event.target.value); markDirty() }} disabled={!canWrite || activeNewsletterId === null} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label>Button label<input maxLength={500} value={buttonText} onChange={(event) => { setButtonText(event.target.value); markDirty() }} disabled={!canWrite || activeNewsletterId === null} /></label><label>Button HTTPS URL<input type="url" pattern="https://.*" value={buttonUrl} onChange={(event) => { setButtonUrl(event.target.value); markDirty() }} disabled={!canWrite || activeNewsletterId === null} /></label></div>
          <p className="text-muted-foreground">Edits autosave as a data-only FUMA-042 EmailDocument with optimistic sequence checks.</p>
        </section>

        <section className="grid gap-3 rounded-md border border-border p-6 [&_label]:grid [&_label]:gap-1 [&_label]:font-semibold [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-transparent [&_input]:p-2 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-2 [&_textarea]:min-h-28 [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-2 [&_input:focus-visible]:ring-2 [&_input:focus-visible]:ring-ring [&_input:focus-visible]:outline-none [&_textarea:focus-visible]:ring-2 [&_textarea:focus-visible]:ring-ring [&_textarea:focus-visible]:outline-none [&_select:focus-visible]:ring-2 [&_select:focus-visible]:ring-ring [&_select:focus-visible]:outline-none" aria-labelledby="newsletter-audience-title">
          <h3 id="newsletter-audience-title">Audience query</h3>
          <label>Segment match<select value={match} onChange={(event) => { setMatch(event.target.value as NewsletterAudienceQuery['match']); markDirty() }} disabled={!canWrite || activeNewsletterId === null}><option value="all">All selected segments</option><option value="any">Any selected segment</option></select></label>
          <fieldset disabled={!canWrite || activeNewsletterId === null}><legend>Member segments</legend><div className="grid gap-2 sm:grid-cols-2 [&_label]:grid [&_label]:grid-cols-[auto_1fr] [&_label]:items-center [&_label]:gap-1 [&_label]:rounded-md [&_label]:bg-muted [&_label]:p-2 [&_input]:w-auto [&_small]:col-start-2 [&_small]:font-normal [&_small]:text-muted-foreground">{props.segments.map((segment) => <label key={segment.segmentId}><input type="checkbox" checked={segmentIds.includes(segment.segmentId)} onChange={(event) => updateSegments(segment.segmentId, event.target.checked)} />{segment.name}<small>{segment.kind} · v{segment.version}</small></label>)}</div></fieldset>
          <p className="text-muted-foreground">Only members with current newsletter-specific or global subscribed consent are counted. Estimates inspect at most 500 candidates.</p>
          <div className="flex items-center justify-between gap-3"><Button variant="secondary" size="sm" onClick={estimateAudience} disabled={activeNewsletterId === null || segmentIds.length === 0}>Estimate audience</Button><Button variant="default" size="sm" onClick={checkReadiness} disabled={!props.canSend || activeNewsletterId === null}>Check send readiness</Button></div>
          {estimate ? <output aria-live="polite">{estimate.estimatedSubscribed} subscribed · {estimate.countKind}{estimate.countKind === 'lower-bound' ? ` after ${estimate.evaluatedMembers} checks` : ''}</output> : null}
          {readiness ? <p className={`min-h-6 ${readiness.canSend ? "text-primary" : "text-destructive"}`}>{readiness.canSend ? 'Verified sender, exact audience, and linked content are ready.' : `Blocked: ${readiness.reasons.join(', ')}`}</p> : null}
        </section>
      </div>
    </div>
    <p className="min-h-6 text-muted-foreground" role="status" aria-live="polite">{status}</p>
  </section>
}

function emailDocument(heading: string, body: string, buttonText: string, buttonUrl: string, previewText: string) {
  return { version: 1 as const, lang: 'en' as const, direction: 'ltr' as const, previewText, children: [
    ...(heading ? [{ type: 'heading' as const, level: 1 as const, text: heading }] : []),
    ...(body ? [{ type: 'text' as const, text: body }] : []),
    ...(buttonText && buttonUrl ? [{ type: 'button' as const, text: buttonText, href: buttonUrl }] : []),
  ] }
}
function textFromDraft(draft: NewsletterComposerDraft | null, type: 'heading' | 'text' | 'button'): string { const node = draft?.document.children.find((item) => item.type === type); return node && 'text' in node ? node.text : '' }
function urlFromDraft(draft: NewsletterComposerDraft | null): string { const node = draft?.document.children.find((item) => item.type === 'button'); return node?.type === 'button' ? node.href : '' }
function provenance(settings: ResolvedEmailSettingsV2, key: 'senderEmail' | 'replyToEmail'): string { const value = settings.provenance[key]; return `${value.inherited ? 'Inherited' : 'Direct'} from ${value.level} · version ${value.ordinal}` }
