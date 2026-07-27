import { expect, test, type Page } from '@playwright/test'
import type {
  FixtureCatalog,
  FumaContextHarnessInput,
} from './fixtures/fumaContextHarnessContract'
import { ANONYMOUS_STATE } from './helpers'

const CONTEXT_PREFERENCE_KEY = 'fuma-scoped-context-v1'
const EMPTY_OVERRIDES = { grant: [] as string[], revoke: [] as string[] }

function catalog(): FixtureCatalog {
  return {
    organizations: [
      { id: 'organization-a', name: 'Acacia', status: 'active' },
      { id: 'organization-b', name: 'Baobab', status: 'active' },
    ],
    workspaces: [
      { id: 'shared-workspace', organizationId: 'organization-a', name: 'Acacia Studio', status: 'active', isDefault: true },
      { id: 'shared-workspace', organizationId: 'organization-b', name: 'Baobab Studio', status: 'active', isDefault: true },
      { id: 'baobab-secondary', organizationId: 'organization-b', name: 'Baobab Secondary', status: 'active', isDefault: false },
    ],
    managedClients: [{
      organizationId: 'organization-a',
      workspaceId: 'shared-workspace',
      intendedOrganizationId: 'organization-provisional-client',
      intendedOrganizationName: 'Provisional Client',
    }],
    sites: [
      { id: 'shared-publication', organizationId: 'organization-a', workspaceId: 'shared-workspace', name: 'Acacia Publication', status: 'active', profileId: 'publication', capabilityOverrides: EMPTY_OVERRIDES },
      { id: 'shared-website', organizationId: 'organization-a', workspaceId: 'shared-workspace', name: 'Acacia Website', status: 'active', profileId: 'website', capabilityOverrides: EMPTY_OVERRIDES },
      { id: 'shared-publication', organizationId: 'organization-b', workspaceId: 'shared-workspace', name: 'Baobab Publication', status: 'active', profileId: 'publication', capabilityOverrides: EMPTY_OVERRIDES },
      { id: 'shared-website', organizationId: 'organization-b', workspaceId: 'shared-workspace', name: 'Baobab Website', status: 'active', profileId: 'website', capabilityOverrides: EMPTY_OVERRIDES },
      { id: 'secondary-publication', organizationId: 'organization-b', workspaceId: 'baobab-secondary', name: 'Baobab Secondary Publication', status: 'active', profileId: 'publication', capabilityOverrides: EMPTY_OVERRIDES },
      { id: 'secondary-website', organizationId: 'organization-b', workspaceId: 'baobab-secondary', name: 'Baobab Secondary Website', status: 'active', profileId: 'website', capabilityOverrides: EMPTY_OVERRIDES },
    ],
  }
}

function scopedPath(
  organizationId: string,
  siteId: string,
  suffix = '',
  workspaceId = 'shared-workspace',
): string {
  return `/admin/organizations/${organizationId}/workspaces/${workspaceId}/sites/${siteId}${suffix}`
}

async function mountScopedShell(
  page: Page,
  pathname: string,
  contextCatalog: FixtureCatalog,
  preference?: unknown,
): Promise<void> {
  await page.goto('/tests/e2e/fixtures/fuma-context-harness.html')
  await page.waitForFunction(() => typeof window.mountFumaContextHarness === 'function')
  await page.evaluate(
    (input: FumaContextHarnessInput) => window.mountFumaContextHarness(input),
    {
      pathname,
      contextCatalog,
      preference,
      preferenceKey: CONTEXT_PREFERENCE_KEY,
    },
  )
}

async function chooseContextOption(
  page: Page,
  label: 'Organization' | 'Workspace' | 'Site',
  option: string,
): Promise<void> {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

if (!('Bun' in globalThis)) {
  test.describe('FUMA-018 deterministic context switching', () => {
  test.use({ storageState: ANONYMOUS_STATE })

  test('keeps the explicit multi-organization deep link authoritative across refresh mounting', async ({ page }) => {
    const path = scopedPath('organization-b', 'shared-publication', '/posts')
    const stalePreference = {
      version: 1,
      selection: {
        organizationId: 'organization-a',
        workspaceId: 'shared-workspace',
        siteId: 'shared-website',
      },
    }

    await mountScopedShell(page, path, catalog(), stalePreference)
    await expect(page.getByRole('heading', { name: 'Baobab Publication' })).toBeVisible()
    await expect(page.getByTestId('route-pathname')).toHaveText(path)

    await page.reload()
    await mountScopedShell(page, path, catalog(), stalePreference)
    await expect(page.getByText('Baobab / Baobab Studio')).toBeVisible()
  })

  test('fails closed for unauthorized ownership substitution', async ({ page }) => {
    const accessibleCatalog = catalog()
    accessibleCatalog.workspaces.push({
      id: 'baobab-private',
      organizationId: 'organization-b',
      name: 'Baobab Private',
      status: 'active',
      isDefault: false,
    })
    accessibleCatalog.sites.push({
      id: 'private-site',
      organizationId: 'organization-b',
      workspaceId: 'baobab-private',
      name: 'Private Site',
      status: 'active',
      profileId: 'website',
      capabilityOverrides: EMPTY_OVERRIDES,
    })

    await mountScopedShell(
      page,
      '/admin/organizations/organization-a/workspaces/baobab-private/sites/private-site',
      accessibleCatalog,
    )
    await expect(page.getByText('Workspace access unavailable')).toBeVisible()
    await expect(page.getByRole('navigation')).toHaveCount(0)
  })

  test('surfaces organization suspension and workspace/site archive states', async ({ page }) => {
    const cases: Array<{
      title: string
      mutate: (value: FixtureCatalog) => void
    }> = [
      {
        title: 'Organization suspended',
        mutate(value) {
          value.organizations[0]!.status = 'suspended'
        },
      },
      {
        title: 'Workspace archived',
        mutate(value) {
          value.workspaces[0]!.status = 'archived'
        },
      },
      {
        title: 'Site archived',
        mutate(value) {
          const site = value.sites.find((entry) => (
            entry.organizationId === 'organization-a' && entry.id === 'shared-website'
          ))
          if (site) site.status = 'archived'
        },
      },
    ]

    for (const entry of cases) {
      const accessibleCatalog = catalog()
      entry.mutate(accessibleCatalog)
      await mountScopedShell(
        page,
        scopedPath('organization-a', 'shared-website'),
        accessibleCatalog,
      )
      await expect(page.getByText(entry.title)).toBeVisible()
    }
  })

  test('ignores stale browser preference and treats invitation entry as URL authority', async ({ page }) => {
    const stalePreference = {
      version: 1,
      selection: {
        organizationId: 'organization-b',
        workspaceId: 'shared-workspace',
        siteId: 'deleted-site',
      },
    }
    await mountScopedShell(page, '/admin', catalog(), stalePreference)
    await expect(page.getByRole('heading', { name: 'Acacia Publication' })).toBeVisible()

    const invitationId = 'invite/customer-editor-token'
    await mountScopedShell(
      page,
      `/admin/invitations/${encodeURIComponent(invitationId)}`,
      catalog(),
      stalePreference,
    )
    await expect(page.getByText('Invitation entry')).toBeVisible()
    await expect(page.getByText(invitationId)).toBeVisible()
    await expect(page.getByRole('navigation')).toHaveCount(0)
  })

  test('restores the last ready multi-organization selection from browser persistence', async ({ page }) => {
    await mountScopedShell(
      page,
      scopedPath('organization-a', 'shared-website', '/design'),
      catalog(),
      null,
    )

    await chooseContextOption(page, 'Organization', 'Baobab')
    await expect(page.getByTestId('route-pathname')).toHaveText(
      scopedPath('organization-b', 'shared-publication', '/design'),
    )
    await expect.poll(() => page.evaluate(
      (key) => localStorage.getItem(key),
      CONTEXT_PREFERENCE_KEY,
    )).toContain('"organizationId":"organization-b"')

    await page.reload()
    await mountScopedShell(page, '/admin', catalog())
    await expect(page.getByRole('heading', { name: 'Baobab Publication' })).toBeVisible()
    await expect(page.getByText('Baobab / Baobab Studio')).toBeVisible()
  })

  test('switches a fully qualified workspace and keeps the active route suffix', async ({ page }) => {
    await mountScopedShell(
      page,
      scopedPath('organization-b', 'shared-website', '/design'),
      catalog(),
      null,
    )

    await chooseContextOption(page, 'Workspace', 'Baobab Secondary')
    await expect(page.getByText('Publication profile')).toBeVisible()
    await expect(page.getByTestId('route-pathname')).toHaveText(
      scopedPath(
        'organization-b',
        'secondary-publication',
        '/design',
        'baobab-secondary',
      ),
    )
    await expect(page.getByText('Baobab / Baobab Secondary')).toBeVisible()
  })

  test('renders authorized managed-client workspaces without commercial operations', async ({ page }) => {
    await mountScopedShell(
      page,
      scopedPath('organization-a', 'shared-website', '/managed-clients'),
      catalog(),
    )

    await expect(page.getByRole('heading', { name: 'Managed clients' })).toBeVisible()
    await expect(page.getByText('Provisional Client')).toBeVisible()
    await expect(page.getByText(/do not change current ownership/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open site' })).toHaveCount(2)
    await expect(page.getByText(/offer|grant|billing|price/i)).toHaveCount(0)
  })

  test('switches Website and Publication profile shells without losing the route suffix', async ({ page }) => {
    await mountScopedShell(
      page,
      scopedPath('organization-a', 'shared-website', '/design'),
      catalog(),
    )
    await expect(page.getByText('Website profile')).toBeVisible()

    await chooseContextOption(page, 'Organization', 'Baobab')
    await expect(page.getByText('Publication profile')).toBeVisible()
    await expect(page.getByTestId('route-pathname')).toHaveText(
      scopedPath('organization-b', 'shared-publication', '/design'),
    )
    await expect(page.getByText('Baobab / Baobab Studio')).toBeVisible()

    await chooseContextOption(page, 'Site', 'Baobab Website')
    await expect(page.getByText('Website profile')).toBeVisible()
    await expect(page.getByTestId('route-pathname')).toHaveText(
      scopedPath('organization-b', 'shared-website', '/design'),
    )

    await chooseContextOption(page, 'Organization', 'Acacia')
    await expect(page.getByText('Publication profile')).toBeVisible()
    await expect(page.getByTestId('route-pathname')).toHaveText(
      scopedPath('organization-a', 'shared-publication', '/design'),
    )

    await chooseContextOption(page, 'Site', 'Acacia Website')
    await expect(page.getByText('Website profile')).toBeVisible()
  })
})
}
