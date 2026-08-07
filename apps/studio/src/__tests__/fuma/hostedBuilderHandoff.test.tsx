import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { HostedBuilderHandoff } from '@admin/fuma/builder/HostedBuilderHandoff'
import {
  readRememberedBuilderScope,
  rememberBuilderScope,
  resolveBuilderScope,
} from '@admin/fuma/builder/builderScope'
import { resolveBuilderCmsRole } from '../../../server/fuma/builder/builderIdentity'
import { fumaLaunchRegistry, type AccessibleContextCatalog } from '@core/fuma'
import { BUILDER_OWNED_SECTIONS } from '@core/fuma/builder/sectionOwnership'

const SCOPE = Object.freeze({
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
})

function catalogWith(
  sites: readonly Readonly<{ id: string, status: 'active' | 'archived' }>[],
): AccessibleContextCatalog {
  return {
    organizations: [{ id: 'organization-a', name: 'Acacia', status: 'active' }],
    workspaces: [{
      id: 'workspace-a',
      organizationId: 'organization-a',
      name: 'Studio',
      status: 'active',
      isDefault: true,
    }],
    sites: sites.map((site) => ({
      id: site.id,
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      name: site.id,
      status: site.status,
      profileId: 'website',
      capabilityOverrides: { grant: [], revoke: [] },
    })),
  }
}

describe('hosted builder handoff', () => {
  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
  })

  it('binds design authority to a CMS role and refuses read-only personas', () => {
    expect(resolveBuilderCmsRole(['site.home.read', 'website.design.write'])).toBe('admin')
    expect(resolveBuilderCmsRole(['content.pages.write'])).toBe('client')
    expect(resolveBuilderCmsRole(['site.home.read', 'website.design.read'])).toBeNull()
    expect(resolveBuilderCmsRole([])).toBeNull()
  })

  it('remembers the site being designed so Instatic internal links keep scope', () => {
    expect(readRememberedBuilderScope()).toBeNull()
    rememberBuilderScope(SCOPE)
    expect(readRememberedBuilderScope()).toEqual(SCOPE)
    expect(resolveBuilderScope(catalogWith([{ id: 'site-a', status: 'active' }])))
      .toEqual(SCOPE)
  })

  it('ignores a remembered site that is no longer accessible', () => {
    rememberBuilderScope({ ...SCOPE, siteId: 'site-removed' })
    expect(resolveBuilderScope(catalogWith([{ id: 'site-a', status: 'active' }])))
      .toEqual(SCOPE)
    expect(resolveBuilderScope(catalogWith([
      { id: 'site-a', status: 'active' },
      { id: 'site-b', status: 'active' },
    ]))).toBeNull()
  })

  it('will not guess a site when none is accessible', () => {
    expect(resolveBuilderScope(catalogWith([{ id: 'site-a', status: 'archived' }])))
      .toBeNull()
  })

  it('explains a refused handoff instead of rendering an empty builder', async () => {
    render(
      <HostedBuilderHandoff
        scope={SCOPE}
        returnPath="/admin/organizations/organization-a/workspaces/workspace-a/sites/site-a"
        exchange={() => Promise.resolve({ kind: 'forbidden' as const })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
    })
    expect(screen.getByText('You cannot design this site')).toBeDefined()
  })

  it('surfaces a failed exchange with the reason and a way back', async () => {
    render(
      <HostedBuilderHandoff
        scope={SCOPE}
        returnPath="/admin/organizations/organization-a/workspaces/workspace-a/sites/site-a"
        siteName="Acacia"
        exchange={() => Promise.resolve({
          kind: 'error' as const,
          message: 'Builder session unavailable',
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('Builder session unavailable')).toBeDefined()
    })
    const back = screen.getByRole('link', { name: 'Back to Acacia' })
    expect(back.getAttribute('href'))
      .toBe('/admin/organizations/organization-a/workspaces/workspace-a/sites/site-a')
  })

  it('routes every builder-owned section to Instatic, and no platform-owned one', () => {
    const source = readFileSync(
      new URL('../../admin/AdminEntry.tsx', import.meta.url),
      'utf8',
    )
    // The set is now DERIVED from one list rather than restated here, so this
    // asserts the derivation instead of re-listing the members. Restating them
    // is what let the navigation and the router disagree about `dashboard`.
    expect(source).toContain('BUILDER_OWNED_SECTIONS')
    expect(source).toContain('INSTATIC_OWNED_SECTIONS.has(section)')
    for (const section of ['site', 'content', 'data', 'media', 'plugins', 'pluginPage']) {
      expect(BUILDER_OWNED_SECTIONS).toContain(section)
    }
    // Staff identity, the dashboards, AI configuration and the account are
    // platform concerns. Asserted against the list itself rather than by
    // scanning the file: the previous version matched the literal set with a
    // regex, and once the set became a derivation the regex matched nothing, so
    // the refusal would have passed no matter what was added.
    for (const section of ['account', 'users', 'dashboard', 'ai']) {
      expect(BUILDER_OWNED_SECTIONS).not.toContain(section)
    }
  })

  it('keeps Instatic-owned surfaces out of hosted navigation', () => {
    const labels = (profileId: string) => fumaLaunchRegistry
      .compose(profileId)
      .navigation
      .map((entry) => entry.label.toLowerCase())
    for (const profileId of ['website', 'publication']) {
      const composed = labels(profileId)
      for (const owned of ['media', 'pages', 'data']) {
        expect(composed).not.toContain(owned)
      }
    }
  })
})
