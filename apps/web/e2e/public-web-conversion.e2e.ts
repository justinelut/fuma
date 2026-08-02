import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'
const APP = 'https://app.trimly.co.ke'
const FIXTURE_INTENT = 'fixture_intent_0123456789abcdef0123456789'
const FIXTURE_CORRELATION = 'fixture_correlation_0123456789abcdef'

for (const journey of [
  { path: '/website', heading: 'Build the site', homeLink: /Explore the Website journey/, startLink: 'Create a website', profile: 'website' },
  { path: '/publication', heading: 'recurring ideas', homeLink: /Explore the Publication journey/, startLink: 'Start a publication', profile: 'publication' },
] as const) {
  for (const width of [320, 1280] as const) {
    test(`${journey.profile} conversion reaches the app-host handoff layer at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.route('**/api/handoff', async (route) => {
        const request = route.request()
        expect(request.method()).toBe('POST')
        expect(request.postDataJSON()).toEqual({ kind: 'create_site', source: 'product', profile: journey.profile })
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            redirectUrl: `${APP}/resume?intent=${FIXTURE_INTENT}&correlation=${FIXTURE_CORRELATION}`,
          }),
        })
      })
      await page.route(`${APP}/resume**`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html lang="en"><title>Fuma</title><body><main><h1>Fuma opened</h1><p>You can continue with your site.</p></main></body></html>',
        })
      })

      const response = await page.goto(PUBLIC)
      expect(response?.status()).toBe(200)
      await page.getByRole('link', { name: journey.homeLink }).click()
      await expect(page).toHaveURL(`${PUBLIC}${journey.path}`)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(journey.heading)
      await page.getByRole('link', { name: journey.startLink }).first().click()
      await expect(page).toHaveURL(new RegExp(`^https://3002\\.blyss\\.co\\.ke/start\\?.*profile=${journey.profile}`))
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your site')
      await page.getByRole('button', { name: 'Create site' }).click()
      await expect(page).toHaveURL(`${APP}/resume?intent=${FIXTURE_INTENT}&correlation=${FIXTURE_CORRELATION}`)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fuma opened')
      await expect(page.getByText('You can continue with your site.')).toBeVisible()
    })
  }
}

test('tampered handoff fields fail closed without cookies or private details', async ({ page, request, context }) => {
  const tamperedPage = await page.goto(`${PUBLIC}/start?kind=choose_plan&source=pricing&planId=plan_public&redirect=https://attacker.test`)
  expect(tamperedPage?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This public page does not exist.')

  const response = await request.post(`${PUBLIC}/api/handoff`, {
    headers: { origin: PUBLIC },
    data: {
      kind: 'choose_plan',
      source: 'pricing',
      planId: 'plan_public',
      redirect: 'https://attacker.test',
    },
  })
  expect(response.status()).toBe(400)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.headers()['set-cookie']).toBeUndefined()
  expect(await response.json()).toEqual({
    error: { code: 'invalid_request', message: 'Invalid handoff request.' },
  })
  expect(await context.cookies()).toEqual([])
})
