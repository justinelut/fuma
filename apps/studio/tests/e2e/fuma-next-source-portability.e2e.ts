import { expect, test } from '@playwright/test'

const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL
if (!ADMIN_BASE_URL) throw new Error('FUMA-077 browser acceptance requires E2E_ADMIN_BASE_URL.')

test.use({ baseURL: ADMIN_BASE_URL, storageState: { cookies: [], origins: [] } })

test('FUMA-077 reviews, confirms, applies, and commits portable source through the approved Studio host', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })

  await page.goto('/tests/e2e/fixtures/fuma-next-source-portability-harness.html')
  await expect(page).toHaveURL(/^https:\/\/5174\.blyss\.co\.ke\//)
  await expect(page.getByRole('heading', { name: 'Import, adapt, commit, and export' })).toBeVisible()
  await expect(page.getByText('Package managers, scripts, configuration plugins, repository code, and generated server backends never run.')).toBeVisible()
  await expect(page.getByText('Static source compatible')).toBeVisible()
  await expect(page.getByText('Owner-reviewed portable site')).toBeVisible()
  await expect(page.getByText('Sequence 4')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Commit to editor' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Create archive' })).toBeDisabled()

  await page.getByRole('button', { name: 'Confirm as owner' }).click()
  await expect(page.getByRole('status')).toContainText('Executable diff confirmed by the direct owner.')
  await page.getByRole('button', { name: 'Apply fix' }).click()
  await expect(page.getByRole('status')).toContainText('Owner-confirmed source fix applied')
  await expect(page.getByRole('button', { name: 'Commit to editor' })).toBeEnabled()

  await page.getByRole('button', { name: 'Commit to editor' }).click()
  await expect(page.getByText(/Committed mutation/)).toContainText('nextsource:browser')
  await expect(page.getByRole('button', { name: 'Create archive' })).toBeEnabled()
  await expect(page.getByText('release-browser')).toBeVisible()

  await page.setViewportSize({ width: 320, height: 900 })
  await expect(page.getByRole('heading', { name: 'Import, adapt, commit, and export' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(browserErrors).toEqual([])
})
