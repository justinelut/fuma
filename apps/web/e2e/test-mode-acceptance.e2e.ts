import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'
const STUDIO = 'https://5174.blyss.co.ke'

const publicRoutes = [
  '/',
  '/start?kind=sign_in&source=direct',
  '/start?kind=sign_up&source=direct',
  '/pricing',
  '/status',
  '/trust',
  '/legal',
  '/contact',
  '/security',
  '/templates',
  '/components',
  '/plugins',
  '/showcase',
] as const

for (const width of [320, 390, 768, 1024, 1440, 1600] as const) {
  test(`latest public surfaces remain usable at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })

    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('static.cloudflareinsights.com/beacon.min.js')) {
        consoleErrors.push(message.text())
      }
    })

    for (const route of publicRoutes) {
      const response = await page.goto(`${PUBLIC}${route}`, { waitUntil: 'domcontentloaded' })
      expect(response?.status(), route).toBe(200)
      await expect(page.getByRole('heading', { level: 1 }), route).toHaveCount(1)
      await expect(page.getByRole('main'), route).toBeVisible()

      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(layout.scrollWidth, `${route} horizontal overflow`).toBeLessThanOrEqual(layout.clientWidth)

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(25)
      const brokenImages = await page.locator('img').evaluateAll((nodes) => nodes.flatMap((node) => {
        const image = node as HTMLImageElement
        return image.currentSrc && image.complete && image.naturalWidth === 0 ? [image.currentSrc] : []
      }))
      expect(brokenImages, `${route} broken images`).toEqual([])

      if (route.includes('kind=sign_in')) {
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log in to Fuma')
        await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible()
      }
      if (route.includes('kind=sign_up')) {
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your Fuma account')
        await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
      }
      if (route.startsWith('/start')) {
        const accountCopy = await page.getByRole('main').innerText()
        expect(accountCopy).not.toMatch(/app\.trimly\.co\.ke|opaque intent|correlation|session exchange|authority boundary|subdomain transition|handoff boundary/i)
      }
    }

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
}

test('Studio login renders cleanly through its public Blyss preview', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.once('pageerror', (error) => errors.push(error.message))
    const response = await page.goto(`${STUDIO}/admin`, { waitUntil: 'networkidle' })
    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(`${STUDIO}/admin/dashboard`)
    await expect(page.getByRole('heading', { level: 1, name: 'Admin Login' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(errors).toEqual([])
  }
})
