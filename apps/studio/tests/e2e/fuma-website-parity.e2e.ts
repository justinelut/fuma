import { expect, test } from '@playwright/test'
import {
  ANONYMOUS_STATE,
  canvasFrame,
  createPage,
  insertModuleViaPicker,
  insertNotchModule,
  login,
  openSiteEditor,
  openSitePanel,
  publishDraft,
  saveDraft,
  setPropValue,
  visitPublicPage,
} from './helpers'

/**
 * FUMA-019 — preserve the complete Website authoring journey while hosted
 * context and profile composition evolve around it. These scenarios exercise
 * the current Website product directly; they do not mount or bypass through a
 * hosted organization/workspace/site shell.
 */
test.describe('FUMA-019 Website parity', () => {
  test.use({ storageState: ANONYMOUS_STATE })

  test('authors, persists, and publishes a clean Website page', async ({
    page,
    browser,
  }) => {
    const suffix = `${Date.now().toString(36)}-${test.info().workerIndex.toString(36)}`
    const name = `Website Parity ${suffix}`
    const slug = `website-parity-${suffix}`
    const headline = `Website parity headline ${suffix}`
    const ctaLabel = `Website parity action ${suffix}`
    const ctaTarget = `https://example.com/website-parity-${suffix}`

    await login(page)
    await openSiteEditor(page)

    await test.step('create an isolated page and edit real Website modules', async () => {
      await createPage(page, name, slug)
      const pageItem = page.getByRole('treeitem', { name: `Open page ${name}` })
      await pageItem.click()
      await expect(pageItem).toHaveAttribute('aria-selected', 'true')

      await insertNotchModule(page, 'text')
      await setPropValue(page, 'text', headline)

      await insertModuleViaPicker(page, 'base.button')
      await setPropValue(page, 'label', ctaLabel)
      await setPropValue(page, 'href', ctaTarget)

      const frame = canvasFrame(page)
      await expect(frame.getByText(headline, { exact: true })).toBeVisible()
      await expect(frame.getByRole('link', { name: ctaLabel })).toHaveAttribute(
        'href',
        ctaTarget,
      )
    })

    await test.step('save and reload the draft to prove persistence', async () => {
      await saveDraft(page)
      await page.reload()
      await openSiteEditor(page)
      await openSitePanel(page)

      const pageItem = page.getByRole('treeitem', { name: `Open page ${name}` })
      await pageItem.click()
      await expect(pageItem).toHaveAttribute('aria-selected', 'true')

      const frame = canvasFrame(page)
      await expect(frame.getByText(headline, { exact: true })).toBeVisible()
      await expect(frame.getByRole('link', { name: ctaLabel })).toHaveAttribute(
        'href',
        ctaTarget,
      )
    })

    await test.step('publish through the existing step-up-aware helper', async () => {
      await publishDraft(page)
    })

    await test.step('serve semantic public output without editor chrome', async () => {
      await visitPublicPage(browser, {
        path: `/${slug}`,
        visibleText: [headline, ctaLabel],
        assert: async (visitor) => {
          await expect(
            visitor.getByRole('link', { name: ctaLabel }),
          ).toHaveAttribute('href', ctaTarget)
          await expect(
            visitor.locator('[data-node-id], [data-module-id], [data-testid]'),
          ).toHaveCount(0)
        },
      })
    })
  })

  test('keeps current Website setup surfaces reachable on unscoped admin routes', async ({
    page,
  }) => {
    await login(page)
    await openSiteEditor(page)

    await test.step('reach Pages and Design in the existing visual editor', async () => {
      await expect(page).toHaveURL(/\/admin\/site$/)
      await openSitePanel(page)
      await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
      await expect(page.getByRole('tree', { name: 'Pages' })).toBeVisible()

      const design = page.getByRole('tab', { name: 'Design' })
      await design.click()
      await expect(design).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('canvas-root')).toBeVisible()
    })

    await test.step('reach Content through the current admin navigation', async () => {
      await page
        .getByTestId('toolbar')
        .getByRole('link', { name: 'Content', exact: true })
        .click()
      await expect(page).toHaveURL(/\/admin\/content$/)
      await expect(page.getByTestId('content-explorer-panel')).toBeVisible({
        timeout: 20_000,
      })
    })

    await test.step('reach Data through the current admin navigation', async () => {
      await page
        .getByTestId('toolbar')
        .getByRole('link', { name: 'Data', exact: true })
        .click()
      await expect(page).toHaveURL(/\/admin\/data$/)
      await expect(page.getByTestId('data-left-sidebar')).toBeVisible({
        timeout: 20_000,
      })
    })

    await test.step('reach Media through the current admin navigation', async () => {
      await page
        .getByTestId('toolbar')
        .getByRole('link', { name: 'Media', exact: true })
        .click()
      await expect(page).toHaveURL(/\/admin\/media$/)
      await expect(page.getByTestId('media-canvas')).toBeVisible({
        timeout: 20_000,
      })
    })

    await test.step('reach Website Settings without a hosted context shortcut', async () => {
      await page.getByTestId('toolbar-settings-btn').click()
      const dialog = page.getByRole('dialog', { name: 'Settings' })
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByRole('region', { name: 'General' }).getByLabel('Site Name'),
      ).toBeVisible({ timeout: 20_000 })
      expect(new URL(page.url()).pathname).toBe('/admin/media')
    })
  })
})
