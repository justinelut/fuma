import { expect, test } from '@playwright/test'

test.describe('FUMA governance control surfaces', () => {
  test('admin console exposes bounded contribution slots without customer mutations', async ({ page }) => {
    await page.goto('/internal')
    await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
    await expect(page.getByText('Plugin review — FUMA-068')).toBeVisible()
    await expect(page.getByText('Support/moderation — FUMA-072')).toBeVisible()
    await expect(page.getByText('Expert moderation — FUMA-073')).toBeVisible()
    await expect(page.getByText('Transfer recovery — FUMA-074')).toBeVisible()
  })

  test('marketplace never enables an unsigned install', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.getByRole('heading', { name: 'Reviewed plugins' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Install after signed review' })).toBeDisabled()
  })

  test('transfer review presents Kenya localization and all owned asset choices', async ({ page }) => {
    await page.goto('/transfers')
    await expect(page.getByText('en-KE · KES · Africa/Nairobi')).toBeVisible()
    for (const label of ['Domain choice', 'AI/BYOK choice', 'MCP connectors', 'Plugin settings', 'Payment merchant', 'Collaborators']) await expect(page.getByText(new RegExp(label))).toBeVisible()
  })

  test('secure secret entry stays outside AI and requires a one-time host-only handoff', async ({ page, context }) => {
    await page.goto('/secure-payment')
    await expect(page.getByText(/never returned to AI/i)).toBeVisible()
    await expect(page.getByLabel('Secret key')).toHaveAttribute('type', 'password')
    await expect(page.getByRole('button', { name: 'Store through one-time handoff' })).toBeDisabled()
    await context.addCookies([{ name: '__Host-fuma-payment-handoff', value: 'opaque-test-handoff', url: 'https://5174.blyss.co.ke', httpOnly: true, secure: true, sameSite: 'Strict' }])
    await page.reload()
    await expect(page.getByRole('button', { name: 'Store through one-time handoff' })).toBeEnabled()
  })
})
