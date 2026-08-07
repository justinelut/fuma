import { useCallback, useEffect, useState } from 'react'
import type { PublicationContent, PublicationScheduledReadiness, PublicationWorkflowHistoryEvent, PublicationWorkflowInbox } from '@core/fuma/publication'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import type { PublicationHttpClient } from './client'

type Props = Readonly<{
  client: PublicationHttpClient
  content: PublicationContent
  canRead: boolean
  canAssign: boolean
  canReview: boolean
  canApprove: boolean
}>

const emptyInbox: PublicationWorkflowInbox = { assignments: [], reviews: [], notifications: [] }
const id = () => crypto.randomUUID()
const version = (value: string): number | null => value.trim() === '' ? null : Number(value)

export function EditorialWorkflowPanel({ client, content, canRead, canAssign, canReview, canApprove }: Props) {
  const [inbox, setInbox] = useState<PublicationWorkflowInbox>(emptyInbox)
  const [history, setHistory] = useState<readonly PublicationWorkflowHistoryEvent[]>([])
  const [readiness, setReadiness] = useState<PublicationScheduledReadiness | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [roleUserId, setRoleUserId] = useState('')
  const [role, setRole] = useState<'author'|'editor'|'managing-editor'>('author')
  const [roleVersion, setRoleVersion] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [reviewerId, setReviewerId] = useState('')
  const [requestNote, setRequestNote] = useState('')
  const [decision, setDecision] = useState<'changes-requested'|'rejected'|'approved'>('changes-requested')
  const [decisionNote, setDecisionNote] = useState('')
  const [selectedReviewId, setSelectedReviewId] = useState('')

  const refresh = useCallback(async () => {
    if (!canRead) return
    const [nextInbox, nextHistory, nextReadiness] = await Promise.all([
      client.workflowInbox(), client.workflowHistory(content.contentId), client.workflowReadiness(content.contentId),
    ])
    setInbox(nextInbox); setHistory(nextHistory); setReadiness(nextReadiness)
    setSelectedReviewId((current) => nextInbox.reviews.some((item) => item.reviewId === current) ? current : (nextInbox.reviews[0]?.reviewId ?? ''))
  }, [canRead, client, content.contentId])

  useEffect(() => {
    let active = true
    if (!canRead) return () => { active = false }
    queueMicrotask(() => {
      if (!active) return
      setBusy(true); setMessage('')
      void refresh().catch((error) => { if (active) setMessage(getErrorMessage(error, 'Editorial workflow failed to load.')) }).finally(() => { if (active) setBusy(false) })
    })
    return () => { active = false }
  }, [canRead, refresh])

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage('')
    try { await work(); await refresh(); setMessage(success) }
    catch (error) { setMessage(getErrorMessage(error, 'Editorial workflow action failed.')) }
    finally { setBusy(false) }
  }
  const assignment = inbox.assignments.find((item) => item.contentId === content.contentId)
  const review = inbox.reviews.find((item) => item.reviewId === selectedReviewId)

  return <section className="grid gap-3 border-t border-border pt-3 [&>header]:flex [&>header]:items-start [&>header]:justify-between [&>header]:gap-3 [&_header_p]:m-0 [&_header_p]:text-sm [&_header_p]:uppercase [&_header_p]:text-muted-foreground [&_header_h3]:m-0 [&_h4]:m-0 [&_fieldset]:m-0 [&_fieldset]:grid [&_fieldset]:min-w-0 [&_fieldset]:content-start [&_fieldset]:gap-2 [&_fieldset]:rounded-md [&_fieldset]:border [&_fieldset]:border-border [&_fieldset]:p-3 [&_fieldset_p]:m-0 [&_legend]:px-1 [&_legend]:font-bold [&_input]:min-h-9 [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-transparent [&_input]:px-2 [&_select]:min-h-9 [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:px-2 [&_textarea]:min-h-20 [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:p-2 [&_input:focus-visible]:ring-2 [&_input:focus-visible]:ring-ring [&_input:focus-visible]:outline-none [&_select:focus-visible]:ring-2 [&_select:focus-visible]:ring-ring [&_select:focus-visible]:outline-none [&_textarea:focus-visible]:ring-2 [&_textarea:focus-visible]:ring-ring [&_textarea:focus-visible]:outline-none [&_label]:grid [&_label]:gap-1 [&_label]:text-sm" aria-labelledby="editorial-workflow-title">
    <header><div><p>Editorial workflow</p><h3 id="editorial-workflow-title">Assignment and review</h3></div><span className={`rounded-md border border-border px-2 py-1 text-sm ${readiness?.ready ? 'text-primary' : 'text-amber-700 dark:text-amber-300'}`}>{readiness?.ready ? 'Current revision approved' : 'Approval required to schedule'}</span></header>
    {!canRead ? <p className="text-sm text-muted-foreground">Workflow details require <code>publication.workflow.read</code>.</p> : <>
      {busy ? <p role="status" className="text-sm text-muted-foreground">Updating editorial workflow…</p> : null}
      {message ? <p role={message.toLowerCase().includes('fail') || message.toLowerCase().includes('invalid') ? 'alert' : 'status'} className="text-sm text-muted-foreground">{message}</p> : null}
      <div className="grid gap-3 lg:grid-cols-3 [&>section]:grid [&>section]:min-w-0 [&>section]:content-start [&>section]:gap-2 [&>section]:rounded-md [&>section]:border [&>section]:border-border [&>section]:p-3">
        <fieldset disabled={!canAssign || busy}><legend>Role and assignment</legend>
          <label>Staff user ID<input value={roleUserId} maxLength={255} onChange={(event) => setRoleUserId(event.target.value)}/></label>
          <label>Editorial role<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="author">Author</option><option value="editor">Editor</option><option value="managing-editor">Managing editor</option></select></label>
          <label>Current role version<input type="number" min={1} step={1} inputMode="numeric" value={roleVersion} placeholder="Blank for first assignment" onChange={(event) => setRoleVersion(event.target.value)}/></label>
          <Button variant="secondary" size="sm" disabled={!canAssign || busy || !roleUserId.trim()} type="button" onClick={() => void run(() => client.setEditorialRole({ eventId:id(), userId:roleUserId.trim(), role, active:true, expectedVersion:version(roleVersion), note:'Assigned in Studio editorial workflow.' }), 'Editorial role saved.')}>Save active role</Button>
          <label>Content assignee ID<input value={assigneeId} maxLength={255} onChange={(event) => setAssigneeId(event.target.value)}/></label>
          <Button variant="secondary" size="sm" disabled={!canAssign || busy || !assigneeId.trim()} type="button" onClick={() => void run(() => client.assignEditorialContent({ eventId:id(), notificationId:id(), contentId:content.contentId, assigneeId:assigneeId.trim(), expectedVersion:assignment?.version ?? null, note:'Assigned in Studio editorial workflow.' }), 'Content assignment saved and the assignee was notified.')}>Assign current content</Button>
          <small>{assignment ? `Assigned to ${assignment.assigneeId} · assignment v${assignment.version}` : 'No current content assignment.'}</small>
        </fieldset>
        <fieldset disabled={!canReview || busy}><legend>Request review</legend>
          <p>Submit revision <strong>{content.workflowVersion}</strong>. New edits make this request stale.</p>
          <label>Reviewer user ID<input value={reviewerId} maxLength={255} onChange={(event) => setReviewerId(event.target.value)}/></label>
          <label>Review note<textarea value={requestNote} maxLength={1000} onChange={(event) => setRequestNote(event.target.value)}/></label>
          <Button variant="secondary" size="sm" disabled={!canReview || busy || !reviewerId.trim()} type="button" onClick={() => void run(() => client.requestEditorialReview({ eventId:id(), notificationId:id(), reviewId:id(), contentId:content.contentId, contentVersion:content.workflowVersion, reviewerId:reviewerId.trim(), note:requestNote }), 'Current revision submitted for review.')}>Request current-revision review</Button>
        </fieldset>
        <fieldset disabled={!canApprove || busy}><legend>Review decision</legend>
          <label>Pending review<select value={selectedReviewId} onChange={(event) => setSelectedReviewId(event.target.value)}><option value="">Select a review</option>{inbox.reviews.map((item) => <option key={item.reviewId} value={item.reviewId}>{item.contentId} · revision {item.contentVersion}</option>)}</select></label>
          <label>Decision<select value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)}><option value="changes-requested">Request changes</option><option value="rejected">Reject</option><option value="approved">Approve</option></select></label>
          <label>Decision or change note<textarea value={decisionNote} maxLength={1000} required={decision !== 'approved'} onChange={(event) => setDecisionNote(event.target.value)}/></label>
          <Button variant="secondary" size="sm" disabled={!canApprove || busy || !review || (decision !== 'approved' && !decisionNote.trim())} type="button" onClick={() => review && void run(() => client.decideEditorialReview({ eventId:id(), notificationId:id(), reviewId:review.reviewId, contentVersion:review.contentVersion, decision, note:decisionNote }), decision === 'approved' ? 'Current revision approved.' : 'Decision recorded with its immutable note.')}>Record decision</Button>
        </fieldset>
      </div>
      <div className="grid gap-3 lg:grid-cols-3 [&>section]:grid [&>section]:min-w-0 [&>section]:content-start [&>section]:gap-2 [&>section]:rounded-md [&>section]:border [&>section]:border-border [&>section]:p-3">
        <section aria-labelledby="review-inbox-title"><h4 id="review-inbox-title">Review inbox</h4>{inbox.reviews.length ? <ul>{inbox.reviews.map((item) => <li key={item.reviewId}><strong>{item.contentId}</strong><span>Revision {item.contentVersion} · requested by {item.requestedBy}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No pending reviews assigned to you.</p>}</section>
        <section aria-labelledby="workflow-notifications-title"><h4 id="workflow-notifications-title">Notifications</h4>{inbox.notifications.length ? <ul>{inbox.notifications.map((item) => <li key={item.notificationId}><span><strong>{item.kind}</strong><small>{item.message}</small></span>{item.readAt === null ? <Button variant="ghost" size="sm" type="button" onClick={() => void run(() => client.markWorkflowNotificationRead(item.notificationId), 'Notification marked read.')}>Mark read</Button> : <small>Read</small>}</li>)}</ul> : <p className="text-sm text-muted-foreground">No workflow notifications.</p>}</section>
        <section aria-labelledby="workflow-history-title"><h4 id="workflow-history-title">Immutable workflow history</h4>{history.length ? <ol>{history.map((item) => <li key={item.eventId}><strong>{item.kind}</strong><span>{item.note || 'No note'} · {item.createdAt}</span></li>)}</ol> : <p className="text-sm text-muted-foreground">No workflow events for this content.</p>}</section>
      </div>
    </>}
  </section>
}
