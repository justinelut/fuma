import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

test.describe('FUMA governance control surfaces', () => {
  test('admin console exposes complete redacted views, managed-offer evidence and bounded contribution seams', async ({ page }) => {
    await page.goto('/internal')
    await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Kijani Law managed-client lifecycle' })).toBeVisible()
    await expect(page.getByText(/setup KES 650\.00 separate from recurring KES 2,400\.00/)).toBeVisible()
    await expect(page.getByText(/paid-transfer-pending · ownership unchanged/)).toBeVisible()
    await expect(page.getByText(/platform-internal/)).toBeVisible()
    for (const label of ['Users', 'Organizations', 'Managed and provisional clients', 'Workspaces', 'Sites', 'Plans', 'Custom offers', 'Contracts', 'Invoices', 'COGS and margin', 'Usage and quota', 'Domains', 'Email', 'Jobs', 'Releases', 'AI catalog', 'Audit']) await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible()
    await page.getByLabel('Search current view').fill('Kijani')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText('org-provisional-kijani')).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/never-visible|sessionToken|privateJson|credentialCiphertext|rawBody/)
    await expect(page.getByText(/FUMA-068 · Mounted from/)).toBeVisible()
    for (const owner of ['FUMA-072', 'FUMA-073', 'FUMA-074']) await expect(page.getByText(new RegExp(`${owner} · Empty by default`))).toBeVisible()
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

  test('AI-confirmed payment setup keeps confirmation and credentials outside AI', async ({ page }) => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const permissions = ['cms.routes', 'modules.register', 'payments.customer.create', 'payments.customer.refund']
    const baseProposal = {
      proposalId: 'ai-payment:browser-proposal',
      review: {
        submissionId: 'submission-browser', decisionId: 'decision-browser', signatureKeyId: 'review-key-browser',
        artifactId: 'artifact-browser', packageId: 'fuma.customer-payments', exactVersion: '1.0.0',
        contentHashSha256: 'a'.repeat(64), permissions,
      },
      purpose: 'donation', blockId: 'fuma.customer-payments.donation', amountAuthority: 'customer-or-merchant-explicit-input',
      feeDisclosure: {
        version: 'fuma-customer-payments-fees-v1', currency: 'KES', fumaPlatformFeeMinor: 0,
        providerFeeNotice: 'Paystack fees are charged under the merchant account and are not controlled by AI.',
        customerChargeNotice: 'Confirmation and credential storage do not charge a customer. A separate explicit checkout sets the amount.',
        previewAmountMinor: 100,
      },
      state: 'proposed', installationId: null, credentialStored: false, preview: null,
      expiresAt: '2026-08-01T08:10:00.000Z', confirmationPath: '/secure-payment',
    }
    await page.route('**/api/fuma/organizations/org-browser/workspaces/workspace-browser/sites/site-browser/ai/payment-setup/proposals/ai-payment%3Abrowser-proposal**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const body = request.method() === 'POST' ? request.postDataJSON() as Record<string, unknown> : {}
      requests.push({ path, body })
      if (path.endsWith('/confirm')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'set-cookie': '__Host-fuma_ai_payment_setup=browser-handoff; Path=/api/fuma/; Max-Age=300; Secure; HttpOnly; SameSite=Strict' },
          body: JSON.stringify({ ...baseProposal, state: 'confirmed', installationId: 'installation-browser' }),
        })
        return
      }
      if (path.endsWith('/credentials')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          ...baseProposal, state: 'tested', installationId: 'installation-browser', credentialStored: true,
          preview: { state: 'settled', purpose: 'donation', amountMinor: 100, currency: 'KES', receiptFingerprintSha256: 'b'.repeat(64) },
        }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseProposal) })
    })
    const browserErrors: string[] = []
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
    await page.goto('/secure-payment?organizationId=org-browser&workspaceId=workspace-browser&siteId=site-browser&proposalId=ai-payment%3Abrowser-proposal')
    await expect(page.getByRole('heading', { name: 'Secure payment setup' })).toBeVisible()
    await expect(page.getByText('fuma.customer-payments@1.0.0')).toBeVisible()
    await expect(page.getByText('Test preview policy: KES 1.00, fixed by the server.')).toBeVisible()
    const confirmationChecks = page.getByRole('checkbox')
    await expect(confirmationChecks).toHaveCount(7)
    for (let index = 0; index < 7; index += 1) await confirmationChecks.nth(index).check()
    await page.getByRole('button', { name: 'Confirm exact reviewed setup' }).click()
    await expect(page.getByRole('heading', { name: 'Enter Paystack credentials directly' })).toBeVisible()
    await page.getByLabel('Public key').fill('pk_test_browser_public')
    await page.getByLabel('Secret key').fill('sk_test_browser_secret_value')
    await page.getByRole('button', { name: 'Store through one-time secure handoff' }).click()
    await expect(page.getByRole('heading', { name: 'Test payment settled' })).toBeVisible()
    await expect(page.getByText('KES 1.00', { exact: true })).toBeVisible()
    const challenge = requests.find(({ path }) => path.endsWith('/challenge'))?.body
    const confirmation = requests.find(({ path }) => path.endsWith('/confirm'))?.body
    const credentials = requests.find(({ path }) => path.endsWith('/credentials'))?.body
    expect(challenge?.nonceHashSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(confirmation?.confirmationNonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge?.nonceHashSha256).toBe(createHash('sha256').update(String(confirmation?.confirmationNonce)).digest('hex'))
    expect(JSON.stringify([challenge, confirmation])).not.toMatch(/pk_test|sk_test/)
    expect(credentials).toMatchObject({ publicKey: 'pk_test_browser_public', secretKey: 'sk_test_browser_secret_value', testMode: true })
    expect(browserErrors).toEqual([])
  })
})
