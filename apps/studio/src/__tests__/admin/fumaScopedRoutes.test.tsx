import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import React from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import AdminEntry, { type AdminEntryProps } from '@admin/AdminEntry'
import {
  AdminRoutes,
  FUMA_INVITATION_ADMIN_ROUTE,
  FUMA_SCOPED_ADMIN_ROUTE,
  FUMA_SCOPED_ADMIN_SUBPATH_ROUTE,
} from '@admin/router'
import { HostedStaffShell } from '@admin/preauth/HostedStaffShell'
import type { HostedProfileEditorRenderAdapter } from '@admin/fuma/profileEditor/HostedProfileEditorSurface'
import {
  FUMA_CONTEXT_PREFERENCE_KEY,
  readContextPreference,
  writeContextPreference,
} from '@admin/fuma'
import { MemoryRouter, useLocation } from '@admin/lib/routing'
import {
  buildInvitationAdminUrl,
  buildScopedAdminUrl,
  fumaLaunchRegistry,
  type AccessibleContextCatalog,
  type NavigationPermissionState,
  type PermissionDecision,
  type StableContextSelection,
} from '@core/fuma'
import type { HostedStaffSession } from '@core/fuma/auth'

const originalFetch = globalThis.fetch
const now = '2026-07-24T20:00:00.000Z'
const EMPTY_OVERRIDES = { grant: [], revoke: [] }

const session: HostedStaffSession = {
  session: {
    id: 'session-current',
    userId: 'staff-1',
    expiresAt: '2026-08-24T20:00:00.000Z',
    createdAt: now,
    updatedAt: now,
  },
  user: {
    id: 'staff-1',
    name: 'Avery Editor',
    email: 'avery@fixture.invalid',
    emailVerified: true,
    image: null,
    role: 'member',
    banned: false,
    twoFactorEnabled: false,
    createdAt: now,
    updatedAt: now,
  },
}

function catalog(): AccessibleContextCatalog {
  return {
    organizations: [
      { id: 'organization-a', name: 'Acacia', status: 'active' },
      { id: 'organization-b', name: 'Baobab', status: 'active' },
    ],
    workspaces: [
      {
        id: 'shared-workspace',
        organizationId: 'organization-a',
        name: 'Acacia Studio',
        status: 'active',
        isDefault: true,
      },
      {
        id: 'shared-workspace',
        organizationId: 'organization-b',
        name: 'Baobab Studio',
        status: 'active',
        isDefault: true,
      },
    ],
    sites: [
      {
        id: 'shared-website',
        organizationId: 'organization-a',
        workspaceId: 'shared-workspace',
        name: 'Acacia Website',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'shared-publication',
        organizationId: 'organization-a',
        workspaceId: 'shared-workspace',
        name: 'Acacia Publication',
        status: 'active',
        profileId: 'publication',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'shared-website',
        organizationId: 'organization-b',
        workspaceId: 'shared-workspace',
        name: 'Baobab Website',
        status: 'active',
        profileId: 'website',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
      {
        id: 'shared-publication',
        organizationId: 'organization-b',
        workspaceId: 'shared-workspace',
        name: 'Baobab Publication',
        status: 'active',
        profileId: 'publication',
        capabilityOverrides: EMPTY_OVERRIDES,
      },
    ],
  }
}

function selection(
  organizationId: 'organization-a' | 'organization-b',
  profile: 'website' | 'publication',
): StableContextSelection {
  return {
    organizationId,
    workspaceId: 'shared-workspace',
    siteId: profile === 'website' ? 'shared-website' : 'shared-publication',
  }
}

function permissionAccess(denied: readonly string[] = []): Readonly<{
  permissionDecisions: readonly PermissionDecision[]
  permissionState: NavigationPermissionState
}> {
  const deniedIds = new Set(denied)
  const permissionIds = [...new Set([
    ...fumaLaunchRegistry.compose('website').permissions.map(({ id }) => id),
    ...fumaLaunchRegistry.compose('publication').permissions.map(({ id }) => id),
  ])]
  const permissionState = Object.freeze(Object.fromEntries(
    permissionIds.map((permissionId) => [permissionId, !deniedIds.has(permissionId)]),
  ))
  const permissionDecisions = Object.freeze(permissionIds.map((permissionId): PermissionDecision => (
    deniedIds.has(permissionId)
      ? {
          permissionId,
          scope: {
            kind: 'site',
            platformId: 'platform-a',
            organizationId: 'organization-a',
            workspaceId: 'shared-workspace',
            siteId: 'shared-website',
          },
          decision: 'deny',
          precedence: 'explicit-deny',
          source: { kind: 'permission-override', overrideId: `deny-${permissionId}` },
        }
      : {
          permissionId,
          scope: {
            kind: 'site',
            platformId: 'platform-a',
            organizationId: 'organization-a',
            workspaceId: 'shared-workspace',
            siteId: 'shared-website',
          },
          decision: 'allow',
          precedence: 'launch-persona',
          source: {
            kind: 'launch-persona-assignment',
            assignmentId: 'assignment-a',
            persona: 'owner',
          },
        }
  )))
  return Object.freeze({ permissionDecisions, permissionState })
}

function setHostedMode(enabled: boolean): void {
  const target = window as unknown as { __fumaHostedStaffAuth?: number }
  if (enabled) target.__fumaHostedStaffAuth = 1
  else delete target.__fumaHostedStaffAuth
}

function findAdminEntry(node: React.ReactNode): React.ReactElement<AdminEntryProps> | null {
  if (!React.isValidElement(node)) return null
  if (node.type === AdminEntry) {
    return node as React.ReactElement<AdminEntryProps>
  }
  const props = node.props as { children?: React.ReactNode }
  for (const child of React.Children.toArray(props.children)) {
    const found = findAdminEntry(child)
    if (found) return found
  }
  return null
}

function HostedShellHarness({
  contextCatalog,
  permissionDecisions,
  permissionState,
  editorRenderAdapter,
}: {
  contextCatalog?: unknown
  permissionDecisions?: readonly PermissionDecision[]
  permissionState?: NavigationPermissionState
  editorRenderAdapter?: HostedProfileEditorRenderAdapter
}) {
  const { pathname } = useLocation()
  return (
    <>
      <output data-testid="route-pathname">{pathname}</output>
      <HostedStaffShell
        session={session}
        pathname={pathname}
        contextCatalog={contextCatalog}
        permissionDecisions={permissionDecisions}
        permissionState={permissionState}
        editorRenderAdapter={editorRenderAdapter}
      />
    </>
  )
}

function renderHosted(
  pathname: string,
  contextCatalog?: unknown,
  editor: Readonly<{
    permissionDecisions?: readonly PermissionDecision[]
    permissionState?: NavigationPermissionState
    editorRenderAdapter?: HostedProfileEditorRenderAdapter
  }> = {},
) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <HostedShellHarness contextCatalog={contextCatalog} {...editor} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setHostedMode(false)
  localStorage.clear()
  globalThis.fetch = mock(() => new Promise<Response>(() => {})) as typeof fetch
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  setHostedMode(false)
  globalThis.fetch = originalFetch
})

describe('FUMA-018 hosted scoped route integration', () => {
  it('mounts explicit scoped and invitation patterns only in hosted mode without changing self-hosted routes', () => {
    const selfHosted = React.Children.toArray(AdminRoutes().props.children) as Array<
      React.ReactElement<{ path: string }>
    >
    expect(selfHosted.map(({ props }) => props.path)).toEqual([
      '/',
      '/admin',
      '/admin/login',
      '/admin/signup',
      '/admin/forgot-password',
      '/admin/reset-password',
      '/admin/dashboard',
      '/admin/site',
      '/admin/content',
      '/admin/data',
      '/admin/media',
      '/admin/plugins',
      '/admin/users',
      '/admin/ai',
      '/admin/account',
      '/admin/plugins/:pluginId/:pageId',
      '/admin/*',
    ])

    const injectedCatalog = catalog()
    setHostedMode(true)
    const hosted = React.Children.toArray(AdminRoutes({
      hostedContextCatalog: injectedCatalog,
    }).props.children) as Array<React.ReactElement<{ path: string; element: React.ReactNode }>>
    const paths = hosted.map(({ props }) => props.path)

    expect(paths).toContain(FUMA_SCOPED_ADMIN_ROUTE)
    expect(paths).toContain(FUMA_SCOPED_ADMIN_SUBPATH_ROUTE)
    expect(paths).toContain(FUMA_INVITATION_ADMIN_ROUTE)
    expect(paths.at(-1)).toBe('/admin/*')

    for (const path of [
      FUMA_SCOPED_ADMIN_ROUTE,
      FUMA_SCOPED_ADMIN_SUBPATH_ROUTE,
      FUMA_INVITATION_ADMIN_ROUTE,
      '/admin/dashboard',
      '/admin/site',
      '/admin/content',
      '/admin/data',
      '/admin/media',
    ]) {
      const route = hosted.find(({ props }) => props.path === path)
      const entry = findAdminEntry(route?.props.element)
      expect(entry?.props.hostedContextCatalog).toBe(injectedCatalog)
    }
  })

  it('shows missing context by default and rejects a schema-invalid injected catalog', () => {
    const missing = renderHosted('/admin/dashboard')
    expect(screen.getByRole('heading', { name: 'Welcome, Avery Editor' })).toBeTruthy()
    expect(screen.getByText('No scoped context is available')).toBeTruthy()

    missing.unmount()
    renderHosted('/admin/dashboard', { organizations: [] })
    expect(screen.getByRole('heading', { name: 'Scoped context unavailable' })).toBeTruthy()
    expect(screen.getByText(/did not match its validated contract/)).toBeTruthy()
  })

  it('keeps a multi-organization deep link authoritative across remounts and refresh-like stale state', async () => {
    const stale = selection('organization-a', 'website')
    const explicit = selection('organization-b', 'publication')
    writeContextPreference(stale)
    const deepLink = buildScopedAdminUrl(explicit, '/admin/posts')

    const first = renderHosted(deepLink, catalog())
    expect(screen.getByRole('heading', { name: 'Baobab Publication' })).toBeTruthy()
    expect(screen.getByTestId('route-pathname').textContent).toBe(deepLink)
    await waitFor(() => {
      expect(readContextPreference()?.selection).toEqual(explicit)
    })

    first.unmount()
    renderHosted(deepLink, catalog())
    expect(screen.getByRole('heading', { name: 'Baobab Publication' })).toBeTruthy()
    expect(screen.getByText('Baobab / Baobab Studio')).toBeTruthy()
  })

  it('fails closed for an unauthorized organization/workspace substitution', () => {
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

    renderHosted(buildScopedAdminUrl({
      organizationId: 'organization-a',
      workspaceId: 'baobab-private',
      siteId: 'private-site',
    }), accessibleCatalog)

    expect(screen.getByText('Workspace access unavailable')).toBeTruthy()
    expect(screen.getByText(/No substitute context was opened/)).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('renders suspension and archive states without substituting another context', () => {
    const selected = selection('organization-a', 'website')
    const cases = [
      {
        title: 'Organization suspended',
        mutate(value: AccessibleContextCatalog) {
          const organization = value.organizations.find(({ id }) => id === selected.organizationId)
          if (organization) organization.status = 'suspended'
        },
      },
      {
        title: 'Workspace archived',
        mutate(value: AccessibleContextCatalog) {
          const workspace = value.workspaces.find((entry) => (
            entry.organizationId === selected.organizationId
            && entry.id === selected.workspaceId
          ))
          if (workspace) workspace.status = 'archived'
        },
      },
      {
        title: 'Site archived',
        mutate(value: AccessibleContextCatalog) {
          const site = value.sites.find((entry) => (
            entry.organizationId === selected.organizationId
            && entry.workspaceId === selected.workspaceId
            && entry.id === selected.siteId
          ))
          if (site) site.status = 'archived'
        },
      },
    ]

    for (const entry of cases) {
      cleanup()
      const accessibleCatalog = catalog()
      entry.mutate(accessibleCatalog)
      renderHosted(buildScopedAdminUrl(selected), accessibleCatalog)
      expect(screen.getByText(entry.title)).toBeTruthy()
      expect(screen.queryByRole('navigation')).toBeNull()
    }
  })

  it('ignores stale browser preference and keeps invitation entry authoritative', () => {
    localStorage.setItem(FUMA_CONTEXT_PREFERENCE_KEY, JSON.stringify({
      version: 1,
      selection: {
        ...selection('organization-b', 'publication'),
        siteId: 'deleted-site',
      },
    }))
    const stale = renderHosted('/admin', catalog())
    expect(screen.getByRole('heading', { name: 'Acacia Publication' })).toBeTruthy()

    stale.unmount()
    const preferred = selection('organization-a', 'website')
    writeContextPreference(preferred)
    const invitationId = 'invite/customer-editor-token'
    renderHosted(buildInvitationAdminUrl(invitationId), catalog())
    expect(screen.getByText('Invitation entry')).toBeTruthy()
    expect(screen.getByText(invitationId)).toBeTruthy()
    expect(readContextPreference()?.selection).toEqual(preferred)
  })

  it('mounts Website and Publication pages/design through one profile-neutral render path', async () => {
    const access = permissionAccess()
    const editorRenderAdapter: HostedProfileEditorRenderAdapter = ({
      shell,
      surface,
      target,
      targetKey,
    }) => (
      <output data-testid="hosted-editor-adapter">
        {JSON.stringify({
          profileId: shell.resolution.site.profileId,
          subpath: shell.profileRelativeSubpath,
          surfaceId: surface.id,
          mutable: surface.access.mutable,
          target,
          targetKey,
        })}
      </output>
    )
    const cases = [
      { profile: 'website' as const, path: '/admin/pages', surfaceId: 'editor.pages' },
      { profile: 'website' as const, path: '/admin/design', surfaceId: 'editor.design' },
      { profile: 'publication' as const, path: '/admin/pages', surfaceId: 'editor.pages' },
      { profile: 'publication' as const, path: '/admin/design', surfaceId: 'editor.design' },
    ]

    for (const entry of cases) {
      cleanup()
      const selected = selection('organization-a', entry.profile)
      renderHosted(buildScopedAdminUrl(selected, entry.path), catalog(), {
        ...access,
        editorRenderAdapter,
      })
      const output = JSON.parse(
        screen.getByTestId('hosted-editor-adapter').textContent ?? '',
      )
      expect(output).toEqual({
        profileId: entry.profile,
        subpath: entry.path,
        surfaceId: entry.surfaceId,
        mutable: true,
        target: { ...selected, profileId: entry.profile },
        targetKey: JSON.stringify([
          selected.organizationId,
          selected.workspaceId,
          selected.siteId,
        ]),
      })
      expect(screen.getAllByTestId('hosted-editor-adapter')).toHaveLength(1)
    }

    const surfaceSource = await Bun.file(new URL(
      '../../admin/fuma/profileEditor/HostedProfileEditorSurface.tsx',
      import.meta.url,
    )).text()
    expect(surfaceSource).not.toMatch(/['"](?:website|publication)['"]/)
  })

  it('does not mount denied editor surfaces and marks readable denied-write surfaces read only', () => {
    const editorRenderAdapter = mock((context) => (
      <output data-testid="hosted-editor-access">
        {String(context.surface.access.mutable)}
      </output>
    )) as HostedProfileEditorRenderAdapter
    const selected = selection('organization-a', 'website')

    const deniedRead = permissionAccess(['website.design.read'])
    const deniedView = renderHosted(
      buildScopedAdminUrl(selected, '/admin/design'),
      catalog(),
      { ...deniedRead, editorRenderAdapter },
    )
    expect(screen.queryByRole('region', { name: 'Design editor surface' })).toBeNull()
    expect(screen.queryByTestId('hosted-editor-access')).toBeNull()
    expect(editorRenderAdapter).toHaveBeenCalledTimes(0)

    deniedView.unmount()
    const deniedWrite = permissionAccess(['content.pages.write'])
    renderHosted(
      buildScopedAdminUrl(selected, '/admin/pages'),
      catalog(),
      { ...deniedWrite, editorRenderAdapter },
    )
    expect(screen.getByRole('region', { name: 'Pages editor surface' })
      .getAttribute('data-editor-access')).toBe('read-only')
    expect(screen.getByText('Read only')).toBeTruthy()
    expect(screen.getByTestId('hosted-editor-access').textContent).toBe('false')
    expect(editorRenderAdapter).toHaveBeenCalledTimes(1)
  })

  it('switches Website and Publication shells through the default site switcher while preserving the exact target and subpath', async () => {
    const website = selection('organization-a', 'website')
    const publication = selection('organization-a', 'publication')
    const access = permissionAccess()
    renderHosted(buildScopedAdminUrl(website, '/admin/design'), catalog(), {
      ...access,
      editorRenderAdapter: ({ targetKey }) => (
        <output data-testid="active-editor-target">{targetKey}</output>
      ),
    })

    const websiteKey = JSON.stringify([
      website.organizationId,
      website.workspaceId,
      website.siteId,
    ])
    expect(screen.getByText('Website profile')).toBeTruthy()
    expect(screen.getByTestId('active-editor-target').textContent).toBe(websiteKey)
    expect(screen.getByRole('region', { name: 'Design editor surface' })
      .getAttribute('data-editor-target-key')).toBe(websiteKey)

    fireEvent.change(screen.getByLabelText('Site'), {
      target: { value: publication.siteId },
    })

    const publicationPath = buildScopedAdminUrl(publication, '/admin/design')
    const publicationKey = JSON.stringify([
      publication.organizationId,
      publication.workspaceId,
      publication.siteId,
    ])
    await waitFor(() => {
      expect(screen.getByTestId('route-pathname').textContent).toBe(publicationPath)
      expect(screen.getByText('Publication profile')).toBeTruthy()
      expect(screen.getByTestId('active-editor-target').textContent).toBe(publicationKey)
      expect(screen.getByRole('region', { name: 'Design editor surface' })
        .getAttribute('data-editor-target-key')).toBe(publicationKey)
    })

    fireEvent.change(screen.getByLabelText('Site'), {
      target: { value: website.siteId },
    })
    await waitFor(() => {
      expect(screen.getByText('Website profile')).toBeTruthy()
      expect(screen.getByTestId('active-editor-target').textContent).toBe(websiteKey)
    })
  })
})
