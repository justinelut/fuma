import { expect, test } from '@playwright/test'
import type { ExpertManagementWire } from '@admin/fuma/expertDiscovery/client'

type ExpertProfile = NonNullable<ExpertManagementWire['profile']>

const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL
if (!ADMIN_BASE_URL) throw new Error('FUMA-073 browser acceptance requires E2E_ADMIN_BASE_URL.')

const PROFILE: ExpertProfile = {
  expertId: 'expert-browser',
  organizationId: 'organization-browser',
  sourceScope: {
    platformId: 'platform-browser',
    organizationId: 'organization-browser',
    workspaceId: 'workspace-browser',
    siteId: 'site-browser',
    ownerKey: 'owner-browser',
    ownerGeneration: 2,
  },
  supportedProfiles: ['website', 'publication'],
  public: {
    id: 'expert-public-browser',
    slug: 'nairobi-builder',
    publicName: 'Nairobi Builder',
    summary: 'Accessible Kenyan websites and publications.',
    expertType: 'developer',
    location: 'Nairobi',
    skills: ['fuma', 'accessibility'],
    services: ['design', 'development'],
    showcaseIds: ['showcase-browser'],
    mediatedInquiryAvailable: true,
    imageUrl: null,
    approvedAt: '2026-07-31T08:00:00.000Z',
  },
  availability: 'available',
  approvedReleaseId: 'release-browser',
  optedIn: true,
  consentVersion: 2,
  publicRevision: 2,
  createdAt: '2026-07-31T08:00:00.000Z',
  updatedAt: '2026-07-31T08:00:00.000Z',
}

const INTEGRATION = {
  ownerTicket: 'FUMA-073',
  mounted: true,
  schemaAuthority: '000037_operations_experts_transfer',
} as const

const json = (result: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ result }),
})

test.use({
  baseURL: ADMIN_BASE_URL,
  storageState: { cookies: [], origins: [] },
})

test('FUMA-073 manages opt-in discovery through the approved Studio host', async ({ page }) => {
  const browserErrors: string[] = []
  const requestUrls: string[] = []
  const requestBodies: unknown[] = []
  let profile: ExpertProfile = { ...PROFILE }
  let inquiryCount = 2
  const pluginLinks: Array<{
    expertId: string
    pluginId: string
    publisherOrganizationId: string
    verificationHashSha256: string
    verifiedAt: string
    revokedAt: null
  }> = []

  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })

  await page.route('**/api/fuma/organizations/**/experts/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    requestUrls.push(url.href)
    const path = url.pathname

    if (request.method() === 'GET' && path.endsWith('/expert-browser/management')) {
      await route.fulfill(json({ profile, pluginLinks, inquiryCount, integration: INTEGRATION }))
      return
    }

    const body: unknown = request.postDataJSON()
    requestBodies.push(body)

    if (request.method() === 'POST' && path.endsWith('/visibility')) {
      const command = body as { optedIn?: unknown }
      profile = {
        ...profile,
        optedIn: command.optedIn === true,
        publicRevision: profile.publicRevision + 1,
        updatedAt: '2026-07-31T08:01:00.000Z',
      }
      await route.fulfill(json(profile))
      return
    }

    if (request.method() === 'POST' && path.endsWith('/inquiries')) {
      const command = body as { inquiryId: string; expertId: string; message: string }
      inquiryCount += 1
      await route.fulfill(json({
        inquiryId: command.inquiryId,
        expertId: command.expertId,
        sourceProfile: 'website',
        state: 'queued',
        messageBytes: new TextEncoder().encode(command.message).byteLength,
        encryptedObjectKey: `experts/inquiries/${command.inquiryId}.bin`,
        consentVersion: profile.consentVersion,
        createdAt: '2026-07-31T08:02:00.000Z',
        expiresAt: '2026-08-30T08:02:00.000Z',
      }))
      return
    }

    if (request.method() === 'POST' && path.endsWith('/plugins')) {
      const command = body as { expertId: string; pluginId: string }
      const link = {
        expertId: command.expertId,
        pluginId: command.pluginId,
        publisherOrganizationId: 'organization-browser',
        verificationHashSha256: 'a'.repeat(64),
        verifiedAt: '2026-07-31T08:03:00.000Z',
        revokedAt: null,
      }
      pluginLinks.push(link)
      await route.fulfill(json(link))
      return
    }

    if (request.method() === 'POST' && path.endsWith('/transfers')) {
      profile = {
        ...profile,
        organizationId: 'organization-destination',
        sourceScope: {
          ...profile.sourceScope,
          organizationId: 'organization-destination',
          workspaceId: 'workspace-destination',
          siteId: 'site-destination',
          ownerKey: 'owner-destination',
          ownerGeneration: 1,
        },
        optedIn: false,
        publicRevision: profile.publicRevision + 1,
        updatedAt: '2026-07-31T08:04:00.000Z',
      }
      await route.fulfill(json(profile))
      return
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected expert route.' }) })
  })

  await page.goto('/tests/e2e/fixtures/fuma-expert-discovery-harness.html')
  await expect(page).toHaveURL(/^https:\/\/5174\.blyss\.co\.ke\//)
  await expect(page.getByRole('heading', { name: 'Expert discovery' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('000037_operations_experts_transfer')

  await page.getByLabel('Expert ID').fill('expert-browser')
  await page.getByRole('button', { name: 'Load management record' }).click()
  await expect(page.getByText('Nairobi Builder')).toBeVisible()
  await expect(page.getByText('website + publication · available')).toBeVisible()

  await page.getByRole('button', { name: 'Opt out and hide' }).click()
  await expect(page.getByText('Expert opted out and hidden immediately.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Opt in to discovery' })).toBeVisible()

  await page.getByRole('button', { name: 'Opt in to discovery' }).click()
  await expect(page.getByText('Expert opted in for approved discovery.')).toBeVisible()

  await page.getByLabel('Message').fill('Please help us build an accessible Kenyan publication.')
  await page.getByRole('button', { name: 'Encrypt and queue inquiry' }).click()
  await expect(page.getByText('Inquiry encrypted and queued without exposing a recipient address.')).toBeVisible()
  await expect(page.getByText('3 queued or processed inquiries; bodies are never returned.')).toBeVisible()

  await page.getByLabel('Plugin ID').fill('fuma.reviewed.plugin')
  await page.getByRole('button', { name: 'Verify and link' }).click()
  await expect(page.getByText('Current reviewed plugin authority linked.')).toBeVisible()
  await expect(page.getByText('fuma.reviewed.plugin · organization-browser')).toBeVisible()

  await page.getByLabel('Transfer ID').fill('transfer-browser')
  await page.getByRole('button', { name: 'Revalidate and transfer' }).click()
  await expect(page.getByText('Expert transferred through current transfer authority and opted out pending destination review.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Opt in to discovery' })).toBeVisible()

  const expectedOrigin = new URL(ADMIN_BASE_URL).origin
  expect(requestUrls.length).toBeGreaterThanOrEqual(10)
  expect(requestUrls.every((value) => new URL(value).origin === expectedOrigin)).toBe(true)
  expect(requestUrls.every((value) => new URL(value).pathname.startsWith('/api/fuma/organizations/organization-browser/workspaces/workspace-browser/sites/site-browser/experts/'))).toBe(true)
  for (const body of requestBodies) {
    expect(body).not.toHaveProperty('sourceScope')
    expect(body).not.toHaveProperty('destinationScope')
    expect(body).not.toHaveProperty('actorId')
  }

  await page.setViewportSize({ width: 320, height: 900 })
  await expect(page.getByRole('heading', { name: 'Expert discovery' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(browserErrors).toEqual([])
})
