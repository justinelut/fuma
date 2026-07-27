import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const PUBLIC = 'https://3002.blyss.co.ke'
const pilotPrefix = process.env.E2E_LAWYER_PILOT_PREFIX ?? '/__acceptance/lawyer'
if (!pilotPrefix.startsWith('/') || pilotPrefix.includes('..')) throw new Error('E2E_LAWYER_PILOT_PREFIX must be a safe path on https://3002.blyss.co.ke')

const manifest = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/fuma-governance-launch/fixtures/lawyer/design-conversion.json'), 'utf8')) as {
  routeBindings: readonly { route: string; templateId: string; loopIds: readonly string[]; accessBinding: 'public' | 'member' | 'paid' }[]
  flattenedCopies: number
}

for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) {
  test.describe(`FUMA-077 Lawyer reusable conversion ${viewport.width}px`, () => {
    test.use({ viewport })

    for (const binding of manifest.routeBindings) {
      test(`${binding.route} resolves through its reusable template, loops, and access state`, async ({ page }) => {
        const path = binding.route === '/' ? `${pilotPrefix}/` : `${pilotPrefix}${binding.route}`
        const response = await page.goto(`${PUBLIC}${path}`)
        expect(response?.url()).toMatch(/^https:\/\/3002\.blyss\.co\.ke\//)
        expect(response?.status()).toBe(200)
        await expect(page.getByRole('main')).toHaveAttribute('data-fuma-template', binding.templateId)
        await expect(page.getByRole('main')).toHaveAttribute('data-fuma-access', binding.accessBinding)
        for (const loopId of binding.loopIds) await expect(page.locator(`[data-fuma-loop="${loopId}"]`)).toHaveCount(1)
        await expect(page.locator('[data-fuma-flattened-copy="true"]')).toHaveCount(0)
        await expect(page.locator('html')).toHaveAttribute('lang', 'en-KE')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      })
    }
  })
}

test('anonymous pilot access never leaks member or paid article bodies', async ({ page }) => {
  for (const binding of manifest.routeBindings.filter(({ accessBinding }) => accessBinding !== 'public')) {
    const path = binding.route === '/' ? `${pilotPrefix}/` : `${pilotPrefix}${binding.route}`
    await page.goto(`${PUBLIC}${path}`)
    await expect(page.getByRole('main')).toHaveAttribute('data-fuma-access', binding.accessBinding)
    await expect(page.locator('[data-private-member-body]')).toHaveCount(0)
    await expect(page.getByText(/sign in|membership|subscribe/i).first()).toBeVisible()
  }
})

test('conversion manifest itself forbids flattened copies', () => {
  expect(manifest.flattenedCopies).toBe(0)
})
