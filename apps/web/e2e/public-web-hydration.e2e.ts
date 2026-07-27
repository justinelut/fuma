import { expect, test } from '@playwright/test'

const ACQUISITION_ROUTES = ['/', '/website', '/publication', '/features', '/solutions', '/about'] as const

test('all acquisition routes render and hydrate through the Blyss HTTPS host', async ({ page }) => {
  const runtimeErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('static.cloudflareinsights.com/beacon.min.js')) {
      consoleErrors.push(message.text())
    }
  })

  for (const route of ACQUISITION_ROUTES) {
    const response = await page.goto(route)
    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(new RegExp(`^https://3002\\.blyss\\.co\\.ke${route === '/' ? '/?$' : `${route}$`}`))
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content')
    await expect(page.locator('body')).toHaveCSS('font-family', /Inter|system-ui/)
  }

  expect(runtimeErrors).toEqual([])
  expect(consoleErrors).toEqual([])

  const notFound = await page.goto('/not-a-public-route')
  expect(notFound?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This public page does not exist.')
})

test('public contract demo and BFF fail safely through the Blyss HTTPS host', async ({ page, request }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))

  const demo = await page.goto('/contract-demo')
  expect(demo?.status()).toBe(200)
  await expect(page).toHaveURL('https://3002.blyss.co.ke/contract-demo')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Server-owned product facts')
  await expect(page.getByRole('status')).toContainText('temporarily unavailable')
  expect(runtimeErrors).toEqual([])

  const bff = await request.get('/api/public/v1/product-facts?limit=6', {
    headers: {
      authorization: 'Bearer visitor-credential-must-not-forward',
      cookie: 'visitor-session=must-not-forward',
    },
  })
  expect(bff.status()).toBe(503)
  expect(bff.headers()['cache-control']).toBe('no-store')
  expect(bff.headers()['set-cookie']).toBeUndefined()
  expect(await bff.json()).toEqual({
    error: { code: 'temporarily_unavailable', message: 'Public data is temporarily unavailable.' },
  })
})
