import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'
const ROUTES = ['/templates', '/contact', '/trust', '/security', '/status', '/legal/privacy', '/legal/history'] as const

test('template and trust surfaces render accessibly through the Blyss HTTPS host', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  await page.setViewportSize({ width: 320, height: 720 })
  for (const route of ROUTES) {
    const response = await page.goto(`${PUBLIC}${route}`)
    expect(response?.status(), route).toBe(200)
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), route).toBe(true)
  }
  expect(runtimeErrors).toEqual([])
})

test('contact, status and unavailable template states remain explicit and keyboard reachable', async ({ page }) => {
  await page.goto(`${PUBLIC}/contact`)
  const general = page.getByRole('region', { name: 'General question' })
  await expect(general.getByLabel('Name')).toBeVisible()
  await expect(general.getByLabel('Email')).toBeVisible()
  await expect(general.getByLabel('Message')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()

  await page.goto(`${PUBLIC}/status`)
  await expect(page.getByRole('status')).toContainText(/unavailable|operational|degraded|outage/i)

  await page.goto(`${PUBLIC}/templates`)
  await expect(page.getByRole('main')).toContainText(/temporarily unavailable|templates/i)
})
