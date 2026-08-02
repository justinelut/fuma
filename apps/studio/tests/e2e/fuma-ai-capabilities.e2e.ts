import { expect, test } from '@playwright/test'

const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL
if (!ADMIN_BASE_URL) throw new Error('FUMA-087 browser acceptance requires E2E_ADMIN_BASE_URL.')
const NOW = '2026-07-31T10:00:00.000Z'
const CAPABILITY = 'site.component-usage.insert'
const VERSION = '1.0.0'

type Mode = 'error'|'empty'|'evidence'

function siteDashboard(revoked: boolean) {
  return {
    kind: 'site',
    capabilities: [{
      id: CAPABILITY, version: VERSION, title: 'Insert reviewed section', description: 'One exact reviewed backend function.',
      class: 'mutate', profileAvailable: true, state: 'degraded', requiredPermission: 'site.structure.edit', permissionGranted: true,
      confirmation: 'none', dataClassification: 'internal', exportAdapter: { id: 'fuma.adapter.component-usage', version: VERSION, available: false },
      channels: [
        { channel: 'site-ai', availability: 'enabled', requiredGrant: 'ai.tools.write', grants: [{ grantId: 'site-ai-permission', label: 'site.structure.edit', channel: 'site-ai', state: 'active', canRevoke: false }], reason: 'Current direct permission.', canGrant: false },
        { channel: 'mcp', availability: revoked ? 'revoked' : 'enabled', requiredGrant: 'component.mutate', grants: [{ grantId: 'connector-browser', label: 'Browser connector', channel: 'mcp', state: revoked ? 'revoked' : 'active', canRevoke: !revoked }], reason: revoked ? 'All exact-scope grants are revoked.' : 'One exact-scope grant is active.', canGrant: false },
        { channel: 'imported-runtime', availability: 'unavailable', requiredGrant: null, grants: [], reason: 'No reviewed imported-runtime mapping.', canGrant: false },
        { channel: 'export-adapter', availability: 'unavailable', requiredGrant: null, grants: [], reason: 'No reviewed export mapping.', canGrant: false },
      ],
      limits: { inputBytes: 65536, outputBytes: 131072, resultItems: 1, requestsPerMinute: 60, timeoutMs: 10000 },
      usage: { successfulOperations: 3, failedOperations: 1, logicalCredits: 3, providerCredits: 3, spendUsdMicros: '250000' },
      health: { state: 'degraded', checkedAt: NOW, detail: 'One successful operation lacks canonical metering.' },
      deprecation: { state: 'current', replacement: null, detail: 'Current exact version.' },
    }],
    recentReceipts: [{ receiptId: 'a'.repeat(64), capabilityId: CAPABILITY, capabilityVersion: VERSION, channel: 'site-ai', operationId: 'operation-browser', outcome: 'succeeded', metered: false, audited: true, auditId: 'audit-browser', occurredAt: NOW }],
    nextCursor: null,
    unsupportedGaps: [{ gapId: 'gap-export', channel: 'export-adapter', title: 'Standalone export adapter unavailable', reason: 'Direct database and generated-server fallbacks remain blocked.', state: 'blocked' }],
    generatedAt: NOW,
  }
}
function platformDashboard() {
  return {
    kind: 'platform',
    inventory: [{
      id: CAPABILITY, version: VERSION, title: 'Insert reviewed section', registryState: 'active',
      health: { state: 'degraded', checkedAt: NOW, detail: 'One drifted receipt.' }, adoption: { currentVersionOperations: 8, driftedReceipts: 1 },
      aggregate: { tenantCount: 4, successfulOperations: 8, failedOperations: 2, meteredOperations: 7, auditedOperations: 8, logicalCredits: 7, providerCredits: 7, spendUsdMicros: '900000', activeMcpGrants: 3, revokedMcpGrants: 2 },
      controls: [
        { kind: 'deprecate', state: 'blocked', reason: 'A reviewed registry release is required.' },
        { kind: 'revoke', state: 'blocked', reason: 'Exact owner workflow is required.' },
        { kind: 'incident', state: 'blocked', reason: 'FUMA-072 authority is required.' },
      ],
    }],
    recentEvidence: [{ capabilityVersion: VERSION, channel: 'mcp', outcome: 'failed', metered: false, audited: true, occurredAt: NOW }],
    nextCursor: null,
    unsupportedGaps: [{ gapId: 'gap-import', channel: 'imported-runtime', title: 'Imported runtime unavailable', reason: 'No reviewed authority mapping.', state: 'blocked' }],
    generatedAt: NOW,
  }
}

const json = (result: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ result }) })

test.use({ baseURL: ADMIN_BASE_URL, storageState: { cookies: [], origins: [] } })

test('FUMA-087 capability dashboards remain protected, responsive, and accessible through the approved Studio host', async ({ page }) => {
  let mode: Mode = 'error'
  let revoked = false
  const browserErrors: string[] = []
  const requestUrls: string[] = []
  const requestBodies: unknown[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })

  await page.route('**/api/fuma/organizations/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    requestUrls.push(url.href)
    if (!url.pathname.includes('/ai/backend-capabilities') && !url.pathname.endsWith('/internal/ai-capabilities')) {
      await route.fallback()
      return
    }
    if (mode === 'error') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { malformed: true } }) })
      return
    }
    if (request.method() === 'POST') {
      const body: unknown = request.postDataJSON()
      requestBodies.push(body)
      revoked = true
      await route.fulfill(json({ ...(body as object), state: 'revoked' }))
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 180))
    if (mode === 'empty') {
      await route.fulfill(json(url.pathname.endsWith('/internal/ai-capabilities')
        ? { kind: 'platform', inventory: [], recentEvidence: [], nextCursor: null, unsupportedGaps: [], generatedAt: NOW }
        : { kind: 'site', capabilities: [], recentReceipts: [], nextCursor: null, unsupportedGaps: [], generatedAt: NOW }))
      return
    }
    await route.fulfill(json(url.pathname.endsWith('/internal/ai-capabilities') ? platformDashboard() : siteDashboard(revoked)))
  })

  await page.goto('/tests/e2e/fixtures/fuma-ai-capability-dashboard-harness.html')
  await expect(page).toHaveURL(/^https:\/\/5174\.blyss\.co\.ke\//)
  await expect(page.getByText('Capability evidence unavailable')).toHaveCount(2)
  await expect(page.getByText('Protected inventory denied')).toBeVisible()
  await expect(page.getByText(/Support impersonation cannot inherit capability/)).toBeVisible()

  mode = 'empty'
  const retries = page.getByRole('button', { name: 'Try again' })
  await expect(retries).toHaveCount(2)
  await retries.nth(1).click()
  await retries.nth(0).click()
  await expect(page.getByText('No reviewed capability is available for this profile.')).toBeVisible()
  await expect(page.getByText('No reviewed registry entries.')).toBeVisible()

  mode = 'evidence'
  await page.reload()
  await expect(page.getByRole('status').first()).toContainText('Loading')
  await expect(page.getByRole('heading', { name: 'AI backend capabilities' })).toBeVisible()
  await expect(page.getByText(/Generated and imported code never receives database/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Backend capability inventory' })).toBeVisible()
  await expect(page.getByText('Standalone export adapter unavailable')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/admin/audit?eventId=audit-browser')
  await expect(page.getByText('1 drifted receipt(s)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deprecate' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Incident' })).toBeDisabled()

  const revoke = page.getByRole('button', { name: 'Revoke', exact: true }).first()
  await page.locator('body').click({ position: { x: 2, y: 2 } })
  for (let index = 0; index < 12 && !await revoke.evaluate((element) => document.activeElement === element); index += 1) {
    await page.keyboard.press('Tab')
  }
  await expect(revoke).toBeFocused()
  expect(await revoke.evaluate((element) => getComputedStyle(element).outlineWidth)).not.toBe('0px')
  await revoke.click()
  await expect(page.getByText('All exact-scope grants are revoked.')).toBeVisible()

  const expectedOrigin = new URL(ADMIN_BASE_URL).origin
  expect(requestUrls.length).toBeGreaterThanOrEqual(8)
  expect(requestUrls.every((value) => new URL(value).origin === expectedOrigin)).toBe(true)
  expect(requestUrls.every((value) => new URL(value).pathname.startsWith('/api/fuma/organizations/organization-browser/workspaces/workspace-browser/sites/site-browser/'))).toBe(true)
  expect(requestBodies).toEqual([{ capabilityId: CAPABILITY, capabilityVersion: VERSION, channel: 'mcp', grantId: 'connector-browser' }])
  for (const body of requestBodies) {
    expect(body).not.toHaveProperty('organizationId')
    expect(body).not.toHaveProperty('workspaceId')
    expect(body).not.toHaveProperty('siteId')
    expect(body).not.toHaveProperty('ownerKey')
    expect(body).not.toHaveProperty('actorId')
    expect(body).not.toHaveProperty('impersonatedBy')
  }

  await page.setViewportSize({ width: 320, height: 900 })
  await expect(page.getByRole('heading', { name: 'AI backend capabilities' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Backend capability inventory' })).toBeVisible()
  const safetyRects = await page.getByText(/Generated and imported code never receives database/).evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const rects: Array<{ left: number; right: number; top: number; bottom: number }> = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      const text = node.textContent ?? ''
      const start = text.indexOf('Generated and imported code never')
      if (start < 0) continue
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + 'Generated and imported code never'.length)
      rects.push(...[...range.getClientRects()].map(({ left, right, top, bottom }) => ({ left, right, top, bottom })))
    }
    return rects
  })
  expect(safetyRects.length).toBeGreaterThan(0)
  expect(safetyRects.every(({ left, right, top, bottom }) => left >= 0 && right <= 320 && bottom > top)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(await page.getByRole('table').evaluate((table) => getComputedStyle(table.parentElement!).overflowX)).toBe('auto')
  expect(browserErrors).toEqual([])
})
