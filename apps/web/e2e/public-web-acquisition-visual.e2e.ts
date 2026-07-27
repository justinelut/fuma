import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'
const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'website', path: '/website' },
  { name: 'publication', path: '/publication' },
  { name: 'features', path: '/features' },
  { name: 'solutions', path: '/solutions' },
  { name: 'about', path: '/about' },
] as const

for (const viewport of [
  { name: 'mobile', width: 320, height: 700 },
  { name: 'desktop', width: 1280, height: 800 },
] as const) {
  for (const route of ROUTES) {
    test(`${route.name} matches the ${viewport.name} acquisition baseline`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.addInitScript(() => {
        sessionStorage.setItem('fuma_public_consent_v1', JSON.stringify({
          version: 1,
          choice: 'essential',
          updatedAt: '2026-07-26T00:00:00Z',
        }))
      })
      const response = await page.goto(`${PUBLIC}${route.path}`)
      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page).toHaveScreenshot(`${route.name}-${viewport.name}.png`, {
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
      })
    })
  }
}
