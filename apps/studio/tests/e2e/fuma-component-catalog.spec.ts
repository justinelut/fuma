import { expect, test } from '@playwright/test'

const ITEMS = [
  { coordinate: 'starter:hero-centered@1.0.0', displayName: 'Centered hero', description: 'Starter marketing hero.', source: 'starter', trustTier: 'first-party', componentIds: ['hero'], permissions: [], installed: false, exactVersion: '1.0.0', integritySha256: 'a'.repeat(64) },
  { coordinate: 'private:site-browser/card@2', displayName: 'Private card', description: 'Site-owned declarative card.', source: 'private', trustTier: 'private', componentIds: ['card'], permissions: [], installed: true, exactVersion: '2', integritySha256: 'b'.repeat(64) },
  { coordinate: 'pack:reviewed/forms@1.4.2', displayName: 'Reviewed forms', description: 'Reviewed signed form pack.', source: 'reviewed', trustTier: 'reviewed', componentIds: ['contact-form'], permissions: ['forms.submit'], installed: true, exactVersion: '1.4.2', integritySha256: 'c'.repeat(64) },
]

test.use({ baseURL: process.env.E2E_ADMIN_BASE_URL })

test('FUMA-SITE-008 catalogs, previews, versions and inserts exact components', async ({ page }) => {
  await page.route('**/api/fuma/organizations/**/components/catalog?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('query')?.toLowerCase() ?? ''
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { items: ITEMS.filter((item) => item.displayName.toLowerCase().includes(query)) } }) })
  })
  await page.route('**/api/fuma/organizations/**/components/actions/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { accepted: true, exactPin: 'private:site-browser/card@2' } }) })
  })
  await page.goto('/tests/e2e/fixtures/fuma-component-catalog-harness.html')

  await expect(page).toHaveURL(/^https:\/\/5174\.blyss\.co\.ke\//)
  await expect(page.getByRole('heading', { name: 'Component catalog' })).toBeVisible()
  await expect(page.getByText('3 results')).toBeVisible()
  await expect(page.getByRole('button', { name: /Centered hero/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Private card/ })).toContainText('installed')
  await expect(page.getByRole('button', { name: /Reviewed forms/ })).toBeVisible()

  await page.getByRole('button', { name: /Private card/ }).click()
  await expect(page.getByRole('heading', { name: 'Private card' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'preview' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'create' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'variant' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'insert' })).toBeEnabled()
  await page.getByRole('button', { name: 'preview' }).click()
  await expect(page.getByText(/"accepted": true/)).toBeVisible()

  await page.getByRole('textbox', { name: 'Search components' }).fill('reviewed')
  await expect(page.getByText('1 results')).toBeVisible()
  await expect(page.getByRole('button', { name: /Reviewed forms/ })).toBeVisible()
})
