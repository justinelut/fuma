import { useState } from 'react'
import { buildScopedAdminUrl, type AccessibleContextCatalog } from '@core/fuma'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@ui/components/Button'
import styles from './HostedSiteOnboarding.module.css'

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
    <section className={styles.onboarding} aria-labelledby="fuma-onboarding-title">
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Your first Fuma site</p>
        <h2 id="fuma-onboarding-title">Give the editor somewhere real to work.</h2>
        <p>Create the organization boundary, its default workspace, and a live site authority in one guided step.</p>
        <ol className={styles.rail} aria-label="Site setup progress">
          <li><span>1</span><strong>Organization</strong><small>People and ownership</small></li>
          <li><span>2</span><strong>Workspace</strong><small>Created as your default</small></li>
          <li><span>3</span><strong>Site</strong><small>Website or publication</small></li>
        </ol>
      </div>
      <div className={styles.form}>
        {needsOrganization ? (
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
        ) : activeOrganizations.length > 1 ? (
          <label>
            Organization
            <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} disabled={busy}>
              {activeOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
            </select>
          </label>
        ) : (
          <p className={styles.selectedOrganization}><span>Organization</span><strong>{activeOrganizations[0]?.name}</strong></p>
        )}
        <label>
          Site name
          <input value={siteName} onChange={(event) => setSiteName(event.target.value)} placeholder="Acme Studio" disabled={busy} />
        </label>
        <label>
          Site address
          <span className={styles.slugInput}>
            <input value={siteSlug} onChange={(event) => setSiteSlug(event.target.value)} placeholder={slug(siteName) || 'acme-studio'} disabled={busy} />
            <small>.trimly.co.ke</small>
          </span>
        </label>
        <fieldset disabled={busy}>
          <legend>What are you building?</legend>
          <label className={profileId === 'website' ? styles.profileActive : styles.profile}>
            <input type="radio" name="profile" value="website" checked={profileId === 'website'} onChange={() => setProfileId('website')} />
            <strong>Website</strong><span>Pages, forms, data, media and visual design.</span>
          </label>
          <label className={profileId === 'publication' ? styles.profileActive : styles.profile}>
            <input type="radio" name="profile" value="publication" checked={profileId === 'publication'} onChange={() => setProfileId('publication')} />
            <strong>Publication</strong><span>Editorial workflow, members and newsletters.</span>
          </label>
        </fieldset>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <Button variant="primary" disabled={!canContinue || busy} onClick={() => void create()}>
          {busy ? 'Creating your site…' : 'Create site and open editor'}
        </Button>
      </div>
    </section>
  )
}
