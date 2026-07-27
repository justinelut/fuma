import { expect, test } from '@playwright/test'

test('public web remains cookie-free and exposes safe degradation only', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.url()).toMatch(/^https:\/\/3002\.blyss\.co\.ke\//)
  const cookies = await page.context().cookies()
  expect(cookies.every(({ domain }) => domain === '3002.blyss.co.ke')).toBe(true)
  expect(cookies.some(({ domain }) => domain === '.fuma.co.ke')).toBe(false)
  await expect(page.locator('body')).not.toContainText(/(?:DATABASE_URL|PAYSTACK_SECRET|CLOUDFLARE_API_TOKEN|BEGIN PRIVATE KEY)/)
})

test('public contract failure does not render private fallback data', async ({ page }) => {
  await page.route('**/api/public/v1/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"temporarily_unavailable"}}' }))
  await page.goto('/contract-demo')
  await expect(page.locator('body')).toContainText(/unavailable|try again/i)
  await expect(page.locator('body')).not.toContainText(/ownerKey|setupFee|grossMargin|paid-transfer-pending/i)
})
