import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ANONYMOUS_STATE } from './helpers'

const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL
  ?? 'https://5174.blyss.co.ke'
const PUBLIC_BASE_URL = process.env.E2E_PUBLIC_BASE_URL
  ?? 'https://3002.blyss.co.ke'
const STUDIO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const HARNESS_ENTRY = fileURLToPath(
  new URL('./fixtures/fumaEditorMultisiteHarness.ts', import.meta.url),
)
const PREVIEW_HARNESS_PATH = '/tests/e2e/fixtures/fuma-context-harness.html'

async function browserHarnessBundle(): Promise<string> {
  const result = await build({
    absWorkingDir: STUDIO_ROOT,
    alias: {
      '@core': path.join(STUDIO_ROOT, 'src/core'),
    },
    bundle: true,
    entryPoints: [HARNESS_ENTRY],
    format: 'iife',
    logLevel: 'silent',
    platform: 'browser',
    target: ['es2022'],
    write: false,
  })
  const output = result.outputFiles[0]
  if (!output) throw new Error('FUMA editor multisite harness bundle is empty')
  return output.text
}

async function mountHarness(
  page: Page,
  bundle: string,
  resetMultisite = false,
): Promise<void> {
  const url = new URL(PREVIEW_HARNESS_PATH, ADMIN_BASE_URL)
  url.searchParams.set('publicOrigin', new URL(PUBLIC_BASE_URL).origin)
  if (resetMultisite) url.searchParams.set('resetMultisite', '1')

  await page.goto(url.href)
  await page.addScriptTag({ content: bundle })
  await expect(page.getByTestId('harness-status')).toHaveText('ready')
  await expect(page.getByTestId('public-origin')).toHaveText(
    new URL(PUBLIC_BASE_URL).origin,
  )
}

async function openTarget(
  page: Page,
  profile: 'Website' | 'Publication',
): Promise<void> {
  await page.getByTestId(`target-${profile.toLowerCase()}`).click()
  await expect(page.getByTestId('target-profile')).toHaveText(profile)
  await expect(page.getByTestId('load-state')).toHaveText('ready')
}

async function editUndoImportSaveReload(
  page: Page,
  profile: 'Website' | 'Publication',
): Promise<string> {
  const firstTitle = `${profile} independent first edit`
  const secondTitle = `${profile} independent second edit`
  const input = page.getByLabel('Next page title')

  await input.fill(firstTitle)
  await page.getByTestId('edit-document').click()
  await expect(page.getByTestId('page-title')).toHaveText(firstTitle)
  await expect(page.getByTestId('undo-depth')).toHaveText('1')

  await input.fill(secondTitle)
  await page.getByTestId('edit-document').click()
  await expect(page.getByTestId('undo-depth')).toHaveText('2')

  await page.getByTestId('undo-document').click()
  await expect(page.getByTestId('page-title')).toHaveText(firstTitle)
  await expect(page.getByTestId('undo-depth')).toHaveText('1')
  await expect(page.getByTestId('redo-depth')).toHaveText('1')

  const importedTitle = `${firstTitle} + imported`
  await page.getByTestId('import-document').click()
  await expect(page.getByTestId('page-title')).toHaveText(importedTitle)
  await expect(page.getByTestId('import-state')).toHaveText('succeeded')
  await expect(page.getByTestId('dirty-state')).toHaveText('true')
  await expect(page.getByTestId('undo-depth')).toHaveText('2')
  await expect(page.getByTestId('redo-depth')).toHaveText('0')

  await page.getByTestId('save-document').click()
  await expect(page.getByTestId('save-state')).toHaveText('saved')
  await expect(page.getByTestId('dirty-state')).toHaveText('false')

  await page.getByTestId('reload-document').click()
  await expect(page.getByTestId('load-state')).toHaveText('ready')
  await expect(page.getByTestId('page-title')).toHaveText(importedTitle)
  await expect(page.getByTestId('undo-depth')).toHaveText('0')
  await expect(page.getByTestId('import-state')).toHaveText('idle')
  return importedTitle
}

if (!('Bun' in globalThis)) {
  test.describe('FUMA-027 browser multisite editor acceptance', () => {
    test.use({ storageState: ANONYMOUS_STATE })

    test('isolates colliding Website and Publication sessions across two tabs', async ({
      page: websiteTab,
      context,
      request,
    }) => {
      const publicHealth = await request.get(new URL('/health', PUBLIC_BASE_URL).href)
      expect(publicHealth.ok()).toBe(true)

      const bundle = await browserHarnessBundle()
      await mountHarness(websiteTab, bundle, true)
      const publicationTab = await context.newPage()
      await mountHarness(publicationTab, bundle)

      await openTarget(websiteTab, 'Website')
      await openTarget(publicationTab, 'Publication')

      await test.step('prove fully-qualified targets isolate colliding IDs', async () => {
        for (const tab of [websiteTab, publicationTab]) {
          await expect(tab.getByTestId('workspace-id')).toHaveText('workspace-collision')
          await expect(tab.getByTestId('site-id')).toHaveText('site-collision')
          await expect(tab.getByTestId('page-id')).toHaveText('page-collision')
        }
        await expect(websiteTab.getByTestId('target-organization')).toHaveText(
          'organization-website',
        )
        await expect(publicationTab.getByTestId('target-organization')).toHaveText(
          'organization-publication',
        )
      })

      let websiteTitle = ''
      let publicationTitle = ''
      await test.step('keep edit, undo, import, save, and reload state tab-local', async () => {
        websiteTitle = await editUndoImportSaveReload(websiteTab, 'Website')
        await expect(publicationTab.getByTestId('page-title')).toHaveText(
          'Publication home',
        )
        await expect(publicationTab.getByTestId('undo-depth')).toHaveText('0')

        publicationTitle = await editUndoImportSaveReload(
          publicationTab,
          'Publication',
        )
        await expect(websiteTab.getByTestId('page-title')).toHaveText(websiteTitle)
        await expect(websiteTab.getByTestId('undo-depth')).toHaveText('0')
      })

      await test.step('switch cleanly without cross-target persistence bleed', async () => {
        await openTarget(websiteTab, 'Publication')
        await expect(websiteTab.getByTestId('page-title')).toHaveText(publicationTitle)
        await expect(websiteTab.getByTestId('dirty-state')).toHaveText('false')

        await openTarget(websiteTab, 'Website')
        await expect(websiteTab.getByTestId('page-title')).toHaveText(websiteTitle)
        await expect(websiteTab.getByTestId('dirty-state')).toHaveText('false')

        await openTarget(publicationTab, 'Website')
        await expect(publicationTab.getByTestId('page-title')).toHaveText(websiteTitle)
        await openTarget(publicationTab, 'Publication')
        await expect(publicationTab.getByTestId('page-title')).toHaveText(publicationTitle)
      })

      await test.step('reject a delayed stale Website load after switching away', async () => {
        await mountHarness(publicationTab, bundle)
        await openTarget(publicationTab, 'Publication')
        await expect(publicationTab.getByTestId('page-title')).toHaveText(publicationTitle)

        await publicationTab.getByTestId('arm-website-delay').click()
        await expect(publicationTab.getByTestId('delayed-status')).toHaveText('armed')
        await publicationTab.getByTestId('target-website').click()
        await expect(publicationTab.getByTestId('target-profile')).toHaveText('Website')
        await expect(publicationTab.getByTestId('load-state')).toHaveText('loading')

        await publicationTab.getByTestId('target-publication').click()
        await expect(publicationTab.getByTestId('target-profile')).toHaveText('Publication')
        await expect(publicationTab.getByTestId('page-title')).toHaveText(publicationTitle)

        await publicationTab.getByTestId('resolve-website-delay').click()
        await expect(publicationTab.getByTestId('delayed-status')).toHaveText('resolved')
        await expect(publicationTab.getByTestId('target-profile')).toHaveText('Publication')
        await expect(publicationTab.getByTestId('page-title')).toHaveText(publicationTitle)

        await openTarget(publicationTab, 'Website')
        await expect(publicationTab.getByTestId('page-title')).toHaveText(websiteTitle)
        await expect(publicationTab.getByTestId('page-title')).not.toHaveText(
          'STALE WEBSITE LOAD',
        )
      })
    })
  })
}
