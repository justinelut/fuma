/**
 * The generated-site baseline must not drift from what this monorepo proves.
 *
 * The important assertion is the cross-check against `apps/web`: that app is a real Next
 * site built from this repository, so its versions are proven *together* rather than each
 * being its own latest. Reading its package.json means a dependency bump there either
 * updates the baseline or fails this test — which is the only way a baseline stays true
 * without somebody remembering to maintain it.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BASELINE,
  BASELINE_UNPROVEN_IN_WEB,
  allBaselinePackages,
  findBaselinePackage,
  isExactVersion,
  normalisePackageName,
  packageJsonFor,
} from '@core/generatedSite/libraryBaseline'

const webPackageJson = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../web/package.json'), 'utf8'),
) as { dependencies?: Record<string, string>, devDependencies?: Record<string, string> }

const webVersions: Record<string, string> = {
  ...(webPackageJson.dependencies ?? {}),
  ...(webPackageJson.devDependencies ?? {}),
}

describe('every pin is exact', () => {
  it('has no range operators anywhere', () => {
    // A range means two tenants generated a week apart run different code, and the
    // difference is invisible.
    for (const entry of allBaselinePackages()) {
      expect(isExactVersion(entry.version)).toBe(true)
    }
  })

  it('rejects a caret or tilde', () => {
    expect(isExactVersion('^1.2.3')).toBe(false)
    expect(isExactVersion('~1.2.3')).toBe(false)
    expect(isExactVersion('1.x')).toBe(false)
    expect(isExactVersion('1.2.3')).toBe(true)
  })
})

describe('the baseline matches what apps/web runs', () => {
  it('finds apps/web to compare against', () => {
    // If this fails the rest of the file proves nothing.
    expect(Object.keys(webVersions).length).toBeGreaterThan(10)
  })

  it('agrees with apps/web on every shared package', () => {
    for (const entry of BASELINE) {
      const web = webVersions[entry.name]
      if (web === undefined) continue
      // apps/web carries a caret on radix-ui; compare the resolved number, not the range.
      expect(web.replace(/^[\^~]/, '')).toBe(entry.version)
    }
  })

  it('covers every runtime package apps/web depends on that a site would need', () => {
    // Named explicitly rather than asserting the whole set, because apps/web also carries
    // workspace packages and MDX tooling a tenant site has no use for.
    for (const name of [
      'next', 'react', 'react-dom', 'motion', 'lucide-react',
      'class-variance-authority', 'clsx', 'tailwind-merge',
    ]) {
      expect(findBaselinePackage(name)).toBeDefined()
    }
  })

  it('does not silently include a workspace package a tenant cannot resolve', () => {
    // `workspace:*` means nothing outside this repository; a generated site installing it
    // fails at install time.
    for (const entry of allBaselinePackages()) {
      expect(entry.version.startsWith('workspace:')).toBe(false)
    }
  })
})

describe('packages apps/web does not prove are declared as such', () => {
  it('lists them separately rather than mixing them in', () => {
    // They carry less evidence, and saying so is the honest thing.
    for (const entry of BASELINE_UNPROVEN_IN_WEB) {
      expect(webVersions[entry.name]).toBeUndefined()
    }
  })

  it('includes the whole form stack the product promises', () => {
    for (const name of ['zod', 'react-hook-form', '@hookform/resolvers']) {
      expect(findBaselinePackage(name)).toBeDefined()
    }
  })

  it('includes zustand and next-themes', () => {
    expect(findBaselinePackage('zustand')?.version).toBe('5.0.12')
    expect(findBaselinePackage('next-themes')?.version).toBe('0.4.6')
  })

  it('pins a zod the resolver actually supports', () => {
    // @hookform/resolvers 5.7.1 declares zod "^3.25.0 || ^4.0.0".
    expect(findBaselinePackage('zod')?.version.startsWith('4.')).toBe(true)
  })

  it('states a reason for every package', () => {
    // A dependency nobody can justify is one nobody can remove either.
    for (const entry of allBaselinePackages()) {
      expect(entry.reason.length).toBeGreaterThan(20)
    }
  })
})

describe('the validator boundary holds', () => {
  it('gives the generated site zod', () => {
    expect(findBaselinePackage('zod')).toBeDefined()
  })

  it('does not give the generated site typebox', () => {
    // TypeBox is Fuma's validator. Shipping both to a tenant site would make the boundary
    // a suggestion rather than a rule.
    expect(findBaselinePackage('@sinclair/typebox')).toBeUndefined()
  })
})

describe('the generated package.json', () => {
  const manifest = packageJsonFor('My Great Site') as Record<string, unknown>

  it('is private, so a tenant site cannot be published to a registry', () => {
    expect(manifest['private']).toBe(true)
  })

  it('normalises the name to something npm accepts', () => {
    expect(manifest['name']).toBe('my-great-site')
  })

  it('carries the build scripts the pipeline runs', () => {
    const scripts = manifest['scripts'] as Record<string, string>
    expect(scripts['build']).toBe('next build')
    expect(scripts['typecheck']).toBe('tsc --noEmit')
  })

  it('separates dependencies from devDependencies', () => {
    const dependencies = manifest['dependencies'] as Record<string, string>
    const dev = manifest['devDependencies'] as Record<string, string>
    expect(dependencies['next']).toBe('16.2.9')
    expect(dev['tailwindcss']).toBe('4.3.3')
    expect(dependencies['tailwindcss']).toBeUndefined()
  })

  it('sorts keys so two generations produce identical bytes', () => {
    // A diff should show only what actually changed.
    const dependencies = Object.keys(manifest['dependencies'] as Record<string, string>)
    expect(dependencies).toEqual([...dependencies].sort())
  })

  it('is byte-identical when generated twice', () => {
    expect(JSON.stringify(packageJsonFor('My Great Site')))
      .toBe(JSON.stringify(packageJsonFor('My Great Site')))
  })

  it('includes every baseline package exactly once', () => {
    const dependencies = manifest['dependencies'] as Record<string, string>
    const dev = manifest['devDependencies'] as Record<string, string>
    for (const entry of allBaselinePackages()) {
      const found = entry.dev ? dev[entry.name] : dependencies[entry.name]
      expect(found).toBe(entry.version)
    }
  })
})

describe('normalising a site name', () => {
  it('lowercases and hyphenates', () => {
    expect(normalisePackageName('Acme Corp')).toBe('acme-corp')
  })

  it('strips characters npm refuses', () => {
    expect(normalisePackageName('My Site!! (2026)')).toBe('my-site-2026')
  })

  it('falls back rather than producing an empty name', () => {
    // An empty name makes package.json unreadable, and the build error says nothing about
    // the site's name.
    expect(normalisePackageName('!!!')).toBe('site')
  })

  it('truncates to npm limit', () => {
    expect(normalisePackageName('a'.repeat(300)).length).toBeLessThanOrEqual(214)
  })

  it('handles a name that is already a slug', () => {
    expect(normalisePackageName('acme-corp')).toBe('acme-corp')
  })
})
