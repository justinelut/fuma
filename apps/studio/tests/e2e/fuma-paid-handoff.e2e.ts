import { expect, test } from '@playwright/test'
import type { PaidHandoffDashboardWire } from '@admin/fuma/paidHandoff/client'

const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL
if (!ADMIN_BASE_URL) throw new Error('FUMA-074 browser acceptance requires E2E_ADMIN_BASE_URL.')
const at = (minute: number) => `2026-07-31T09:${String(minute).padStart(2, '0')}:00.000Z`
const review: PaidHandoffDashboardWire['review'] = {
  commandId: 'paid-handoff:contract-browser', transferId: 'transfer-browser', contractId: 'contract-browser', offerId: 'offer-browser', offerVersion: 5,
  source: { platformId: 'platform-ke', organizationId: 'organization-source', workspaceId: 'workspace-source', siteId: 'site-ke' },
  destination: { platformId: 'platform-ke', organizationId: 'organization-destination', workspaceId: 'workspace-destination', siteId: 'site-ke' },
  outboxState: 'pending', paymentState: 'paid-transfer-pending', destinationActive: true, quotaAccepted: true, policyAcceptanceCurrent: true, meteringEvidenceCurrent: true,
  internalGrantExcluded: true, assetOwners: { domain: 'FUMA-062', ai: 'FUMA-064', mcp: 'FUMA-066', plugins: 'FUMA-067', payments: 'FUMA-069', collaborators: 'FUMA-023' },
  setupAmountMinor: 125000, recurringAmountMinor: 75000, currency: 'KES', cadence: 'monthly', locale: 'en-KE', timezone: 'Africa/Nairobi', activatedAt: at(0), setupAmount: 'KES 1,250.00', recurringAmount: 'KES 750.00', activatedAtLocal: '31 Jul 2026, 12:00', canPrepare: true, canRecover: false, blockedReasons: [],
}
type SagaState = 'none'|'proposed'|'awaiting-confirmations'|'ready'|'failed'|'completed'
const versionFor = (state: SagaState) => state === 'none' ? at(0) : at({ proposed: 1, 'awaiting-confirmations': 2, ready: 3, failed: 4, completed: 5 }[state])
function dashboard(state: SagaState): PaidHandoffDashboardWire {
  const failed = state === 'failed'; const completed = state === 'completed'
  return { review: { ...review, outboxState: failed ? 'failed' : completed ? 'delivered' : 'pending', canPrepare: state === 'none', canRecover: failed, blockedReasons: completed ? ['already-delivered'] : [] }, transfer: state === 'none' ? null : { state: state === 'awaiting-confirmations' ? 'awaiting-confirmations' : state, version: versionFor(state), confirmationStatus: state === 'proposed' ? 'unconfirmed' : state === 'awaiting-confirmations' ? 'partially-confirmed' : 'confirmed', fence: failed || completed ? 7 : null, failureCode: failed ? 'plugin-compensated' : null, steps: [{ definitionId: 'transfer.base-ownership', sequence: 1, state: completed ? 'succeeded' : failed ? 'failed' : 'pending' }, { definitionId: 'plugin-settings-rekey', sequence: 2, state: completed ? 'succeeded' : failed ? 'failed' : 'pending' }] }, progressPercent: state === 'none' ? 0 : state === 'proposed' ? 10 : state === 'awaiting-confirmations' ? 20 : state === 'ready' ? 35 : 100, nextAction: state === 'none' ? 'choose-assets' : state === 'proposed' ? 'confirm-source' : state === 'awaiting-confirmations' ? 'confirm-destination' : state === 'ready' ? 'start' : failed ? 'recover' : 'complete', managedOwnership: completed ? 'removed' : 'retained', customerQuotaApplication: completed ? 'applied-once' : 'pending', internalGrantExcluded: true }
}
const json = (result: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify({ result }) })
test.use({ baseURL: ADMIN_BASE_URL, storageState: { cookies: [], origins: [] } })

test('FUMA-074 completes a failed paid handoff through the approved Studio host', async ({ page }) => {
  let state: SagaState = 'none'; const browserErrors: string[] = []; const requestUrls: string[] = []; const requestBodies: unknown[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message)); page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  await page.route('**/api/fuma/organizations/**/transfers/paid-handoffs/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); requestUrls.push(url.href)
    if (request.method() === 'GET') { await route.fulfill(json(dashboard(state))); return }
    const body = request.postDataJSON() as Record<string, unknown>; requestBodies.push(body); const path = url.pathname
    if (path.endsWith('/prepare')) state = 'proposed'
    else if (path.endsWith('/confirm')) state = body.side === 'source' ? 'awaiting-confirmations' : 'ready'
    else if (path.endsWith('/start')) { state = 'failed'; await route.fulfill(json({ commandId: review.commandId, transferId: review.transferId, state: 'running', version: at(4) }, 202)); return }
    else if (path.endsWith('/reconcile')) { await route.fulfill(json({ commandId: review.commandId, transferId: review.transferId, action: 'reconciled', transferState: 'failed', outboxState: 'failed', occurredAt: at(5) })); return }
    else if (path.endsWith('/refund-escalations')) { await route.fulfill(json({ commandId: review.commandId, transferId: review.transferId, action: 'refund-escalated', transferState: 'failed', outboxState: 'failed', occurredAt: at(5) }, 202)); return }
    else if (path.endsWith('/recover')) { state = 'completed'; await route.fulfill(json({ commandId: review.commandId, transferId: review.transferId, state: 'resume-requested', version: at(5) }, 202)); return }
    await route.fulfill(json({ commandId: review.commandId, transferId: review.transferId, state: state === 'awaiting-confirmations' ? 'awaiting-confirmations' : state, version: versionFor(state) }, path.endsWith('/prepare') ? 201 : 200))
  })
  await page.goto('/tests/e2e/fixtures/fuma-paid-handoff-harness.html')
  await expect(page).toHaveURL(/^https:\/\/5174\.blyss\.co\.ke\//)
  await expect(page.getByRole('heading', { name: 'Site handoff' })).toBeVisible(); await expect(page.getByRole('status')).toContainText('en-KE · KES · Africa/Nairobi')
  await page.getByLabel('Paid handoff command ID').fill(review.commandId); await page.getByRole('button', { name: 'Load handoff' }).click()
  await expect(page.getByText('contract-browser')).toBeVisible(); await expect(page.getByText('offer-browser · version 5')).toBeVisible(); await expect(page.getByText('paid-transfer-pending')).toBeVisible(); await expect(page.getByText('organization-destination / workspace-destination / site-ke')).toBeVisible()
  for (const label of ['Domain choice','AI/BYOK choice','MCP connectors','Plugin settings and secrets','Payment merchant','Collaborators']) await expect(page.getByLabel(label)).toBeVisible()
  await page.getByRole('button', { name: 'Record choices and request confirmation' }).click(); await page.getByRole('button', { name: 'Confirm as source owner' }).click(); await page.getByRole('button', { name: 'Confirm exact destination' }).click(); await page.getByRole('button', { name: 'Start resumable handoff' }).click()
  await expect(page.getByRole('alert')).toContainText('plugin-compensated'); await expect(page.getByText(/Verified payment remains preserved/)).toBeVisible()
  await page.getByRole('button', { name: 'Reconcile current state' }).click(); await expect(page.getByText('Durable transfer and handoff outbox reconciled.')).toBeVisible()
  await page.getByRole('button', { name: 'Escalate refund review' }).click(); await expect(page.getByText(/never changes verified payment/i)).toBeVisible()
  await page.getByRole('button', { name: 'Resume compensated handoff' }).click(); await expect(page.getByText(/Ownership removed from the source and customer quota applied once/)).toBeVisible(); await expect(page.getByText('removed', { exact: true })).toBeVisible(); await expect(page.getByText('applied-once', { exact: true })).toBeVisible()
  const expectedOrigin = new URL(ADMIN_BASE_URL).origin
  expect(requestUrls.every((value) => new URL(value).origin === expectedOrigin)).toBe(true)
  expect(requestUrls.every((value) => new URL(value).pathname.startsWith('/api/fuma/organizations/organization-source/workspaces/workspace-source/sites/site-ke/transfers/paid-handoffs/'))).toBe(true)
  for (const body of requestBodies) { expect(body).not.toHaveProperty('source'); expect(body).not.toHaveProperty('destination'); expect(body).not.toHaveProperty('actorId'); expect(body).not.toHaveProperty('permissions') }
  await page.setViewportSize({ width: 320, height: 900 })
  await expect(page.getByRole('heading', { name: 'Site handoff' })).toBeVisible()
  const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('*')).flatMap((element) => {
    const rect = element.getBoundingClientRect()
    return rect.right > document.documentElement.clientWidth + 0.5 || rect.left < -0.5
      ? [{ tag: element.tagName, className: element.className, left: rect.left, right: rect.right, width: rect.width }]
      : []
  }))
  expect(overflow).toEqual([])
  expect(browserErrors).toEqual([])
})
