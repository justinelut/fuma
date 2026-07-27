import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { FumaScopedShell } from '@admin/fuma/FumaScopedShell'
import { PublicationRouteContent } from '@admin/fuma/publication'
import { MemoryRouter } from '@admin/lib/routing'
import {
  buildScopedAdminUrl,
  fumaLaunchRegistry,
  type AccessibleContextCatalog,
  type NavigationPermissionState,
  type PermissionDecision,
} from '@core/fuma'

const selection = {
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'publication-a',
}
const scopedTagsPath = buildScopedAdminUrl(selection, '/admin/tags')
const originalFetch = globalThis.fetch

const catalog: AccessibleContextCatalog = {
  organizations: [{ id: selection.organizationId, name: 'Acacia', status: 'active' }],
  workspaces: [{
    id: selection.workspaceId,
    organizationId: selection.organizationId,
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
    profileId: 'publication',
    capabilityOverrides: { grant: [], revoke: [] },
  }],
}

function permissionState(): NavigationPermissionState {
  return Object.freeze(Object.fromEntries(
    fumaLaunchRegistry.compose('publication').permissions.map(({ id }) => [
      id,
      id !== 'publication.posts.read',
    ]),
  ))
}

function tagWriteDecision(siteId: string, decision: 'allow' | 'deny'): PermissionDecision {
  return {
    permissionId: 'publication.tags.write',
    scope: {
      kind: 'site',
      platformId: 'platform-a',
      organizationId: selection.organizationId,
      workspaceId: selection.workspaceId,
      siteId,
    },
    decision,
    precedence: 'launch-persona',
    source: {
      kind: 'launch-persona-assignment',
      assignmentId: `${siteId}-${decision}`,
      persona: 'member',
    },
  }
}

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

describe('FUMA-032 Publication route content', () => {
  it('mounts an allowed capability-owned child when Posts navigation is filtered and rejects foreign-site write authority', async () => {
    globalThis.fetch = mock(async () => Response.json({ tags: [] }))

    render(
      <MemoryRouter initialEntries={[scopedTagsPath]}>
        <FumaScopedShell
          catalog={catalog}
          pathname={scopedTagsPath}
          actorLabel="Eden Editor"
          permissionState={permissionState()}
        >
          {(shell) => (
            <PublicationRouteContent
              shell={shell}
              permissionDecisions={[
                tagWriteDecision('another-site', 'allow'),
                tagWriteDecision(selection.siteId, 'deny'),
              ]}
            />
          )}
        </FumaScopedShell>
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: 'Posts' })).toBeNull()
    expect(screen.getByTestId('publication-route-content')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeTruthy()
    expect(screen.getByText('Read only')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('No tags yet.')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Save tag' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('link', { name: 'Tags' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull()
  })

  it('announces loading and exposes a request failure as an alert', async () => {
    globalThis.fetch = mock(async () => Response.json(
      { message: 'Publication data is temporarily unavailable.' },
      { status: 503 },
    ))

    render(
      <MemoryRouter initialEntries={[scopedTagsPath]}>
        <FumaScopedShell
          catalog={catalog}
          pathname={scopedTagsPath}
          actorLabel="Vera Viewer"
          permissionState={permissionState()}
        >
          {(shell) => (
            <PublicationRouteContent
              shell={shell}
              permissionDecisions={[tagWriteDecision(selection.siteId, 'deny')]}
            />
          )}
        </FumaScopedShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('status').textContent).toContain('Loading Publication data')
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Publication data is temporarily unavailable.',
      )
    })
  })
})
