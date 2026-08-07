/**
 * Tasks 69 and 70: settings, AI configuration, accounts and dashboard leave the builder, which is
 * reduced to design, content and data.
 *
 * The split is asserted against the shipped files, because the defect it fixes was two lists
 * deciding one question and disagreeing.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUILDER_OWNED_SECTIONS,
  PLATFORM_ENTRY_PATH,
  PLATFORM_OWNED_SECTIONS,
  REDUCTION,
  builderOffersSection,
  redirectForSection,
  reviewOwnership,
} from '../../core/fuma/builder/sectionOwnership'

const STUDIO = join(import.meta.dir, '..', '..', '..')

describe('what leaves the builder', () => {
  it('dashboard, users, AI configuration and account', () => {
    expect([...PLATFORM_OWNED_SECTIONS].sort()).toEqual(['account', 'ai', 'dashboard', 'users'])
  })

  it('and none of them is also claimed by the builder', () => {
    // The two lists must partition, or a section would be owned twice - which is the defect.
    for (const section of PLATFORM_OWNED_SECTIONS) {
      expect(BUILDER_OWNED_SECTIONS).not.toContain(section)
    }
  })

  it('the builder keeps design, content and data, plus media and plugins', () => {
    expect([...BUILDER_OWNED_SECTIONS].sort()).toEqual([
      'content', 'data', 'media', 'plugins', 'pluginPage', 'site',
    ].sort())
  })
})

describe('self-host is unchanged, which is the constraint that shapes the split', () => {
  it('every platform-owned section is still offered when no platform is present', () => {
    // Deleting them outright would leave a self-hosted install no way to reach them at all.
    for (const section of PLATFORM_OWNED_SECTIONS) {
      expect(builderOffersSection(section, false)).toBe(true)
    }
  })

  it('and nothing redirects', () => {
    expect(redirectForSection('dashboard', false)).toBeNull()
    expect(redirectForSection('account', false)).toBeNull()
  })
})

describe('under a hosted platform', () => {
  it('a platform-owned section is not offered', () => {
    expect(builderOffersSection('dashboard', true)).toBe(false)
    expect(builderOffersSection('ai', true)).toBe(false)
  })

  it('a builder-owned section still is', () => {
    expect(builderOffersSection('site', true)).toBe(true)
    expect(builderOffersSection('content', true)).toBe(true)
    expect(builderOffersSection('data', true)).toBe(true)
  })

  it('and a platform-owned route redirects to the platform entry, not a constructed scoped path', () => {
    // A path assembled from a partial scope lands on a route that cannot resolve its own context.
    expect(redirectForSection('dashboard', true)).toBe(PLATFORM_ENTRY_PATH)
    expect(PLATFORM_ENTRY_PATH).toBe('/admin')
  })
})

describe('the review catches both ways the split stops holding', () => {
  it('a sound state reports nothing', () => {
    expect(reviewOwnership({
      navLinksShown: ['site', 'content', 'data'],
      routesStillRendering: ['site', 'content', 'data'],
    })).toHaveLength(0)
  })

  it('a duplicate surface names the consequence for a saved setting', () => {
    const problems = reviewOwnership({ navLinksShown: ['ai'], routesStillRendering: [] })
    expect(problems.map((p) => p.code)).toContain('duplicate-surface-offered')
    expect(problems[0]!.message).toContain('does not read')
  })

  it('a reachable route with no link is caught SEPARATELY, because hiding a link is not removing it', () => {
    const problems = reviewOwnership({ navLinksShown: [], routesStillRendering: ['dashboard'] })
    expect(problems.map((p) => p.code)).toContain('route-reachable-without-link')
    expect(problems[0]!.message).toContain('bookmark')
  })

  it('reports both together', () => {
    expect(reviewOwnership({
      navLinksShown: ['dashboard'],
      routesStillRendering: ['dashboard'],
    })).toHaveLength(2)
  })
})

describe('the shipped files now read ONE list', () => {
  it('the builder navigation asks builderOffersSection rather than keeping its own set', () => {
    const nav = readFileSync(
      join(STUDIO, 'src/admin/shared/AdminSectionNavigation/AdminSectionNavigation.tsx'),
      'utf8',
    )
    expect(nav).toContain('builderOffersSection')
    // The old hardcoded set is gone; keeping it would let the two disagree again.
    expect(nav).not.toContain("new Set<AdminWorkspace>(['users'])")
  })

  it('the route entry derives its set from BUILDER_OWNED_SECTIONS', () => {
    const entry = readFileSync(join(STUDIO, 'src/admin/AdminEntry.tsx'), 'utf8')
    expect(entry).toContain('new Set<AdminSection>(\n  BUILDER_OWNED_SECTIONS,\n)')
  })

  it('and the route set no longer names dashboard or ai as builder-owned', () => {
    // This is the specific gap: both previously handed off to the builder in hosted mode.
    const entry = readFileSync(join(STUDIO, 'src/admin/AdminEntry.tsx'), 'utf8')
    const setBlock = entry.slice(
      entry.indexOf('INSTATIC_OWNED_SECTIONS: ReadonlySet'),
      entry.indexOf('function validatedCatalog'),
    )
    expect(setBlock).not.toContain("'dashboard'")
    expect(setBlock).not.toContain("'ai'")
  })
})

describe('the reduction is stated', () => {
  it('naming what it keeps, what moves and why self-host differs', () => {
    expect(REDUCTION.keeps).toContain('Design, content')
    expect(REDUCTION.moves).toContain('across the whole workspace')
    expect(REDUCTION.selfHost).toContain('nowhere else')
  })
})
