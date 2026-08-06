/**
 * Site provisioning from the platform dashboard.
 *
 * The same endpoint first-site onboarding uses. Omitting a workspace name places
 * the new site in the organization's default workspace, which is what "another
 * site in the same workspace" means, and the profile choice decides which
 * dashboard the site gets.
 */
import { apiRequest } from '@core/http'
import { Type, type Static } from '@core/utils/typeboxHelpers'

export const SITE_PROVISIONING_PATH = '/api/fuma/onboarding/site'

export const SiteProfileChoiceSchema = Type.Union([
  Type.Literal('website'),
  Type.Literal('publication'),
])
export type SiteProfileChoice = Static<typeof SiteProfileChoiceSchema>

const ProvisionedSiteSchema = Type.Object({
  result: Type.Object({
    organizationId: Type.String({ minLength: 1 }),
    workspaceId: Type.String({ minLength: 1 }),
    siteId: Type.String({ minLength: 1 }),
    siteSlug: Type.String({ minLength: 1 }),
    host: Type.String({ minLength: 1 }),
    profileId: SiteProfileChoiceSchema,
    created: Type.Object({
      workspace: Type.Boolean(),
      site: Type.Boolean(),
      ownerKey: Type.Boolean(),
      freeHost: Type.Boolean(),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

export type ProvisionedSite = Static<typeof ProvisionedSiteSchema>['result']

/** Slug the server will accept, derived from the display name. */
export function siteSlug(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function provisionSite(input: Readonly<{
  organizationId: string
  siteName: string
  profileId: SiteProfileChoice
}>): Promise<ProvisionedSite> {
  const slug = siteSlug(input.siteName)
  const envelope = await apiRequest(SITE_PROVISIONING_PATH, {
    method: 'POST',
    schema: ProvisionedSiteSchema,
    body: {
      organizationId: input.organizationId,
      siteName: input.siteName.trim(),
      ...(slug ? { siteSlug: slug } : {}),
      profileId: input.profileId,
    },
    fallbackMessage: 'The site could not be created',
  })
  return envelope.result
}
