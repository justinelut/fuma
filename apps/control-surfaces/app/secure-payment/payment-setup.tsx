'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Timestamp = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$' })
const Purpose = Type.Union([Type.Literal('deposit'), Type.Literal('donation'), Type.Literal('checkout')])
const Permissions = Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 4, maxItems: 4, uniqueItems: true })
const ProposalSchema = Type.Object({
  proposalId: Id,
  review: Type.Object({
    submissionId: Id, decisionId: Id, signatureKeyId: Id, artifactId: Id,
    packageId: Type.Literal('fuma.customer-payments'), exactVersion: Type.Literal('1.0.0'),
    contentHashSha256: Hash, permissions: Permissions,
  }, { additionalProperties: false }),
  purpose: Purpose,
  blockId: Type.Union([
    Type.Literal('fuma.customer-payments.deposit'),
    Type.Literal('fuma.customer-payments.donation'),
    Type.Literal('fuma.customer-payments.checkout'),
  ]),
  amountAuthority: Type.Literal('customer-or-merchant-explicit-input'),
  feeDisclosure: Type.Object({
    version: Type.Literal('fuma-customer-payments-fees-v1'), currency: Type.Literal('KES'),
    fumaPlatformFeeMinor: Type.Literal(0),
    providerFeeNotice: Type.String({ minLength: 1, maxLength: 500 }),
    customerChargeNotice: Type.String({ minLength: 1, maxLength: 500 }),
    previewAmountMinor: Type.Literal(100),
  }, { additionalProperties: false }),
  state: Type.Union([Type.Literal('proposed'), Type.Literal('confirmed'), Type.Literal('credential-stored'), Type.Literal('tested')]),
  installationId: Type.Union([Id, Type.Null()]), credentialStored: Type.Boolean(),
  preview: Type.Union([Type.Object({
    state: Type.Literal('settled'), purpose: Purpose, amountMinor: Type.Literal(100),
    currency: Type.Literal('KES'), receiptFingerprintSha256: Hash,
  }, { additionalProperties: false }), Type.Null()]),
  expiresAt: Timestamp,
  confirmationPath: Type.Literal('/secure-payment'),
}, { additionalProperties: false })
type Proposal = Static<typeof ProposalSchema>
type Scope = Readonly<{ organizationId: string; workspaceId: string; siteId: string }>
const exactPermissions = Object.freeze(['cms.routes', 'modules.register', 'payments.customer.create', 'payments.customer.refund'])
const segment = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

function proposalValid(value: unknown): value is Proposal {
  if (!Value.Check(ProposalSchema, value)) return false
  const permissions = value.review.permissions
  return permissions.length === exactPermissions.length && exactPermissions.every((permission) => permissions.includes(permission))
}
function scopedBase(scope: Scope, proposalId: string): string {
  if (![scope.organizationId, scope.workspaceId, scope.siteId, proposalId].every((value) => segment.test(value))) {
    throw new Error('Secure payment setup scope is invalid.')
  }
  return `/api/fuma/organizations/${encodeURIComponent(scope.organizationId)}/workspaces/${encodeURIComponent(scope.workspaceId)}/sites/${encodeURIComponent(scope.siteId)}/ai/payment-setup/proposals/${encodeURIComponent(proposalId)}`
}
function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}
async function hash(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
async function jsonRequest(url: string, init?: RequestInit): Promise<Proposal> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
  const value = await response.json().catch(() => null) as unknown
  if (!response.ok || !proposalValid(value)) throw new Error('Secure payment setup authority denied the request.')
  return value
}

export function SecurePaymentSetup({ scope, proposalId }: Readonly<{ scope: Scope; proposalId: string }>) {
  const base = useMemo(() => scopedBase(scope, proposalId), [proposalId, scope])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [acceptedPermissions, setAcceptedPermissions] = useState<readonly string[]>([])
  const [acceptedArtifact, setAcceptedArtifact] = useState(false)
  const [acceptedFees, setAcceptedFees] = useState(false)
  const [acceptedBlock, setAcceptedBlock] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'review' | 'confirming' | 'credentials' | 'saving' | 'complete' | 'unavailable'>('loading')
  const [message, setMessage] = useState('Loading the current signed payment proposal…')

  const load = useCallback(async () => {
    try {
      const value = await jsonRequest(base)
      setProposal(value)
      setPhase(value.state === 'proposed' ? 'review' : value.credentialStored ? (value.state === 'tested' ? 'complete' : 'credentials') : 'credentials')
      setMessage(value.state === 'proposed' ? 'Review every immutable detail before confirming.' : value.state === 'tested' ? 'Test payment settled through the shared payment ledger.' : 'Confirmation complete. Enter credentials directly below.')
    } catch {
      setPhase('unavailable')
      setMessage('The proposal, scope, review, or signature is unavailable. No installation or credential write occurred.')
    }
  }, [base])
  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])

  function togglePermission(permission: string): void {
    setAcceptedPermissions((current) => current.includes(permission) ? current.filter((value) => value !== permission) : [...current, permission])
  }
  const exactAcceptance = Boolean(proposal && acceptedArtifact && acceptedFees && acceptedBlock
    && proposal.review.permissions.length === acceptedPermissions.length
    && proposal.review.permissions.every((permission) => acceptedPermissions.includes(permission)))

  async function confirm(): Promise<void> {
    if (!proposal || !exactAcceptance || phase !== 'review') return
    setPhase('confirming')
    setMessage('Registering this browser’s one-time challenge and rechecking the current review…')
    try {
      const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)))
      const challengeId = crypto.randomUUID()
      await jsonRequest(`${base}/challenge`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId, nonceHashSha256: await hash(nonce) }),
      })
      const confirmed = await jsonRequest(`${base}/confirm`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmationId: crypto.randomUUID(), challengeId, confirmationNonce: nonce,
          acceptedArtifactId: proposal.review.artifactId,
          acceptedContentHashSha256: proposal.review.contentHashSha256,
          acceptedExactVersion: proposal.review.exactVersion,
          acceptedPermissions: [...proposal.review.permissions],
          acceptedFeeDisclosureVersion: proposal.feeDisclosure.version,
          acceptedPurpose: proposal.purpose,
          acceptedBlockId: proposal.blockId,
        }),
      })
      setProposal(confirmed)
      setPhase('credentials')
      setMessage('Exact reviewed release installed. The one-time credential handoff is ready and invisible to AI.')
    } catch {
      setPhase('review')
      setMessage('Confirmation was denied. Refresh to recheck review, session freshness, scope, and revocation state.')
    }
  }

  async function saveCredential(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!proposal || phase !== 'credentials') return
    const form = event.currentTarget
    const data = new FormData(form)
    const publicKey = data.get('publicKey')
    const secretKey = data.get('secretKey')
    const testMode = data.get('testMode') === 'on'
    form.reset()
    if (typeof publicKey !== 'string' || typeof secretKey !== 'string') return
    setPhase('saving')
    setMessage(testMode ? 'Encrypting credentials and settling the fixed KES 1.00 test preview…' : 'Encrypting credentials through the one-time handoff…')
    try {
      const stored = await jsonRequest(`${base}/credentials`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey, secretKey, testMode }),
      })
      setProposal(stored)
      setPhase(stored.state === 'tested' ? 'complete' : 'complete')
      setMessage(stored.state === 'tested' ? 'Test payment settled. Only its receipt fingerprint is retained here.' : 'Credentials encrypted and stored. No customer payment was created.')
    } catch {
      setPhase('unavailable')
      setMessage('Credential storage or test settlement failed closed. The one-time handoff cannot be replayed; start a new proposal.')
    }
  }

  if (!proposal) return <Card aria-busy={phase === 'loading'}><CardHeader><CardTitle>Payment setup unavailable</CardTitle><CardDescription>{message}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => void load()} disabled={phase === 'loading'}>Retry current review</Button></CardContent></Card>

  return <div className="grid gap-5">
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Reviewed payment proposal</CardTitle><span className="rounded-full border px-2 py-1 text-xs">{proposal.state}</span></div><CardDescription>AI selected only a fixed purpose. Package, release, grants, block, fees, and preview amount come from reviewed server policy.</CardDescription></CardHeader><CardContent className="space-y-5">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-medium">Signed package</dt><dd className="text-muted-foreground">{proposal.review.packageId}@{proposal.review.exactVersion}</dd></div>
        <div><dt className="font-medium">Signing key</dt><dd className="break-all text-muted-foreground">{proposal.review.signatureKeyId}</dd></div>
        <div><dt className="font-medium">Purpose &amp; block</dt><dd className="text-muted-foreground">{proposal.purpose} · {proposal.blockId}</dd></div>
        <div><dt className="font-medium">Fuma setup fee</dt><dd className="text-muted-foreground">KES {(proposal.feeDisclosure.fumaPlatformFeeMinor / 100).toFixed(2)}</dd></div>
        <div className="sm:col-span-2"><dt className="font-medium">Immutable artifact SHA-256</dt><dd className="break-all font-mono text-xs text-muted-foreground">{proposal.review.contentHashSha256}</dd></div>
      </dl>
      <div className="rounded-md border p-3 text-sm"><p>{proposal.feeDisclosure.providerFeeNotice}</p><p className="mt-2">{proposal.feeDisclosure.customerChargeNotice}</p><p className="mt-2 font-medium">Test preview policy: KES {(proposal.feeDisclosure.previewAmountMinor / 100).toFixed(2)}, fixed by the server.</p></div>
      {proposal.state === 'proposed' && <fieldset className="space-y-3"><legend className="font-medium">Explicit acceptance</legend>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={acceptedArtifact} onChange={(event) => setAcceptedArtifact(event.target.checked)} />Install only this artifact, version, hash, purpose, and reviewed block.</label>
        {proposal.review.permissions.map((permission) => <label className="flex gap-2 text-sm" key={permission}><input type="checkbox" checked={acceptedPermissions.includes(permission)} onChange={() => togglePermission(permission)} />Grant <code>{permission}</code></label>)}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={acceptedFees} onChange={(event) => setAcceptedFees(event.target.checked)} />I reviewed the provider-fee and no-customer-charge disclosures.</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={acceptedBlock} onChange={(event) => setAcceptedBlock(event.target.checked)} />I confirm the {proposal.purpose} block; AI cannot choose a customer charge amount.</label>
        <Button onClick={() => void confirm()} disabled={!exactAcceptance || phase !== 'review'}>{phase === 'confirming' ? 'Rechecking and installing…' : 'Confirm exact reviewed setup'}</Button>
      </fieldset>}
      <p className="text-sm text-muted-foreground" role="status">{message}</p>
    </CardContent></Card>

    {(phase === 'credentials' || phase === 'saving') && <Card><CardHeader><CardTitle>Enter Paystack credentials directly</CardTitle><CardDescription>These fields post to the encrypted FUMA-058 credential boundary through a one-time HttpOnly cookie. They are never returned to AI, proposal storage, logs, audit payloads, or plugin workers.</CardDescription></CardHeader><CardContent><form className="space-y-4" autoComplete="off" onSubmit={(event) => void saveCredential(event)}>
      <div><label className="mb-1 block text-sm font-medium" htmlFor="public-key">Public key</label><input className="h-10 w-full rounded-md border bg-background px-3" id="public-key" name="publicKey" required minLength={8} maxLength={256} pattern="pk_(test|live)_([A-Za-z0-9_]|-)+" spellCheck={false} disabled={phase === 'saving'} /></div>
      <div><label className="mb-1 block text-sm font-medium" htmlFor="secret-key">Secret key</label><input className="h-10 w-full rounded-md border bg-background px-3" id="secret-key" name="secretKey" type="password" required minLength={16} maxLength={512} pattern="sk_(test|live)_([A-Za-z0-9_]|-)+" spellCheck={false} disabled={phase === 'saving'} /></div>
      <label className="flex gap-2 text-sm"><input name="testMode" type="checkbox" defaultChecked disabled={phase === 'saving'} />Use test keys and settle the fixed KES 1.00 preview</label>
      <Button type="submit" disabled={phase === 'saving'}>{phase === 'saving' ? 'Storing outside AI…' : 'Store through one-time secure handoff'}</Button>
    </form></CardContent></Card>}

    {proposal.preview && <Card><CardHeader><CardTitle>Test payment settled</CardTitle><CardDescription>Shared FUMA-069 payment authority · no live customer charge</CardDescription></CardHeader><CardContent><dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="font-medium">Purpose</dt><dd>{proposal.preview.purpose}</dd></div><div><dt className="font-medium">Amount</dt><dd>KES {(proposal.preview.amountMinor / 100).toFixed(2)}</dd></div><div className="sm:col-span-2"><dt className="font-medium">Receipt fingerprint</dt><dd className="break-all font-mono text-xs text-muted-foreground">{proposal.preview.receiptFingerprintSha256}</dd></div></dl></CardContent></Card>}
  </div>
}
