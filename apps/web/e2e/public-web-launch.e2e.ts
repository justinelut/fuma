import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'

test('Website and Publication journeys remain accessible at mobile and desktop widths', async ({ page }) => {
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(`${PUBLIC}/`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('whole life of a site')
    await page.getByRole('link', { name: /Explore the Website journey/ }).click()
    await expect(page).toHaveURL(`${PUBLIC}/website`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Build the site')
    await page.goto(`${PUBLIC}/publication`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('recurring ideas')
    await expect(page.getByRole('main')).toBeVisible()
  }
})

test('docs, redirects, feeds, robots and social cards are publicly crawlable', async ({ page, request }) => {
  await page.goto(`${PUBLIC}/docs/getting-started`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Getting started')
  const redirect = await request.get(`${PUBLIC}/docs/quick-start`, { maxRedirects: 0 })
  expect([307, 308]).toContain(redirect.status())
  for (const path of ['/feeds/rss.xml', '/feeds/atom.xml', '/robots.txt', '/opengraph-image']) {
    const response = await request.get(`${PUBLIC}${path}`)
    expect(response.ok()).toBe(true)
  }
})

test('authority-backed pages degrade safely without guessed values or purchase actions', async ({ page }) => {
  await page.goto(`${PUBLIC}/pricing`)
  await expect(page.getByRole('status')).toContainText('Current pricing is unavailable')
  await expect(page.locator('a[href*="kind=choose_plan"]')).toHaveCount(0)
  for (const path of ['/templates', '/experts', '/showcase', '/plugins']) {
    await page.goto(`${PUBLIC}${path}`)
    await expect(page.getByRole('status')).toBeVisible()
  }
})

test('trust and policy surfaces expose current review state and ownership', async ({ page }) => {
  await page.goto(`${PUBLIC}/trust`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('information you need to trust')
  await page.goto(`${PUBLIC}/legal/privacy`)
  await expect(page.getByText('Current policy · Version 2026-08-02', { exact: true })).toBeVisible()
  await expect(page.getByText('Privacy review owner', { exact: true })).toBeVisible()
})

test('public routes never set parent, staff, app, admin, or tenant cookies', async ({ page, context }) => {
  for (const path of ['/', '/pricing', '/templates', '/start?kind=sign_up&source=home']) {
    await page.goto(`${PUBLIC}${path}`)
  }
  const cookies = await context.cookies()
  expect(cookies.filter((cookie) => cookie.domain.includes('trimly.co.ke'))).toEqual([])
})
