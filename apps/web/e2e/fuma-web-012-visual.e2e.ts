import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'

test('product canvas is keyboard-operable and mobile targets are at least 44px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${PUBLIC}/`)

  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(3)
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  const panelId = await tabs.nth(0).getAttribute('aria-controls')
  expect(panelId).toBeTruthy()
  await expect(page.locator(`#${panelId}`)).toBeVisible()

  for (const target of [tabs.nth(0), page.locator('[data-slot="sheet-trigger"]')]) {
    const box = await target.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  }

  await tabs.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toBeFocused()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'pc-tab-content')
})

test('reduced motion keeps product-stage changes immediate and meaningful', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${PUBLIC}/`)
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await page.getByRole('tab', { name: 'Operate' }).click()
  await expect(page.locator('[data-fuma-motion-panel]')).toBeVisible()
  const activeAnimations = await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const panel = document.querySelector('[data-fuma-motion-panel]')
    return panel?.getAnimations({ subtree: true }).filter((animation) => animation.playState !== 'finished').length ?? -1
  })
  expect(activeAnimations).toBe(0)
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'pc-tab-operate')
  await expect(page.getByRole('tabpanel').getByAltText(/Fuma dashboard showing site statistics/)).toBeVisible()
  await context.close()
})

test('the initial product scene remains meaningful without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const response = await page.goto(`${PUBLIC}/`)
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('whole life of a site')
  await expect(page.getByAltText(/Fuma Pages workspace/)).toBeVisible()
  await context.close()
})
