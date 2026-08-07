import { useEffect, useMemo, useState } from 'react'
import type {
  PublicationMember,
  PublicationMemberAccess,
  PublicationMemberAccount,
  PublicationMemberSegment,
  PublicationNewsletterConsentState,
  PublicationPrivacyRequest,
} from '@core/fuma/publication'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import { FormField } from '@ui/components/FormField'
import { Input } from '@admin/fuma/ui/input'
import { Textarea } from '@admin/fuma/ui/textarea'
import { Select } from '@ui/components/Select'
import type { PublicationHttpClient } from './client'

type Props = Readonly<{
  client: PublicationHttpClient
  canWrite: boolean
  members: readonly PublicationMember[]
}>

const timestamp = () => new Date().toISOString()
const localDate = (offsetDays: number) => {
  const value = new Date(Date.now() + offsetDays * 86_400_000)
  return value.toISOString().slice(0, 16)
}
const toIso = (value: string) => value ? new Date(value).toISOString() : null

export function MemberAccessSurface({ client, canWrite, members }: Props) {
  const [accounts, setAccounts] = useState<readonly PublicationMemberAccount[]>([])
  const [segments, setSegments] = useState<readonly PublicationMemberSegment[]>([])
  const [access, setAccess] = useState<readonly PublicationMemberAccess[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState(members[0]?.memberId ?? '')
  const [identityId, setIdentityId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [locale, setLocale] = useState('en-KE')
  const [timezone, setTimezone] = useState('Africa/Nairobi')
  const [consentAction, setConsentAction] = useState<'subscribed'|'unsubscribed'>('subscribed')
  const [newsletterId, setNewsletterId] = useState('')
  const [consent, setConsent] = useState<PublicationNewsletterConsentState | null>(null)
  const [segmentName, setSegmentName] = useState('')
  const [segmentKind, setSegmentKind] = useState<'explicit'|'dynamic'>('explicit')
  const [segmentField, setSegmentField] = useState('status')
  const [segmentValue, setSegmentValue] = useState('active')
  const [source, setSource] = useState<PublicationMemberAccess['source']>('complimentary')
  const [resourceKind, setResourceKind] = useState<PublicationMemberAccess['resourceKind']>('publication')
  const [resourceId, setResourceId] = useState(client.target.siteId)
  const [accessKind, setAccessKind] = useState<PublicationMemberAccess['access']>('premium')
  const [expiresAt, setExpiresAt] = useState(localDate(30))
  const [graceEndsAt, setGraceEndsAt] = useState(localDate(37))
  const [paymentDigest, setPaymentDigest] = useState('')
  const [deletionReason, setDeletionReason] = useState('Member requested account erasure.')
  const [privacyRequest, setPrivacyRequest] = useState<PublicationPrivacyRequest | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedMember = useMemo(() => members.find((member) => member.memberId === selectedMemberId) ?? null, [members, selectedMemberId])
  const selectedAccount = useMemo(() => accounts.find((account) => account.memberId === selectedMemberId) ?? null, [accounts, selectedMemberId])

  useEffect(() => {
    let active = true
    void Promise.all([client.memberAccounts(), client.memberSegments()]).then(([nextAccounts, nextSegments]) => {
      if (!active) return
      setAccounts(nextAccounts)
      setSegments(nextSegments)
    }).catch((error) => { if (active) setMessage(getErrorMessage(error, 'Member account data failed to load.')) })
    return () => { active = false }
  }, [client])

  useEffect(() => {
    let active = true
    if (!selectedMemberId) {
      queueMicrotask(() => { if (active) { setAccess([]); setConsent(null) } })
      return () => { active = false }
    }
    void Promise.all([client.memberAccess(selectedMemberId), client.memberConsentState(selectedMemberId, newsletterId || null)]).then(([nextAccess, nextConsent]) => {
      if (!active) return
      setAccess(nextAccess)
      setConsent(nextConsent)
    }).catch(() => { if (active) { setAccess([]); setConsent(null) } })
    return () => { active = false }
  }, [client, newsletterId, selectedMemberId])

  useEffect(() => {
    const account = accounts.find((item) => item.memberId === selectedMemberId)
    queueMicrotask(() => {
      setIdentityId(account?.memberIdentityId ?? '')
      setDisplayName(account?.displayName ?? selectedMember?.name ?? '')
      setLocale(account?.locale ?? 'en-KE')
      setTimezone(account?.timezone ?? 'Africa/Nairobi')
    })
  }, [accounts, selectedMember, selectedMemberId])

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    try { setMessage(await work()) } catch (error) { setMessage(getErrorMessage(error, 'Member operation failed.')) } finally { setBusy(false) }
  }

  const saveAccount = () => run(async () => {
    if (!selectedMember) return 'Select a member first.'
    const now = timestamp()
    const next: PublicationMemberAccount = {
      accountId: selectedAccount?.accountId ?? crypto.randomUUID(),
      memberIdentityId: identityId,
      memberId: selectedMember.memberId,
      displayName,
      locale,
      timezone,
      state: selectedAccount?.state ?? 'active',
      createdAt: selectedAccount?.createdAt ?? now,
      updatedAt: now,
      deletedAt: selectedAccount?.deletedAt ?? null,
    }
    const saved = await client.saveMemberAccount(next, selectedAccount?.updatedAt ?? null)
    setAccounts((current) => [...current.filter((item) => item.accountId !== saved.accountId), saved].toSorted((a, b) => a.accountId.localeCompare(b.accountId)))
    return 'Realm-bound member profile saved.'
  })

  const recordConsent = () => run(async () => {
    if (!selectedAccount) return 'Save the member profile before recording consent.'
    await client.recordMemberConsent({
      eventId: crypto.randomUUID(),
      accountId: selectedAccount.accountId,
      memberId: selectedAccount.memberId,
      newsletterId: newsletterId || null,
      action: consentAction,
      source: 'staff',
      noticeVersion: 'studio-1',
      sourceReceiptId: null,
      occurredAt: timestamp(),
    })
    setConsent(await client.memberConsentState(selectedAccount.memberId, newsletterId || null))
    return `Consent provenance recorded as ${consentAction}.`
  })

  const createSegment = () => run(async () => {
    const now = timestamp()
    const explicitMemberIds = segmentKind === 'explicit' && selectedMemberId ? [selectedMemberId] : []
    const rules = segmentKind === 'dynamic'
      ? segmentField === 'status'
        ? [{ field: 'status' as const, operator: 'in' as const, values: [segmentValue as PublicationMember['status']] }]
        : [{ field: segmentField, operator: 'equals' as const, value: segmentValue }]
      : []
    const saved = await client.saveMemberSegment({ segmentId: crypto.randomUUID(), name: segmentName, kind: segmentKind, match: 'all', rules, explicitMemberIds, version: 1, recalculatedAt: null, createdAt: now, updatedAt: now }, null)
    const snapshot = await client.recalculateMemberSegment(saved.segmentId)
    setSegments((current) => [...current, { ...saved, recalculatedAt: snapshot.calculatedAt }].toSorted((a, b) => a.name.localeCompare(b.name)))
    setSegmentName('')
    return `${saved.kind} segment recalculated with ${snapshot.memberIds.length} member(s).`
  })

  const recalculate = (segmentId: string) => run(async () => {
    const snapshot = await client.recalculateMemberSegment(segmentId)
    setSegments((current) => current.map((segment) => segment.segmentId === segmentId ? { ...segment, recalculatedAt: snapshot.calculatedAt } : segment))
    return `Segment recalculated with ${snapshot.memberIds.length} member(s).`
  })

  const grant = () => run(async () => {
    if (!selectedMemberId) return 'Select a member first.'
    const now = timestamp()
    const saved = await client.grantMemberAccess({
      accessId: crypto.randomUUID(),
      memberId: selectedMemberId,
      source,
      state: 'active',
      resourceKind,
      resourceId,
      access: accessKind,
      startsAt: now,
      expiresAt: toIso(expiresAt),
      graceEndsAt: toIso(graceEndsAt),
      paymentReferenceSha256: source === 'paid' ? paymentDigest : null,
      createdAt: now,
      updatedAt: now,
    })
    setAccess((current) => [...current, saved])
    return `${saved.source} access granted.`
  })

  const revoke = (value: PublicationMemberAccess) => run(async () => {
    const saved = await client.transitionMemberAccess(value.accessId, value.memberId, 'revoked', timestamp())
    setAccess((current) => current.map((item) => item.accessId === saved.accessId ? saved : item))
    return 'Access revoked and evaluator state updated.'
  })

  const exportAccount = () => run(async () => {
    if (!selectedAccount) return 'Select a saved account first.'
    const exported = await client.exportMemberAccount(selectedAccount.accountId)
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `member-${selectedAccount.accountId}-export.json`
    anchor.click()
    URL.revokeObjectURL(url)
    return 'Member export generated from exact-scope records.'
  })

  const requestDeletion = () => run(async () => {
    if (!selectedAccount) return 'Select a saved account first.'
    const request = await client.requestMemberDeletion(selectedAccount.accountId, deletionReason)
    setPrivacyRequest(request)
    setAccounts((current) => current.map((account) => account.accountId === request.accountId ? { ...account, state: 'deletion-pending', updatedAt: request.createdAt } : account))
    return 'Deletion queued; completion revokes sessions and erases profile data atomically.'
  })

  return <div className="grid items-start gap-6 lg:grid-cols-2">
    <section className="grid min-w-0 gap-3 p-6 rounded-md border border-border [&_header]:grid [&_header]:gap-1 [&_h2]:m-0 [&_p]:m-0 [&_header_p]:text-muted-foreground [&_fieldset]:m-0 [&_fieldset]:grid [&_fieldset]:gap-2 [&_fieldset]:rounded-md [&_fieldset]:border [&_fieldset]:border-border [&_fieldset]:p-3 [&_legend]:px-1 [&_legend]:font-semibold" aria-labelledby="member-profile-title">
      <header><h2 id="member-profile-title">Member account and profile</h2><p>Profiles bind to the isolated site-member identity realm, never Studio staff.</p></header>
      <FormField label="Publication member" htmlFor="member-account-member"><Select id="member-account-member" value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)} disabled={busy} options={members.map((member) => ({ value: member.memberId, label: `${member.name || member.email} · ${member.status}` }))}/></FormField>
      <FormField label="Member identity ID" description="The exact FUMA-038 realm identity for this site and profile." htmlFor="member-identity-id"><Input id="member-identity-id" value={identityId} onChange={(event) => setIdentityId(event.target.value)} disabled={!canWrite || busy}/></FormField>
      <FormField label="Display name" htmlFor="member-display-name"><Input id="member-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={!canWrite || busy}/></FormField>
      <div className="grid gap-2 sm:grid-cols-2"><FormField label="Locale" htmlFor="member-locale"><Input id="member-locale" value={locale} onChange={(event) => setLocale(event.target.value)} disabled={!canWrite || busy}/></FormField><FormField label="Timezone" htmlFor="member-timezone"><Input id="member-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={!canWrite || busy}/></FormField></div>
      <Button variant="secondary" size="sm" type="button" disabled={!canWrite || busy || !selectedMember || !identityId || !displayName} onClick={() => void saveAccount()}>Save realm-bound profile</Button>
      <fieldset disabled={!canWrite || busy || !selectedAccount}><legend>Newsletter consent</legend><FormField label="Newsletter ID" description="Leave blank for publication-wide consent." htmlFor="member-newsletter-id"><Input id="member-newsletter-id" value={newsletterId} onChange={(event) => setNewsletterId(event.target.value)}/></FormField><FormField label="Current action" htmlFor="member-consent-action"><Select id="member-consent-action" value={consentAction} onChange={(event) => setConsentAction(event.target.value as typeof consentAction)} options={[{ value: 'subscribed', label: 'Subscribed' }, { value: 'unsubscribed', label: 'Unsubscribed' }]}/></FormField><Button variant="secondary" size="sm" type="button" onClick={() => void recordConsent()}>Append consent event</Button>{consent?<p className="text-muted-foreground">Current: {consent.subscribed ? 'subscribed' : 'unsubscribed'} · source {consent.provenance?.source ?? 'none'} · notice {consent.provenance?.noticeVersion ?? 'none'}</p>:null}</fieldset>
    </section>

    <section className="grid min-w-0 gap-3 p-6 rounded-md border border-border [&_header]:grid [&_header]:gap-1 [&_h2]:m-0 [&_p]:m-0 [&_header_p]:text-muted-foreground [&_fieldset]:m-0 [&_fieldset]:grid [&_fieldset]:gap-2 [&_fieldset]:rounded-md [&_fieldset]:border [&_fieldset]:border-border [&_fieldset]:p-3 [&_legend]:px-1 [&_legend]:font-semibold" aria-labelledby="member-segments-title">
      <header><h2 id="member-segments-title">Explicit and dynamic segments</h2><p>Every saved definition recalculates a versioned, deterministic membership snapshot.</p></header>
      <ul className="m-0 grid list-none gap-1 p-0 [&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-2 [&_li]:rounded-md [&_li]:border [&_li]:border-border [&_li]:p-2 [&_li>span]:grid [&_li>span]:min-w-0 [&_li>span]:gap-1 [&_small]:text-muted-foreground">{segments.map((segment) => <li key={segment.segmentId}><span><strong>{segment.name}</strong><small>{segment.kind} · v{segment.version} · {segment.recalculatedAt ? new Date(segment.recalculatedAt).toLocaleString() : 'not calculated'}</small></span><Button variant="ghost" size="sm" type="button" disabled={!canWrite || busy} onClick={() => void recalculate(segment.segmentId)}>Recalculate</Button></li>)}</ul>
      <FormField label="Segment name" htmlFor="member-segment-name"><Input id="member-segment-name" value={segmentName} onChange={(event) => setSegmentName(event.target.value)} disabled={!canWrite || busy}/></FormField>
      <FormField label="Segment kind" htmlFor="member-segment-kind"><Select id="member-segment-kind" value={segmentKind} onChange={(event) => setSegmentKind(event.target.value as typeof segmentKind)} disabled={!canWrite || busy} options={[{ value: 'explicit', label: 'Explicit selected member' }, { value: 'dynamic', label: 'Dynamic rule' }]}/></FormField>
      {segmentKind === 'dynamic' ? <div className="grid gap-2 sm:grid-cols-2"><FormField label="Rule field" htmlFor="member-segment-field"><Input id="member-segment-field" value={segmentField} onChange={(event) => setSegmentField(event.target.value)} disabled={!canWrite || busy}/></FormField><FormField label="Rule value" htmlFor="member-segment-value"><Input id="member-segment-value" value={segmentValue} onChange={(event) => setSegmentValue(event.target.value)} disabled={!canWrite || busy}/></FormField></div> : <p className="text-muted-foreground">The selected member is the explicit membership source.</p>}
      <Button variant="secondary" size="sm" type="button" disabled={!canWrite || busy || !segmentName || (segmentKind === 'explicit' && !selectedMemberId)} onClick={() => void createSegment()}>Save and recalculate segment</Button>
    </section>

    <section className="grid min-w-0 gap-3 p-6 rounded-md border border-border [&_header]:grid [&_header]:gap-1 [&_h2]:m-0 [&_p]:m-0 [&_header_p]:text-muted-foreground [&_fieldset]:m-0 [&_fieldset]:grid [&_fieldset]:gap-2 [&_fieldset]:rounded-md [&_fieldset]:border [&_fieldset]:border-border [&_fieldset]:p-3 [&_legend]:px-1 [&_legend]:font-semibold" aria-labelledby="member-access-title">
      <header><h2 id="member-access-title">Complimentary, manual, and paid access</h2><p>Expiry, grace, and revocation feed the exact content presentation evaluator.</p></header>
      <div className="max-w-full overflow-auto"><table><caption>Access for {selectedMember?.name || selectedMember?.email || 'selected member'}</caption><thead><tr><th>Source</th><th>Resource</th><th>State</th><th>Expiry</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{access.map((value) => <tr key={value.accessId}><td>{value.source}</td><td>{value.resourceKind}: {value.resourceId}</td><td>{value.state}</td><td>{value.expiresAt ? new Date(value.expiresAt).toLocaleDateString() : 'Never'}</td><td><Button variant="ghost" size="sm" type="button" disabled={!canWrite || busy || value.state === 'revoked'} onClick={() => void revoke(value)}>Revoke</Button></td></tr>)}</tbody></table></div>
      <div className="grid gap-2 sm:grid-cols-2"><FormField label="Source" htmlFor="member-access-source"><Select id="member-access-source" value={source} onChange={(event) => setSource(event.target.value as typeof source)} disabled={!canWrite || busy} options={[{ value: 'complimentary', label: 'Complimentary' }, { value: 'manual', label: 'Manual' }, { value: 'paid', label: 'Paid (verified digest)' }]}/></FormField><FormField label="Access" htmlFor="member-access-kind"><Select id="member-access-kind" value={accessKind} onChange={(event) => setAccessKind(event.target.value as typeof accessKind)} disabled={!canWrite || busy} options={[{ value: 'read', label: 'Read' }, { value: 'premium', label: 'Premium' }]}/></FormField></div>
      <div className="grid gap-2 sm:grid-cols-2"><FormField label="Resource kind" htmlFor="member-resource-kind"><Select id="member-resource-kind" value={resourceKind} onChange={(event) => setResourceKind(event.target.value as typeof resourceKind)} disabled={!canWrite || busy} options={[{ value: 'publication', label: 'Publication' }, { value: 'post', label: 'Post' }, { value: 'tag', label: 'Tag' }]}/></FormField><FormField label="Resource ID" htmlFor="member-resource-id"><Input id="member-resource-id" value={resourceId} onChange={(event) => setResourceId(event.target.value)} disabled={!canWrite || busy}/></FormField></div>
      <div className="grid gap-2 sm:grid-cols-2"><FormField label="Expires at" htmlFor="member-access-expiry"><Input id="member-access-expiry" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={!canWrite || busy}/></FormField><FormField label="Grace ends at" htmlFor="member-access-grace"><Input id="member-access-grace" type="datetime-local" value={graceEndsAt} onChange={(event) => setGraceEndsAt(event.target.value)} disabled={!canWrite || busy}/></FormField></div>
      {source === 'paid' ? <FormField label="Verified payment reference SHA-256" htmlFor="member-payment-digest"><Input id="member-payment-digest" className="font-mono" value={paymentDigest} minLength={64} maxLength={64} onChange={(event) => setPaymentDigest(event.target.value)} disabled={!canWrite || busy}/></FormField> : null}
      <Button variant="secondary" size="sm" type="button" disabled={!canWrite || busy || !selectedAccount || !resourceId || (source === 'paid' && paymentDigest.length !== 64)} onClick={() => void grant()}>Grant access</Button>
    </section>

    <section className="grid min-w-0 gap-3 p-6 rounded-md border border-border [&_header]:grid [&_header]:gap-1 [&_h2]:m-0 [&_p]:m-0 [&_header_p]:text-muted-foreground [&_fieldset]:m-0 [&_fieldset]:grid [&_fieldset]:gap-2 [&_fieldset]:rounded-md [&_fieldset]:border [&_fieldset]:border-border [&_fieldset]:p-3 [&_legend]:px-1 [&_legend]:font-semibold" aria-labelledby="member-privacy-title">
      <header><h2 id="member-privacy-title">Export and deletion</h2><p>Exports are rate-limited. Deletion completion atomically revokes sessions and erases profile identifiers.</p></header>
      <Button variant="secondary" size="sm" type="button" disabled={busy || !selectedAccount} onClick={() => void exportAccount()}>Export member data</Button>
      <FormField label="Deletion reason" htmlFor="member-deletion-reason"><Textarea id="member-deletion-reason" value={deletionReason} onChange={(event) => setDeletionReason(event.target.value)} disabled={!canWrite || busy}/></FormField>
      <Button variant="secondary" size="sm" type="button" disabled={!canWrite || busy || !selectedAccount || selectedAccount.state === 'deletion-pending'} onClick={() => void requestDeletion()}>Request account deletion</Button>
      {privacyRequest ? <p className="text-muted-foreground">Request {privacyRequest.requestId} · {privacyRequest.state}</p> : null}
    </section>
    {message ? <p className="m-0 rounded-md border border-border bg-muted p-3 sm:col-span-full" role="status" aria-live="polite">{message}</p> : null}
  </div>
}
