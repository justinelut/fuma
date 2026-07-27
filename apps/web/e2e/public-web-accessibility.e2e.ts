import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'
const ACQUISITION_ROUTES = ['/', '/website', '/publication', '/features', '/solutions', '/about'] as const

test('keyboard navigation, skip link and visible focus work through the public shell', async ({ page }) => {
  await page.goto(PUBLIC)
  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: 'Skip to content' })
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
})

test('every acquisition route survives a 320px viewport with 200% text sizing', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  for (const route of ACQUISITION_ROUTES) {
    await page.goto(`${PUBLIC}${route}`)
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('main')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)).toBe(true)
  }
})

test('reduced-motion preference disables smooth scrolling and transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${PUBLIC}/features`)
  const motion = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const link = getComputedStyle(document.querySelector('a[href="/website"]')!)
    return { scrollBehavior: root.scrollBehavior, transitionDuration: link.transitionDuration }
  })
  expect(motion.scrollBehavior).toBe('auto')
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.00001)
})

test('the persistent analytics preference control stays in document flow', async ({ page }) => {
  await page.goto(PUBLIC)
  const panel = page.getByRole('complementary', { name: 'Analytics preference' })
  await panel.getByRole('button', { name: 'Essential only' }).click()
  await expect(page.getByRole('button', { name: 'Review analytics preference' })).toHaveCSS('position', 'static')
})

test('GPC suppresses consent prompt and optional storage', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }))
  await page.goto(PUBLIC)
  await expect(page.getByRole('complementary', { name: 'Analytics preference' })).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
  await context.close()
})

test('optional analytics consent is session-only and can be withdrawn immediately', async ({ page }) => {
  await page.goto(PUBLIC)
  const panel = page.getByRole('complementary', { name: 'Analytics preference' })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Allow optional' }).click()
  expect(await page.evaluate(() => document.cookie)).toBe('')
  expect(await page.evaluate(() => sessionStorage.getItem('fuma_public_consent_v1'))).toContain('optional')
  await page.getByRole('button', { name: 'Withdraw optional analytics' }).click()
  expect(await page.evaluate(() => sessionStorage.getItem('fuma_public_consent_v1'))).toContain('essential')
  expect(await page.context().cookies()).toEqual([])
})
