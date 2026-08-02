import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'
const HTML_ROUTES = ['/templates', '/contact', '/trust', '/security', '/status', '/legal', '/legal/privacy', '/legal/history'] as const
const SECURITY_TEXT_ROUTE = '/.well-known/security.txt'

test('template and trust surfaces render responsively through the Blyss HTTPS host', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  for (const viewport of [{ width: 320, height: 720 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport)
    for (const route of HTML_ROUTES) {
      const response = await page.goto(`${PUBLIC}${route}`)
      expect(response?.status(), `${route} at ${viewport.width}px`).toBe(200)
      await expect(page.getByRole('main')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), `${route} at ${viewport.width}px`).toBe(true)
    }
  }

  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto(`${PUBLIC}/contact`)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), '/contact at 320px and 200% text').toBe(true)

  const securityText = await page.request.get(`${PUBLIC}${SECURITY_TEXT_ROUTE}`)
  expect(securityText.status()).toBe(200)
  expect(securityText.headers()['content-type']).toBe('text/plain; charset=utf-8')
  expect(await securityText.text()).toContain('Canonical: https://trimly.co.ke/.well-known/security.txt')
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
