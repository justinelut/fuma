import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'

const routes = [
  { path: '/experts?query=Nairobi', heading: 'Find skilled people through approved public work.', link: 'Amani Studio', detail: '/experts/amani-studio' },
  { path: '/showcase?query=Amani', heading: 'The work gets the room. The credit keeps its proof.', link: 'Amani Journal', detail: '/showcase/amani-journal' },
  { path: '/plugins?query=Forms', heading: 'Backend extensions, before they reach your workspace.', link: 'Reviewed Forms', detail: '/plugins/reviewed-forms' },
  { path: '/components?query=Hero', heading: 'Building pieces that hold together.', link: 'Reviewed Hero Pack', detail: '/components/reviewed-hero-pack' },
] as const

test('FUMA-WEB-011 discovery is PII-free, no-store, tombstoned and responsive on the approved host', async ({ page, request }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('static.cloudflareinsights.com/beacon.min.js')) {
      consoleErrors.push(message.text())
    }
  })

  const availableDetails = new Set<string>()
  for (const route of routes) {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto(`${PUBLIC}${route.path}`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible()
    const recordLink = page.getByRole('link', { name: route.link })
    if (await recordLink.count()) {
      await expect(recordLink).toHaveAttribute('href', route.detail)
      availableDetails.add(route.detail)
    } else {
      await expect(page.getByRole('status')).toContainText(/unavailable/i)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const html = await page.content()
    expect(html).not.toMatch(/member@example|recipientEmail|organizationId|workspaceId|siteId|ownerKey|paymentState|transferId|internalId/)
    expect((await page.context().cookies()).filter((cookie) => cookie.domain.endsWith('trimly.co.ke') || cookie.domain.endsWith('blyss.co.ke'))).toEqual([])
  }

  if (availableDetails.has('/plugins/reviewed-forms')) {
    await page.goto(`${PUBLIC}/plugins/reviewed-forms`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Reviewed Forms' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Permission labels' })).toBeVisible()
    await expect(page.getByText('Store submissions')).toBeVisible()
  }

  if (availableDetails.has('/components/reviewed-hero-pack')) {
    await page.goto(`${PUBLIC}/components/reviewed-hero-pack`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Reviewed Hero Pack' })).toBeVisible()
    await expect(page.getByText('Component pack', { exact: true })).toBeVisible()
    await expect(page.getByText(/cannot install, execute or expose private component source/i)).toBeVisible()
  }

  for (const resource of ['experts', 'showcases', 'plugins', 'components']) {
    const response = await request.get(`${PUBLIC}/api/public/v1/${resource}?limit=1`)
    expect([200, 503]).toContain(response.status())
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(response.headers()['set-cookie']).toBeUndefined()
    expect(await response.text()).not.toMatch(/recipientEmail|organizationId|workspaceId|siteId|ownerKey|memberId|paymentState|transferId|internalId/)
  }

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])

  const tombstone = await page.goto(`${PUBLIC}/experts/withdrawn-expert`, { waitUntil: 'networkidle' })
  expect(tombstone?.status()).toBe(404)
  const robotDirectives = await page.locator('meta[name="robots"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''))
  expect(robotDirectives.length).toBeGreaterThan(0)
  expect(robotDirectives.every((value) => value.includes('noindex'))).toBe(true)
  await expect(page.getByText('Amani Studio')).toHaveCount(0)

  expect(pageErrors).toEqual([])
})
