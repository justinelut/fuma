import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FumaScopedShell } from '@admin/fuma'
import { HostedProfileEditorSurface } from '@admin/fuma/profileEditor/HostedProfileEditorSurface'
import { MemoryRouter } from '@admin/lib/routing'
import {
  buildScopedAdminUrl,
  fumaLaunchRegistry,
  resolveProfileRouteAccess,
  type AccessibleContextCatalog,
  type NavigationPermissionState,
  type PermissionDecision,
} from '@core/fuma'

const EMPTY_OVERRIDES = { grant: [] as string[], revoke: [] as string[] }
const selection = {
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'publication-a',
}

function catalog(profileId = 'publication', capabilityOverrides = EMPTY_OVERRIDES): AccessibleContextCatalog {
  return {
    organizations: [{ id: 'organization-a', name: 'Acacia', status: 'active' }],
    workspaces: [{
      id: 'workspace-a',
      organizationId: 'organization-a',
      name: 'Editorial',
      status: 'active',
      isDefault: true,
    }],
    sites: [{
      id: selection.siteId,
      organizationId: selection.organizationId,
      workspaceId: selection.workspaceId,
      name: 'Acacia Daily',
      status: 'active',
      profileId,
      capabilityOverrides,
    }],
  }
}

function permissionState(
  profileId = 'publication',
  denied: readonly string[] = [],
): NavigationPermissionState {
  const deniedIds = new Set(denied)
  return Object.freeze(Object.fromEntries(
    fumaLaunchRegistry.compose(profileId).permissions.map(({ id }) => [id, !deniedIds.has(id)]),
  ))
}

function decisions(persona: 'editor' | 'viewer'): readonly PermissionDecision[] {
  const mutable = new Set(persona === 'editor'
    ? ['content.pages.write', 'publication.posts.write']
    : [])
  return Object.freeze(fumaLaunchRegistry.compose('publication').permissions.map(({ id }) => ({
    permissionId: id,
    scope: {
      kind: 'site' as const,
      platformId: 'platform-a',
      ...selection,
    },
    decision: (!id.endsWith('.write') && !id.endsWith('.send') && !id.endsWith('.schedule'))
      || mutable.has(id) ? 'allow' as const : 'deny' as const,
    precedence: 'launch-persona' as const,
    source: {
      kind: 'launch-persona-assignment' as const,
      assignmentId: `${persona}-assignment`,
      persona: persona === 'editor' ? 'member' as const : 'viewer' as const,
    },
  })))
}

function renderPublication(
  subpath = '/admin',
  options: Readonly<{
    denied?: readonly string[]
    persona?: 'editor' | 'viewer'
    child?: () => React.ReactNode
  }> = {},
) {
  const pathname = buildScopedAdminUrl(selection, subpath)
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <FumaScopedShell
        catalog={catalog()}
        pathname={pathname}
        actorLabel={options.persona === 'viewer' ? 'Vera Viewer' : 'Eden Editor'}
        permissionState={permissionState('publication', options.denied)}
      >
        {(shell) => options.child?.() ?? (
          <HostedProfileEditorSurface
            shell={shell}
            permissionDecisions={decisions(options.persona ?? 'editor')}
            renderAdapter={({ surface }) => (
              <output data-testid="publication-editor">{surface.id}</output>
            )}
          />
        )}
      </FumaScopedShell>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('FUMA-032 Publication profile shell', () => {
  it('renders the exact subtitle and ordered navigation with Design hidden in a revealable Editor disclosure', () => {
    renderPublication()

    expect(screen.getByText('Blog, magazine, newsletter, or newsroom')).toBeTruthy()
    const navigation = screen.getByRole('navigation', { name: 'Publication navigation' })
    expect(within(navigation).getAllByRole('link', { hidden: true }).map((link) => link.textContent)).toEqual([
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

    const summary = within(navigation).getByText('Editor')
    const disclosure = summary.closest('details')
    expect(disclosure?.open).toBe(false)

    fireEvent.click(summary)
    expect(disclosure?.open).toBe(true)
    expect(within(navigation).getByRole('link', { name: 'Design' })).toBeTruthy()
  })

  it('opens the disclosure for an authorized Design direct link and keeps it permission guarded', () => {
    const allowed = renderPublication('/admin/design/example')
    const design = screen.getByRole('link', { name: 'Design' })
    expect(design.getAttribute('aria-current')).toBe('page')
    expect(design.closest('details')?.open).toBe(true)
    expect(screen.getByTestId('publication-editor').textContent).toBe('editor.design')

    allowed.unmount()
    const child = mock(() => <p>Secret design route</p>)
    renderPublication('/admin/design', {
      denied: ['website.design.read'],
      child,
    })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Route access unavailable')).toBeTruthy()
    expect(screen.queryByText('Secret design route')).toBeNull()
    expect(child).toHaveBeenCalledTimes(0)
  })

  it('fails closed for a capability-inactive direct link while permitting active Publication links', () => {
    const websitePosts = resolveProfileRouteAccess({
      profileId: 'website',
      capabilityOverrides: EMPTY_OVERRIDES,
      permissionState: permissionState('website'),
      method: 'GET',
      path: '/admin/posts',
    }, fumaLaunchRegistry)
    const publicationPosts = resolveProfileRouteAccess({
      profileId: 'publication',
      capabilityOverrides: EMPTY_OVERRIDES,
      permissionState: permissionState('publication'),
      method: 'GET',
      path: '/admin/posts/example',
    }, fumaLaunchRegistry)
    const deniedPosts = resolveProfileRouteAccess({
      profileId: 'publication',
      capabilityOverrides: EMPTY_OVERRIDES,
      permissionState: permissionState('publication', ['publication.posts.read']),
      method: 'GET',
      path: '/admin/posts',
    }, fumaLaunchRegistry)

    expect(websitePosts).toEqual({
      kind: 'denied',
      reason: 'capability-disabled',
      permission: 'publication.posts.read',
    })
    expect(publicationPosts).toEqual({
      kind: 'allowed',
      route: expect.objectContaining({ id: 'route.posts.list' }),
    })
    expect(deniedPosts).toEqual({
      kind: 'denied',
      reason: 'permission-denied',
      permission: 'publication.posts.read',
    })
  })

  it('gives editors mutable page/post surfaces while viewers and Design remain read only', () => {
    const editor = renderPublication('/admin/pages', { persona: 'editor' })
    expect(screen.getByRole('region', { name: 'Pages editor surface' })
      .getAttribute('data-editor-access')).toBe('mutable')

    editor.unmount()
    const viewer = renderPublication('/admin/pages', { persona: 'viewer' })
    expect(screen.getByRole('region', { name: 'Pages editor surface' })
      .getAttribute('data-editor-access')).toBe('read-only')
    expect(screen.getByText('Read only')).toBeTruthy()

    viewer.unmount()
    renderPublication('/admin/design', { persona: 'editor' })
    expect(screen.getByRole('region', { name: 'Design editor surface' })
      .getAttribute('data-editor-access')).toBe('read-only')
  })
})
