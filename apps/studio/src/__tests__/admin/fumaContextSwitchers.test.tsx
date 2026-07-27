import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from '@admin/lib/routing'
import {
  FumaContextSwitchers,
  type FumaContextSwitchIntent,
} from '@admin/fuma'
import { fumaLaunchRegistry } from '@core/fuma'
import {
  buildOrganizationSwitchTarget,
  buildScopedAdminUrl,
  buildSiteSwitchTarget,
  buildWorkspaceSwitchTarget,
  resolveScopedAdminContext,
  type AccessibleContextCatalog,
  type ReadyScopedContextResolution,
  type StableContextSelection,
} from '@core/fuma'

const EMPTY_OVERRIDES = { grant: [], revoke: [] }

const ACACIA_WEBSITE: StableContextSelection = {
  organizationId: 'organization-acacia',
  workspaceId: 'shared-workspace',
  siteId: 'shared-website-site',
}

function catalog(): AccessibleContextCatalog {
  return {
    organizations: [
      { id: 'organization-acacia', name: 'Acacia', status: 'active' },
      { id: 'organization-baobab', name: 'Baobab', status: 'active' },
      { id: 'organization-suspended', name: 'Suspended organization', status: 'suspended' },
    ],
    workspaces: [
      {
        id: 'shared-workspace',
        organizationId: 'organization-acacia',
        name: 'Acacia main',
        status: 'active',
        isDefault: true,
      },
      {
        id: 'acacia-secondary',
        organizationId: 'organization-acacia',
        name: 'Acacia secondary',
        status: 'active',
        isDefault: false,
      },
      {
        id: 'acacia-archived',
        organizationId: 'organization-acacia',
        name: 'Archived workspace',
        status: 'archived',
        isDefault: false,
      },
      {
        id: 'shared-workspace',
        organizationId: 'organization-baobab',
        name: 'Baobab main',
        status: 'active',
        isDefault: false,
      },
      {
        id: 'baobab-default',
        organizationId: 'organization-baobab',
        name: 'Baobab default',
        status: 'active',
        isDefault: true,
      },
      {
        id: 'suspended-workspace',
        organizationId: 'organization-suspended',
        name: 'Suspended workspace',
        status: 'active',
        isDefault: true,
      },
    ],
    sites: [
      {
        id: ACACIA_WEBSITE.siteId,
        organizationId: ACACIA_WEBSITE.organizationId,
        workspaceId: ACACIA_WEBSITE.workspaceId,
        name: 'Acacia Website',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'shared-publication-site',
        organizationId: 'organization-acacia',
        workspaceId: 'shared-workspace',
        name: 'Acacia Publication',
        status: 'active',
        profileId: 'publication',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'archived-site',
        organizationId: 'organization-acacia',
        workspaceId: 'shared-workspace',
        name: 'Archived site',
        status: 'archived',
        profileId: 'website',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'secondary-site',
        organizationId: 'organization-acacia',
        workspaceId: 'acacia-secondary',
        name: 'Secondary site',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'shared-website-site',
        organizationId: 'organization-baobab',
        workspaceId: 'shared-workspace',
        name: 'Baobab Website',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'shared-publication-site',
        organizationId: 'organization-baobab',
        workspaceId: 'baobab-default',
        name: 'Baobab Publication',
        status: 'active',
        profileId: 'publication',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'suspended-site',
        organizationId: 'organization-suspended',
        workspaceId: 'suspended-workspace',
        name: 'Suspended site',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
    ],
  }
}

function readyContext(
  selection: StableContextSelection = ACACIA_WEBSITE,
  subpath = '/admin/design',
): ReadyScopedContextResolution {
  const resolution = resolveScopedAdminContext({
    url: buildScopedAdminUrl(selection, subpath),
    catalog: catalog(),
  }, fumaLaunchRegistry)
  if (resolution.kind !== 'ready') throw new Error('Expected a ready context fixture')
  return resolution
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current route">{location.pathname}</output>
}

function choose(label: string, option: string) {
  const combobox = screen.getByRole('combobox', { name: label })
  fireEvent.click(combobox.nextElementSibling as HTMLElement)
  fireEvent.click(screen.getByRole('option', { name: option }))
}

function renderSwitchers(
  context = readyContext(),
  onSwitch?: (intent: FumaContextSwitchIntent) => void,
) {
  return render(
    <MemoryRouter initialEntries={[buildScopedAdminUrl(
      context.selection,
      context.profileRelativeSubpath,
    )]}>
      <FumaContextSwitchers
        context={context}
        catalog={catalog()}
        onSwitch={onSwitch}
      />
      <LocationProbe />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('FUMA-018 organization/workspace/site switchers', () => {
  it('renders three labelled shared selects and scopes colliding lower IDs to the selected organization', () => {
    renderSwitchers()

    expect(screen.getByRole('region', {
      name: 'Organization, workspace, and site',
    })).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Organization' })).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Site' })).toBeDefined()

    choose('Workspace', 'Acacia main')
    expect(screen.queryByRole('option', { name: 'Baobab main' })).toBeNull()
  })

  it('uses canonical deterministic targets when organization or workspace changes', () => {
    const intents: FumaContextSwitchIntent[] = []
    const context = readyContext()
    const accessibleCatalog = catalog()
    renderSwitchers(context, (intent) => intents.push(intent))

    choose('Organization', 'Baobab')
    const organizationTarget = buildOrganizationSwitchTarget(
      accessibleCatalog,
      'organization-baobab',
      context.profileRelativeSubpath,
    )
    expect(organizationTarget).not.toBeNull()
    expect(intents[0]).toEqual({
      kind: 'organization',
      organizationId: 'organization-baobab',
      target: organizationTarget,
    })
    expect(screen.getByLabelText('Current route').textContent).toBe(organizationTarget)
    expect(organizationTarget).toContain('/workspaces/baobab-default/sites/shared-publication-site/design')

    choose('Workspace', 'Acacia secondary')
    const workspaceTarget = buildWorkspaceSwitchTarget(
      accessibleCatalog,
      'organization-acacia',
      'acacia-secondary',
      context.profileRelativeSubpath,
    )
    expect(intents[1]).toEqual({
      kind: 'workspace',
      organizationId: 'organization-acacia',
      workspaceId: 'acacia-secondary',
      target: workspaceTarget,
    })
    expect(screen.getByLabelText('Current route').textContent).toBe(workspaceTarget)
  })

  it('omits suspended and archived choices rather than allowing invalid switches', () => {
    renderSwitchers()

    const hiddenLabels = [
      ['Organization', 'Suspended organization'],
      ['Workspace', 'Archived workspace'],
      ['Site', 'Archived site'],
    ] as const
    for (const [selector, option] of hiddenLabels) {
      const combobox = screen.getByRole('combobox', { name: selector })
      fireEvent.click(combobox.nextElementSibling as HTMLElement)
      expect(screen.queryByRole('option', { name: option })).toBeNull()
      fireEvent.click(combobox.nextElementSibling as HTMLElement)
    }
  })

  it('switches Website and Publication sites in both directions while preserving the validated subpath', () => {
    const intents: FumaContextSwitchIntent[] = []
    const websiteContext = readyContext()
    const view = renderSwitchers(websiteContext, (intent) => intents.push(intent))

    choose('Site', 'Acacia Publication')
    const publicationSelection = {
      organizationId: 'organization-acacia',
      workspaceId: 'shared-workspace',
      siteId: 'shared-publication-site',
    }
    const publicationTarget = buildSiteSwitchTarget(
      publicationSelection,
      websiteContext.profileRelativeSubpath,
    )
    expect(intents[0]).toEqual({
      kind: 'site',
      ...publicationSelection,
      target: publicationTarget,
    })
    expect(publicationTarget).toEndWith('/design')

    const publicationContext = readyContext(publicationSelection)
    view.rerender(
      <MemoryRouter initialEntries={[publicationTarget]}>
        <FumaContextSwitchers
          context={publicationContext}
          catalog={catalog()}
          onSwitch={(intent) => intents.push(intent)}
        />
        <LocationProbe />
      </MemoryRouter>,
    )
    choose('Site', 'Acacia Website')
    const websiteTarget = buildSiteSwitchTarget(
      ACACIA_WEBSITE,
      publicationContext.profileRelativeSubpath,
    )
    expect(intents[1]).toEqual({
      kind: 'site',
      ...ACACIA_WEBSITE,
      target: websiteTarget,
    })
    expect(websiteTarget).toEndWith('/design')
  })

  it('keeps policy, persistence, raw controls, profile decisions, and manual memoization out of React', async () => {
    const source = await Bun.file(new URL(
      '../../admin/fuma/FumaContextSwitchers.tsx',
      import.meta.url,
    )).text()

    expect(source).not.toMatch(/localStorage|permission|capabilit/i)
    expect(source).not.toMatch(/<\s*(?:select|button|a)\b/)
    expect(source).not.toMatch(/useMemo|useCallback|memo\s*\(/)
    expect(source).not.toMatch(/['"](?:website|publication)['"]/)
    expect(source).not.toMatch(/profileId\s*(?:===|!==)|switch\s*\([^)]*profile/i)
  })
})
