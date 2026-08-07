import { useState } from 'react'
import { buildScopedAdminUrl, type AccessibleContextCatalog } from '@core/fuma'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'

const OrganizationResponseSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  slug: Type.String({ minLength: 1 }),
}, { additionalProperties: true })

const ProvisioningResponseSchema = Type.Object({
  result: Type.Object({
    organizationId: Type.String({ minLength: 1 }),
    workspaceId: Type.String({ minLength: 1 }),
    siteId: Type.String({ minLength: 1 }),
    siteSlug: Type.String({ minLength: 1 }),
    host: Type.String({ minLength: 1 }),
    profileId: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
    created: Type.Object({
      workspace: Type.Boolean(),
      site: Type.Boolean(),
      ownerKey: Type.Boolean(),
      freeHost: Type.Boolean(),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

type ProvisioningResponse = Static<typeof ProvisioningResponseSchema>

function slug(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function jsonRequest<T>(fetchImpl: typeof fetch, path: string, body: unknown, schema: Parameters<typeof safeParseValue>[0]): Promise<T> {
  const response = await fetchImpl(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  let value: unknown = null
  try { value = await response.json() } catch { /* bounded error below */ }
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'
      ? value.message
      : value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : 'The request could not be completed.'
    throw new Error(message)
  }
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('The server returned an invalid onboarding response.')
  return parsed.value as T
}

export function HostedSiteOnboarding({
  catalog,
  fetchImpl = globalThis.fetch.bind(globalThis),
  navigate = (target: string) => globalThis.location.assign(target),
}: Readonly<{
  catalog: AccessibleContextCatalog
  fetchImpl?: typeof fetch
  navigate?: (target: string) => void
}>) {
  const activeOrganizations = catalog.organizations.filter((value) => value.status === 'active')
  const [organizationId, setOrganizationId] = useState(activeOrganizations[0]?.id ?? '')
  const [organizationName, setOrganizationName] = useState('')
  const [siteName, setSiteName] = useState('')
  const [siteSlug, setSiteSlug] = useState('')
  const [profileId, setProfileId] = useState<'website' | 'publication'>('website')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const needsOrganization = activeOrganizations.length === 0
  const [step, setStep] = useState<'organization' | 'site'>(needsOrganization ? 'organization' : 'site')
  const organizationReady = !needsOrganization || slug(organizationName).length > 0
  const canContinue = siteName.trim().length > 0
    && slug(siteSlug || siteName).length > 0
    && (!needsOrganization || slug(organizationName).length > 0)

  async function create(): Promise<void> {
    if (!canContinue || busy) return
    setBusy(true)
    setError('')
    try {
      let ownerOrganizationId = organizationId
      if (needsOrganization) {
        const organizationSlug = slug(organizationName)
        await jsonRequest(fetchImpl, '/api/auth/organization/check-slug', { slug: organizationSlug }, Type.Object({ status: Type.Boolean() }, { additionalProperties: true }))
        const organization = await jsonRequest<Static<typeof OrganizationResponseSchema>>(
          fetchImpl,
          '/api/auth/organization/create',
          { name: organizationName.trim(), slug: organizationSlug },
          OrganizationResponseSchema,
        )
        ownerOrganizationId = organization.id
      }
      const provisioned = await jsonRequest<ProvisioningResponse>(
        fetchImpl,
        '/api/fuma/onboarding/site',
        {
          organizationId: ownerOrganizationId,
          siteName: siteName.trim(),
          siteSlug: slug(siteSlug || siteName),
          profileId,
        },
        ProvisioningResponseSchema,
      )
      const selection = {
        organizationId: provisioned.result.organizationId,
        workspaceId: provisioned.result.workspaceId,
        siteId: provisioned.result.siteId,
      }
      navigate(buildScopedAdminUrl(selection, '/admin/pages'))
    } catch (reason) {
      setError(getErrorMessage(reason, 'Site creation failed.'))
      setBusy(false)
    }
  }

  return (
    <section className="grid w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card text-foreground md:grid-cols-[minmax(16rem,0.85fr)_minmax(20rem,1.15fr)]" aria-labelledby="fuma-onboarding-title">
      <div className="border-b border-border p-6 text-foreground sm:p-10 md:border-b-0 md:border-r [&_h2]:max-w-[18ch] [&_h2]:text-3xl [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:text-foreground">
        <p className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">Your first Fuma site</p>
        <h2 id="fuma-onboarding-title">Give the editor somewhere real to work.</h2>
        <p>Name the organization that owns the work, then create its first site. The default workspace is created for you.</p>
        <ol className="m-0 mt-12 grid list-none p-0 [&_li]:grid [&_li]:grid-cols-[2rem_1fr] [&_li]:gap-x-3 [&_li]:border-t [&_li]:border-border [&_li]:py-4 [&_li]:text-muted-foreground [&_li>span]:row-span-2 [&_li>span]:font-mono [&_li>span]:text-xs [&_strong]:text-sm [&_strong]:text-muted-foreground" aria-label="Site setup progress">
          <li
            data-state={needsOrganization ? (step === 'organization' ? 'current' : 'complete') : 'complete'}
            aria-current={step === 'organization' ? 'step' : undefined}
          >
            <span>1</span><strong>Organization</strong><small>People and ownership</small>
          </li>
          <li data-state="automatic">
            <span>2</span><strong>Workspace</strong><small>Created automatically as your default</small>
          </li>
          <li data-state={step === 'site' ? 'current' : 'upcoming'} aria-current={step === 'site' ? 'step' : undefined}>
            <span>3</span><strong>Site</strong><small>Website or publication</small>
          </li>
        </ol>
      </div>
      <div className="grid content-center gap-6 p-6 sm:p-10 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-transparent [&_input]:p-3 [&_select]:min-h-11 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:p-3 [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold [&_label]:text-muted-foreground [&_fieldset]:m-0 [&_fieldset]:grid [&_fieldset]:grid-cols-2 [&_fieldset]:gap-3 [&_fieldset]:border-0 [&_fieldset]:p-0 [&_legend]:mb-1 [&_legend]:text-sm [&_legend]:font-semibold [&_legend]:text-muted-foreground">
        {step === 'organization' ? (
          <>
            <label>
              Organization name
              <input
                autoComplete="organization"
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Acme Studio"
                disabled={busy}
              />
            </label>
            <Button variant="default" disabled={!organizationReady || busy} onClick={() => setStep('site')}>
              Continue
            </Button>
          </>
        ) : (
          <>
            {needsOrganization ? (
              <p className="text-sm [&_span]:font-semibold [&_span]:text-muted-foreground"><span>Organization</span><strong>{organizationName.trim()}</strong></p>
            ) : activeOrganizations.length > 1 ? (
              <label>
                Organization
                <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} disabled={busy}>
                  {activeOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
                </select>
              </label>
            ) : (
              <p className="text-sm [&_span]:font-semibold [&_span]:text-muted-foreground"><span>Organization</span><strong>{activeOrganizations[0]?.name}</strong></p>
            )}
            <label>
              Site name
              <input value={siteName} onChange={(event) => setSiteName(event.target.value)} placeholder="Acme Studio" disabled={busy} />
            </label>
            <label>
              Site address
              <span className="font-mono">
                <input value={siteSlug} onChange={(event) => setSiteSlug(event.target.value)} placeholder={slug(siteName) || 'acme-studio'} disabled={busy} />
                <small>.trimly.co.ke</small>
              </span>
            </label>
            <fieldset disabled={busy}>
              <legend>What are you building?</legend>
              <label className={`grid min-w-0 gap-2 rounded-md border p-4 [&_strong]:text-sm [&_strong]:text-foreground ${profileId === 'website' ? 'border-muted-foreground bg-accent/40' : 'border-border'}`}>
                <input type="radio" name="profile" value="website" checked={profileId === 'website'} onChange={() => setProfileId('website')} />
                <strong>Website</strong><span>Pages, forms, data, media and visual design.</span>
              </label>
              <label className={`grid min-w-0 gap-2 rounded-md border p-4 [&_strong]:text-sm [&_strong]:text-foreground ${profileId === 'publication' ? 'border-muted-foreground bg-accent/40' : 'border-border'}`}>
                <input type="radio" name="profile" value="publication" checked={profileId === 'publication'} onChange={() => setProfileId('publication')} />
                <strong>Publication</strong><span>Editorial workflow, members and newsletters.</span>
              </label>
            </fieldset>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <div className="flex flex-wrap gap-3">
              {needsOrganization ? (
                <Button variant="secondary" disabled={busy} onClick={() => setStep('organization')}>Back</Button>
              ) : null}
              <Button variant="default" disabled={!canContinue || busy} onClick={() => void create()}>
                {busy ? 'Creating your site…' : 'Create site and open editor'}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
