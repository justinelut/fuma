'use client'

import { useCallback, useEffect, useState } from 'react'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const MarketplaceArtifactSchema = Type.Object({
  submissionId: Type.String({ minLength: 1, maxLength: 255 }),
  decisionId: Type.String({ minLength: 1, maxLength: 255 }),
  signatureKeyId: Type.String({ minLength: 1, maxLength: 255 }),
  reviewState: Type.Literal('signed-current'),
  artifactId: Type.String({ minLength: 1, maxLength: 255 }),
  kind: Type.Union([Type.Literal('plugin'), Type.Literal('component-pack')]),
  packageId: Type.String({ minLength: 1, maxLength: 255 }),
  exactVersion: Type.String({ minLength: 1, maxLength: 64 }),
  contentHashSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  permissions: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 128, uniqueItems: true }),
  provenanceHashSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  licenseSpdx: Type.String({ minLength: 1, maxLength: 100 }),
  accessibilityStandard: Type.String({ minLength: 1, maxLength: 64 }),
  minimumRuntimeVersion: Type.String({ minLength: 1, maxLength: 64 }),
  reviewedAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
type MarketplaceArtifact = Static<typeof MarketplaceArtifactSchema>

type Scope = Readonly<{ organizationId: string; workspaceId: string; siteId: string }>
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
function validArtifact(value: unknown): value is MarketplaceArtifact {
  return Value.Check(MarketplaceArtifactSchema, value)
}
function scopedPath(scope: Scope, suffix: string): string {
  if (![scope.organizationId, scope.workspaceId, scope.siteId].every((value) => idPattern.test(value))) throw new Error('Marketplace site scope is invalid.')
  return `/api/fuma/organizations/${encodeURIComponent(scope.organizationId)}/workspaces/${encodeURIComponent(scope.workspaceId)}/sites/${encodeURIComponent(scope.siteId)}${suffix}`
}

export function MarketplaceCatalog({ scope }: Readonly<{ scope: Scope }>) {
  const [artifacts, setArtifacts] = useState<readonly MarketplaceArtifact[]>([])
  const [grants, setGrants] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [message, setMessage] = useState('Loading reviewed releases…')
  const [installing, setInstalling] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(scopedPath(scope, '/marketplace/artifacts'), { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
      const body = await response.json() as unknown
      if (!response.ok || !body || typeof body !== 'object' || !Array.isArray((body as { artifacts?: unknown }).artifacts) || !(body as { artifacts: unknown[] }).artifacts.every(validArtifact)) throw new Error('Reviewed marketplace response is unavailable.')
      const next = (body as { artifacts: MarketplaceArtifact[] }).artifacts
      setArtifacts(next)
      setState('ready')
      setMessage(next.length === 0 ? 'No currently signed, unrevoked releases are available.' : `${next.length} current signed release${next.length === 1 ? '' : 's'}.`)
    } catch {
      setArtifacts([])
      setState('unavailable')
      setMessage('Review or signature authority is unavailable. Installation is disabled.')
    }
  }, [scope])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  function toggle(artifact: MarketplaceArtifact, permission: string): void {
    const current = grants[artifact.artifactId] ?? []
    setGrants({ ...grants, [artifact.artifactId]: current.includes(permission) ? current.filter((value) => value !== permission) : [...current, permission] })
  }
  async function install(artifact: MarketplaceArtifact): Promise<void> {
    const grantedPermissions = grants[artifact.artifactId] ?? []
    if (grantedPermissions.length !== artifact.permissions.length || artifact.permissions.some((permission) => !grantedPermissions.includes(permission))) return
    setInstalling(artifact.artifactId)
    setMessage(`Installing ${artifact.packageId}…`)
    try {
      const response = await fetch(scopedPath(scope, `/marketplace/artifacts/${encodeURIComponent(artifact.artifactId)}/install`), {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submissionId: artifact.submissionId, installationId: `marketplace-${crypto.randomUUID()}`, grantedPermissions }),
      })
      if (!response.ok) throw new Error('install-denied')
      setMessage(`${artifact.packageId} ${artifact.exactVersion} installed from its reviewed immutable release.`)
    } catch {
      setMessage('Installation was denied because review, scope, signature, or grants could not be verified.')
    } finally { setInstalling(null) }
  }

  return <section aria-busy={state === 'loading'}>
    <div className="mb-4 flex items-center justify-between gap-4"><p className="text-sm text-muted-foreground" role="status">{message}</p><Button variant="outline" onClick={() => { setState('loading'); void load() }} disabled={state === 'loading'}>Refresh review state</Button></div>
    <div className="grid gap-4">
      {artifacts.map((artifact) => {
        const accepted = grants[artifact.artifactId] ?? []
        const complete = artifact.permissions.length === accepted.length && artifact.permissions.every((permission) => accepted.includes(permission))
        return <Card key={artifact.artifactId}><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>{artifact.packageId} <span className="font-normal text-muted-foreground">{artifact.exactVersion}</span></CardTitle><span className="rounded-full border px-2 py-1 text-xs">Signed review current</span></div><CardDescription>{artifact.kind === 'plugin' ? 'Sandboxed plugin release' : 'Declarative component-pack release'} · reviewed {new Date(artifact.reviewedAt).toLocaleDateString()}</CardDescription></CardHeader><CardContent className="space-y-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="font-medium">Signing key</dt><dd className="break-all text-muted-foreground">{artifact.signatureKeyId}</dd></div><div><dt className="font-medium">License</dt><dd className="text-muted-foreground">{artifact.licenseSpdx}</dd></div><div><dt className="font-medium">Accessibility</dt><dd className="text-muted-foreground">{artifact.accessibilityStandard}</dd></div><div><dt className="font-medium">Runtime compatibility</dt><dd className="text-muted-foreground">≥ {artifact.minimumRuntimeVersion}</dd></div><div className="sm:col-span-2"><dt className="font-medium">Provenance SHA-256</dt><dd className="break-all font-mono text-xs text-muted-foreground">{artifact.provenanceHashSha256}</dd></div></dl>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Explicit permission grant</legend>{artifact.permissions.length === 0 ? <p className="text-sm text-muted-foreground">This release requests no permissions.</p> : artifact.permissions.map((permission) => <label className="flex gap-2 text-sm" key={permission}><input type="checkbox" checked={accepted.includes(permission)} onChange={() => toggle(artifact, permission)} />{permission}</label>)}</fieldset>
          <Button disabled={state !== 'ready' || !complete || installing !== null} onClick={() => void install(artifact)}>{installing === artifact.artifactId ? 'Installing…' : 'Grant and install immutable release'}</Button>
        </CardContent></Card>
      })}
    </div>
  </section>
}
