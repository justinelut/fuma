import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FumaScopedShell } from '@admin/fuma'
import { MemoryRouter } from '@admin/lib/routing'
import {
  LAUNCH_PROFILES,
  buildScopedAdminUrl,
  fumaLaunchRegistry,
  type AccessibleContextCatalog,
  type CapabilityOverrides,
  type FumaRegistry,
  type NavigationPermissionState,
  type StableContextSelection,
} from '@core/fuma'
import {
  FUMA_EXTENSION_CAPABILITY,
  FUMA_EXTENSION_CAPABILITY_GRANT,
  FUMA_EXTENSION_PROFILE,
  fumaExtensionRegistry,
} from '../helpers/fuma'

const EMPTY_OVERRIDES: CapabilityOverrides = Object.freeze({ grant: [], revoke: [] })

const WEBSITE_PARITY_MATRIX = [
  {
    concept: 'pages',
    currentBaseline: 'Pages panel in the visual editor at /admin/site',
    capabilityId: 'content.pages',
    navigationId: null,
    routeIds: ['route.pages.list', 'route.pages.write'],
    permissionIds: ['content.pages.read', 'content.pages.write'],
    onboardingIds: ['onboarding.pages'],
    starterTemplateIds: ['starter.pages'],
    jobIds: ['job.website-publish'],
    transferIds: ['transfer.pages'],
    e2eStep: 'reach Pages and Design in the existing visual editor',
  },
  {
    concept: 'content',
    currentBaseline: 'Content workspace at /admin/content',
    capabilityId: 'website.content',
    navigationId: null,
    routeIds: ['route.content'],
    permissionIds: ['website.content.read'],
    onboardingIds: [],
    starterTemplateIds: [],
    jobIds: [],
    transferIds: [],
    e2eStep: 'reach Content through the current admin navigation',
  },
  {
    concept: 'data',
    currentBaseline: 'Data workspace at /admin/data',
    capabilityId: 'website.data',
    navigationId: null,
    routeIds: ['route.data'],
    permissionIds: ['website.data.read'],
    onboardingIds: [],
    starterTemplateIds: [],
    jobIds: [],
    transferIds: [],
    e2eStep: 'reach Data through the current admin navigation',
  },
  {
    concept: 'media',
    currentBaseline: 'Media workspace at /admin/media',
    capabilityId: 'website.media',
    navigationId: null,
    routeIds: ['route.media'],
    permissionIds: ['website.media.read'],
    onboardingIds: ['onboarding.media'],
    starterTemplateIds: [],
    jobIds: [],
    transferIds: [],
    e2eStep: 'reach Media through the current admin navigation',
  },
  {
    concept: 'design',
    currentBaseline: 'Design tab in the visual editor at /admin/site',
    capabilityId: 'website.design',
    navigationId: null,
    routeIds: ['route.builder'],
    permissionIds: ['website.design.read', 'website.design.write'],
    onboardingIds: ['onboarding.design'],
    starterTemplateIds: ['starter.website'],
    jobIds: [],
    transferIds: ['transfer.design'],
    e2eStep: 'reach Pages and Design in the existing visual editor',
  },
  {
    concept: 'settings',
    currentBaseline: 'Settings dialog opened from the current admin workspace',
    capabilityId: 'site.settings',
    navigationId: 'nav.settings',
    routeIds: ['route.settings'],
    permissionIds: ['site.settings.read', 'site.settings.write'],
    onboardingIds: ['onboarding.identity'],
    starterTemplateIds: [],
    jobIds: [
      'job.transfer-execute',
      'job.transfer-resume',
      'job.transfer-compensate',
    ],
    transferIds: ['transfer.settings'],
    e2eStep: 'reach Website Settings without a hosted context shortcut',
  },
] as const

const WEBSITE_PROFILE_EXPECTATIONS = {
  capabilities: [
    'site.home',
    'website.content',
    'content.pages',
    'website.data',
    'website.media',
    'website.analytics',
    'website.design',
    'site.settings',
  ],
  navigation: [
    { id: 'nav.home', order: 10, label: 'Dashboard', path: '/admin' },
    {
      id: 'nav.builder',
      order: 15,
      label: 'Design',
      path: '/admin/builder',
      permission: 'website.design.read',
    },
    {
      id: 'nav.website-analytics',
      order: 60,
      label: 'Analytics',
      path: '/admin/analytics',
      permission: 'website.analytics.read',
    },
    {
      id: 'nav.domains',
      order: 85,
      label: 'Domains',
      path: '/admin/settings/domains',
      permission: 'site.settings.read',
    },
    {
      id: 'nav.team',
      order: 86,
      label: 'Organization & team',
      path: '/admin/settings/team',
      permission: 'site.settings.read',
    },
    {
      id: 'nav.settings',
      order: 90,
      label: 'Settings',
      path: '/admin/settings',
      permission: 'site.settings.read',
    },
  ],
  onboarding: [
    {
      id: 'onboarding.identity',
      order: 10,
      title: 'Name the site',
      description: 'Set the site identity and basic settings.',
    },
    {
      id: 'onboarding.design',
      order: 20,
      title: 'Choose a design',
      description: 'Start from a clean visual design preset.',
    },
    {
      id: 'onboarding.pages',
      order: 30,
      title: 'Create a page',
      description: 'Create the first reusable page in this site.',
    },
    {
      id: 'onboarding.media',
      order: 40,
      title: 'Add media',
      description: 'Upload reusable images and documents.',
    },
  ],
  starterTemplates: [
    {
      id: 'starter.website',
      order: 20,
      label: 'Website',
      templateId: 'website.blank',
    },
    {
      id: 'starter.pages',
      order: 30,
      label: 'Pages',
      templateId: 'pages.blank',
    },
  ],
  permissions: [
    {
      id: 'site.home.read',
      label: 'View home',
      description: 'View the site home and status surface.',
    },
    {
      id: 'website.content.read',
      label: 'View content',
      description: 'View structured website content.',
    },
    {
      id: 'content.pages.read',
      label: 'View pages',
      description: 'View site pages.',
    },
    {
      id: 'content.pages.write',
      label: 'Edit pages',
      description: 'Create and edit site pages.',
    },
    {
      id: 'website.data.read',
      label: 'View data',
      description: 'View structured site data.',
    },
    {
      id: 'website.media.read',
      label: 'View media',
      description: 'View site media.',
    },
    {
      id: 'website.analytics.read',
      label: 'View analytics',
      description: 'View website activity summaries.',
    },
    {
      id: 'website.design.read',
      label: 'View design',
      description: 'View the visual design workspace.',
    },
    {
      id: 'website.design.write',
      label: 'Edit design',
      description: 'Edit templates, styles, and layouts.',
    },
    {
      id: 'site.settings.read',
      label: 'View settings',
      description: 'View site settings.',
    },
    {
      id: 'site.settings.write',
      label: 'Edit settings',
      description: 'Edit site settings.',
    },
  ],
  routes: [
    {
      id: 'route.home',
      method: 'GET',
      path: '/admin',
      permission: 'site.home.read',
    },
    {
      id: 'route.content',
      method: 'GET',
      path: '/admin/content',
      permission: 'website.content.read',
    },
    {
      id: 'route.pages.list',
      method: 'GET',
      path: '/admin/pages',
      permission: 'content.pages.read',
    },
    {
      id: 'route.pages.write',
      method: 'POST',
      path: '/admin/pages',
      permission: 'content.pages.write',
    },
    {
      id: 'route.data',
      method: 'GET',
      path: '/admin/data',
      permission: 'website.data.read',
    },
    {
      id: 'route.media',
      method: 'GET',
      path: '/admin/media',
      permission: 'website.media.read',
    },
    {
      id: 'route.website-analytics',
      method: 'GET',
      path: '/admin/analytics',
      permission: 'website.analytics.read',
    },
    {
      id: 'route.builder',
      method: 'GET',
      path: '/admin/builder',
      permission: 'website.design.read',
    },
    {
      id: 'route.settings',
      method: 'GET',
      path: '/admin/settings',
      permission: 'site.settings.read',
    },
  ],
} as const

const EXTENSION_CONTRIBUTION_IDS = {
  capability: 'fixture.content-review',
  navigation: 'nav.fixture-content-review',
  onboarding: 'onboarding.fixture-content-review',
  starterTemplate: 'starter.fixture-content-review',
  permission: 'fixture.content-review.read',
  route: 'route.fixture-content-review',
  job: 'job.fixture-content-review',
  transfer: 'transfer.fixture-content-review',
} as const

const SHELL_SELECTION: StableContextSelection = Object.freeze({
  organizationId: 'parity-organization',
  workspaceId: 'parity-workspace',
  siteId: 'parity-website',
})

function contributionIds(
  values: readonly { readonly id: string }[] | undefined,
): string[] {
  return (values ?? []).map(({ id }) => id)
}

function contributionsWithIds<T extends { readonly id: string }>(
  values: readonly T[],
  ids: readonly string[],
): T[] {
  const expectedIds = new Set(ids)
  return values.filter(({ id }) => expectedIds.has(id))
}

function grantedPermissions(
  registry: FumaRegistry,
  overrides: CapabilityOverrides,
): NavigationPermissionState {
  return Object.fromEntries(
    registry.compose('website', overrides).permissions.map(({ id }) => [id, true]),
  )
}

function shellCatalog(
  capabilityOverrides: CapabilityOverrides,
): AccessibleContextCatalog {
  return {
    organizations: [{
      id: SHELL_SELECTION.organizationId,
      name: 'Parity Organization',
      status: 'active',
    }],
    workspaces: [{
      id: SHELL_SELECTION.workspaceId,
      organizationId: SHELL_SELECTION.organizationId,
      name: 'Parity Workspace',
      status: 'active',
      isDefault: true,
    }],
    sites: [{
      id: SHELL_SELECTION.siteId,
      organizationId: SHELL_SELECTION.organizationId,
      workspaceId: SHELL_SELECTION.workspaceId,
      name: 'Parity Website',
      status: 'active',
      profileId: 'website',
      capabilityOverrides,
    }],
  }
}

function renderWebsiteShell(
  registry: FumaRegistry,
  capabilityOverrides: CapabilityOverrides,
): string {
  const pathname = buildScopedAdminUrl(SHELL_SELECTION, '/admin/builder')
  const shell = createElement(FumaScopedShell, {
    catalog: shellCatalog(capabilityOverrides),
    pathname,
    actorLabel: 'Parity Editor',
    permissionState: grantedPermissions(registry, capabilityOverrides),
    registry,
    switcherSlot: null,
    children: createElement('p', null, 'Website route body'),
  })

  return renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: [pathname],
    children: shell,
  }))
}

describe('FUMA-019 Website parity integration', () => {
  it('maps every current Website builder concept to its exact launch registration', () => {
    const website = fumaLaunchRegistry.compose('website')
    const launchProfile = LAUNCH_PROFILES.find(({ id }) => id === 'website')
    if (!launchProfile) throw new Error('Website launch profile is unavailable')

    expect(launchProfile.capabilityPreset).toEqual(
      expect.arrayContaining(WEBSITE_PROFILE_EXPECTATIONS.capabilities),
    )
    expect(launchProfile.navigationPreset).toEqual(
      expect.arrayContaining(WEBSITE_PROFILE_EXPECTATIONS.navigation.map(({ id }) => id)),
    )
    expect(launchProfile.onboardingPreset).toEqual(
      WEBSITE_PROFILE_EXPECTATIONS.onboarding.map(({ id }) => id),
    )
    expect(launchProfile.starterTemplatePreset).toEqual(
      WEBSITE_PROFILE_EXPECTATIONS.starterTemplates.map(({ id }) => id),
    )
    expect(website.capabilities.map(({ id }) => id)).toEqual(
      expect.arrayContaining(WEBSITE_PROFILE_EXPECTATIONS.capabilities),
    )
    expect(website.navigation).toEqual(expect.arrayContaining(WEBSITE_PROFILE_EXPECTATIONS.navigation))
    expect(website.onboarding).toEqual(WEBSITE_PROFILE_EXPECTATIONS.onboarding)
    expect(website.starterTemplates).toEqual(
      WEBSITE_PROFILE_EXPECTATIONS.starterTemplates,
    )
    expect(website.permissions).toEqual(expect.arrayContaining(WEBSITE_PROFILE_EXPECTATIONS.permissions))
    expect(website.routes).toEqual(expect.arrayContaining(WEBSITE_PROFILE_EXPECTATIONS.routes))

    for (const row of WEBSITE_PARITY_MATRIX) {
      const capability = website.capabilities.find(({ id }) => id === row.capabilityId)
      expect(capability, `${row.concept}: ${row.currentBaseline}`).toBeDefined()
      if (!capability) throw new Error(`Missing Website capability ${row.capabilityId}`)

      expect(capability.navigation ?? []).toEqual(
        expect.arrayContaining(contributionsWithIds(
          WEBSITE_PROFILE_EXPECTATIONS.navigation,
          row.navigationId === null ? [] : [row.navigationId],
        )),
      )
      expect(capability.routes ?? []).toEqual(
        expect.arrayContaining(contributionsWithIds(WEBSITE_PROFILE_EXPECTATIONS.routes, row.routeIds)),
      )
      expect(capability.permissions ?? []).toEqual(
        expect.arrayContaining(contributionsWithIds(WEBSITE_PROFILE_EXPECTATIONS.permissions, row.permissionIds)),
      )
      expect(capability.onboarding ?? []).toEqual(
        contributionsWithIds(WEBSITE_PROFILE_EXPECTATIONS.onboarding, row.onboardingIds),
      )
      expect(capability.starterTemplates ?? []).toEqual(
        contributionsWithIds(
          WEBSITE_PROFILE_EXPECTATIONS.starterTemplates,
          row.starterTemplateIds,
        ),
      )
      expect(contributionIds(capability.jobs)).toEqual(expect.arrayContaining([...row.jobIds]))
      expect(contributionIds(capability.transfer)).toEqual(expect.arrayContaining([...row.transferIds]))
    }
  })

  it('pins Website publishing and transfer metadata without treating it as execution', () => {
    const website = fumaLaunchRegistry.compose('website')

    expect(website.routes.filter(({ id }) => id.startsWith('route.pages.'))).toEqual([
      {
        id: 'route.pages.list',
        method: 'GET',
        path: '/admin/pages',
        permission: 'content.pages.read',
      },
      {
        id: 'route.pages.write',
        method: 'POST',
        path: '/admin/pages',
        permission: 'content.pages.write',
      },
    ])
    expect(website.jobs).toEqual(expect.arrayContaining([
      {
        id: 'job.website-publish',
        handlerId: 'website.publish',
        permission: 'content.pages.write',
      },
      {
        id: 'job.transfer-execute',
        handlerId: 'transfer.execute',
        permission: 'site.settings.write',
      },
      {
        id: 'job.transfer-resume',
        handlerId: 'transfer.resume',
        permission: 'site.settings.write',
      },
      {
        id: 'job.transfer-compensate',
        handlerId: 'transfer.compensate',
        permission: 'site.settings.write',
      },
    ]))
    expect(website.transfer).toEqual(expect.arrayContaining([
      {
        id: 'transfer.pages',
        stepId: 'transfer.content.pages',
        permission: 'content.pages.write',
      },
      {
        id: 'transfer.design',
        stepId: 'transfer.design.assets',
        permission: 'website.design.write',
      },
      {
        id: 'transfer.settings',
        stepId: 'transfer.site.settings',
        permission: 'site.settings.write',
      },
    ]))
  })

  it('keeps the self-hosted editor E2E as the behavioral source for every matrix row', async () => {
    const e2eSource = await Bun.file(new URL(
      '../../../tests/e2e/fuma-website-parity.e2e.ts',
      import.meta.url,
    )).text()

    expect(e2eSource).toContain("test.describe('FUMA-019 Website parity'")
    expect(e2eSource).toContain('authors, persists, and publishes a clean Website page')
    expect(e2eSource).toContain('keeps current Website setup surfaces reachable on unscoped admin routes')
    for (const row of WEBSITE_PARITY_MATRIX) {
      expect(e2eSource, `${row.concept}: ${row.currentBaseline}`).toContain(row.e2eStep)
    }
  })

  it('adds extension contributions by registration while preserving Website bytes and structure', () => {
    const launchWebsite = fumaLaunchRegistry.compose('website')
    const launchSnapshot = structuredClone(launchWebsite)
    const launchBytes = JSON.stringify(launchWebsite)

    const registeredWebsite = fumaExtensionRegistry.compose('website')
    expect(registeredWebsite).toEqual(launchSnapshot)
    expect(JSON.stringify(registeredWebsite)).toBe(launchBytes)

    const extensionProfile = fumaExtensionRegistry.compose(FUMA_EXTENSION_PROFILE.id)
    const grantedWebsite = fumaExtensionRegistry.compose(
      'website',
      FUMA_EXTENSION_CAPABILITY_GRANT,
    )

    expect(FUMA_EXTENSION_CAPABILITY.id).toBe(EXTENSION_CONTRIBUTION_IDS.capability)
    for (const composition of [extensionProfile, grantedWebsite]) {
      expect(composition.capabilities.map(({ id }) => id))
        .toContain(EXTENSION_CONTRIBUTION_IDS.capability)
      expect(composition.navigation.map(({ id }) => id))
        .toContain(EXTENSION_CONTRIBUTION_IDS.navigation)
      expect(composition.onboarding.map(({ id }) => id))
        .toContain(EXTENSION_CONTRIBUTION_IDS.onboarding)
      expect(composition.starterTemplates.map(({ id }) => id))
        .toContain(EXTENSION_CONTRIBUTION_IDS.starterTemplate)
      expect(composition.permissions.map(({ id }) => id))
        .toContain(EXTENSION_CONTRIBUTION_IDS.permission)
      expect(composition.routes.map(({ id }) => id))
        .toContain(EXTENSION_CONTRIBUTION_IDS.route)
      expect(composition.jobs.map(({ id }) => id))
        .toContain(EXTENSION_CONTRIBUTION_IDS.job)
      expect(composition.transfer.map(({ id }) => id))
        .toContain(EXTENSION_CONTRIBUTION_IDS.transfer)
    }

    expect(fumaLaunchRegistry.compose('website')).toEqual(launchSnapshot)
    expect(JSON.stringify(fumaLaunchRegistry.compose('website'))).toBe(launchBytes)
  })

  it('composes the same scoped Website shell until the extension is explicitly granted', () => {
    const launchMarkup = renderWebsiteShell(fumaLaunchRegistry, EMPTY_OVERRIDES)
    const registeredBaselineMarkup = renderWebsiteShell(
      fumaExtensionRegistry,
      EMPTY_OVERRIDES,
    )
    const extendedMarkup = renderWebsiteShell(
      fumaExtensionRegistry,
      FUMA_EXTENSION_CAPABILITY_GRANT,
    )

    expect(registeredBaselineMarkup).toBe(launchMarkup)
    expect(launchMarkup).toContain('data-profile-id="website"')
    expect(launchMarkup).toContain('aria-label="Website navigation"')
    expect(launchMarkup).toContain(buildScopedAdminUrl(SHELL_SELECTION, '/admin/builder'))
    expect(launchMarkup).toContain('Create a page')
    expect(launchMarkup).not.toContain('Content review')
    expect(launchMarkup).not.toContain('Configure content review')

    expect(extendedMarkup).toContain('Content review')
    expect(extendedMarkup).toContain('Configure content review')
    expect(extendedMarkup).toContain(
      buildScopedAdminUrl(SHELL_SELECTION, '/admin/content-review'),
    )
  })
})
