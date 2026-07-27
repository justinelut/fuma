import { expect, test, type Page } from '@playwright/test'
import type {
  FixtureCatalog,
  FumaContextHarnessInput,
} from './fixtures/fumaContextHarnessContract'
import { ANONYMOUS_STATE } from './helpers'

const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL ?? ''
const PUBLIC_BASE_URL = process.env.E2E_PUBLIC_BASE_URL ?? ''
const CONTEXT_PREFERENCE_KEY = 'fuma-scoped-context-v1'
const EMPTY_OVERRIDES = { grant: [] as string[], revoke: [] as string[] }

if (!ADMIN_BASE_URL.startsWith('https://5174.blyss.co.ke')) {
  throw new Error('FUMA-032 browser acceptance must use https://5174.blyss.co.ke')
}
if (!PUBLIC_BASE_URL.startsWith('https://3002.blyss.co.ke')) {
  throw new Error('FUMA-032 public browser acceptance must use https://3002.blyss.co.ke')
}

function catalog(profileId = 'publication'): FixtureCatalog {
  return {
    organizations: [{ id: 'organization-a', name: 'Acacia', status: 'active' }],
    workspaces: [{
      id: 'shared-workspace',
      organizationId: 'organization-a',
      name: 'Acacia Editorial',
      status: 'active',
      isDefault: true,
    }],
    sites: [{
      id: 'shared-publication',
      organizationId: 'organization-a',
      workspaceId: 'shared-workspace',
      name: 'Acacia Daily',
      status: 'active',
      profileId,
      capabilityOverrides: EMPTY_OVERRIDES,
    }],
  }
}

function scopedPath(suffix = ''): string {
  return `/admin/organizations/organization-a/workspaces/shared-workspace/sites/shared-publication${suffix}`
}

async function mount(
  page: Page,
  input: Pick<FumaContextHarnessInput, 'pathname' | 'contextCatalog' | 'persona' | 'deniedPermissions'>,
): Promise<void> {
  await page.goto('/tests/e2e/fixtures/fuma-context-harness.html')
  await page.waitForFunction(() => typeof window.mountFumaContextHarness === 'function')
  await page.evaluate(
    (value: FumaContextHarnessInput) => window.mountFumaContextHarness(value),
    {
      ...input,
      preference: null,
      preferenceKey: CONTEXT_PREFERENCE_KEY,
    },
  )
}

if (!('Bun' in globalThis)) {
  test.describe('FUMA-032 Publication shell public-host acceptance', () => {
    test.use({ storageState: ANONYMOUS_STATE })

    test('hydrates the public Web and reveals the exact Publication editor shell', async ({ page, context }) => {
      const publicPage = await context.newPage()
      const publicResponse = await publicPage.goto(PUBLIC_BASE_URL)
      expect(publicResponse?.ok()).toBe(true)
      await expect(publicPage.getByRole('heading', { name: 'Set Up CMS' })).toBeVisible()
      await expect(publicPage.getByRole('main')).toBeVisible()
      await publicPage.close()

      await page.setViewportSize({ width: 390, height: 844 })
      await mount(page, {
        pathname: scopedPath(),
        contextCatalog: catalog(),
        persona: 'editor',
      })
      await expect(page.getByText('Blog, magazine, newsletter, or newsroom')).toBeVisible()
      const navigation = page.getByRole('navigation', { name: 'Publication navigation' })
      await expect(navigation.getByRole('link', { name: 'Design' })).toBeHidden()
      const editorSummary = navigation.getByText('Editor')
      await editorSummary.focus()
      await expect(editorSummary).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(navigation.getByRole('link', { name: 'Design' })).toBeVisible()
      expect(await navigation.getByRole('link', { includeHidden: true }).allTextContents()).toEqual([
        'Home',
        'Posts',
        'Pages',
        'Tags',
        'Members',
        'Newsletters',
        'Analytics',
        'Design',
        'Settings',
      ])

      const skipLink = page.getByRole('link', { name: 'Skip to workspace' })
      await skipLink.focus()
      await expect(skipLink).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator('#fuma-scoped-main')).toBeFocused()

      const navigationBox = await navigation.boundingBox()
      const mainBox = await page.locator('#fuma-scoped-main').boundingBox()
      expect(navigationBox).not.toBeNull()
      expect(mainBox).not.toBeNull()
      expect(navigationBox!.x + navigationBox!.width).toBeLessThanOrEqual(390)
      expect(mainBox!.x + mainBox!.width).toBeLessThanOrEqual(390)

      await navigation.getByRole('link', { name: 'Design' }).click()
      await expect(page.getByTestId('route-pathname')).toHaveText(scopedPath('/design'))
      await expect(page.getByRole('region', { name: 'Design editor surface' }))
        .toHaveAttribute('data-editor-access', 'read-only')
      await expect(page.getByText('Read only')).toBeVisible()
    })

    test('keeps editor/viewer mutations and direct-route denial capability driven', async ({ page }) => {
      await mount(page, {
        pathname: scopedPath('/pages'),
        contextCatalog: catalog(),
        persona: 'editor',
      })
      await expect(page.getByRole('region', { name: 'Pages editor surface' }))
        .toHaveAttribute('data-editor-access', 'mutable')

      await mount(page, {
        pathname: scopedPath('/pages'),
        contextCatalog: catalog(),
        persona: 'viewer',
      })
      await expect(page.getByRole('region', { name: 'Pages editor surface' }))
        .toHaveAttribute('data-editor-access', 'read-only')

      await mount(page, {
        pathname: scopedPath('/posts'),
        contextCatalog: catalog(),
        persona: 'viewer',
        deniedPermissions: ['publication.posts.read'],
      })
      await expect(page.getByRole('alert')).toContainText('Route access unavailable')
      await expect(page.getByTestId('publication-route-content')).toHaveCount(0)

      await mount(page, {
        pathname: scopedPath('/posts'),
        contextCatalog: catalog('website'),
        persona: 'viewer',
      })
      await expect(page.locator('[data-route-access="capability-disabled"]')).toBeVisible()
      await expect(page.getByTestId('publication-route-content')).toHaveCount(0)
    })
  })
}
