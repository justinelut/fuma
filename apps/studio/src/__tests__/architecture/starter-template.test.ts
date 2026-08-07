/**
 * The starter template.
 *
 * The assertion that matters most: the real reader opens every module with no diagnostics.
 * If the starter fell outside the accepted subset, a tenant would open the builder on day
 * one to an empty canvas, which reads as the product being broken rather than as the
 * starter being unusual.
 */

import { describe, it, expect } from 'bun:test'
import { starterFiles, starterModules } from '@core/generatedSite/starterTemplate'
import { readModuleSource } from '@core/react-ir/read'
import { allBaselinePackages } from '@core/generatedSite/libraryBaseline'

const files = starterFiles('Acme Studio')
const fileAt = (path: string) => files.find((file) => file.path === path)

describe('the file set makes a buildable Next site', () => {
  it('includes the Next entry points', () => {
    expect(fileAt('app/layout.tsx')).toBeDefined()
    expect(fileAt('app/page.tsx')).toBeDefined()
  })

  it('includes the build configuration', () => {
    for (const path of ['package.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs']) {
      expect(fileAt(path)).toBeDefined()
    }
  })

  it('includes the stylesheet and the cn helper every shadcn component needs', () => {
    expect(fileAt('app/globals.css')).toBeDefined()
    expect(fileAt('lib/utils.ts')?.content).toContain('twMerge')
  })

  it('has no empty file', () => {
    for (const file of files) {
      expect(file.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('ends every file with a newline', () => {
    // A missing trailing newline shows as a spurious diff on the first real edit.
    for (const file of files) {
      expect(file.content.endsWith('\n')).toBe(true)
    }
  })
})

describe('the engine can read every module it ships', () => {
  it('reads each module with no diagnostics', () => {
    for (const file of starterModules('Acme Studio')) {
      const result = readModuleSource(file.path, file.content)
      expect(result.diagnostics).toEqual([])
    }
  })

  it('finds a root node in each module', () => {
    // A null root means the canvas has nothing to show.
    for (const file of starterModules('Acme Studio')) {
      expect(readModuleSource(file.path, file.content).rootNodeId).not.toBeNull()
    }
  })

  it('recovers the component name from each module', () => {
    const names = starterModules('Acme Studio')
      .map((file) => readModuleSource(file.path, file.content).symbol)
    expect(names).toEqual(['RootLayout', 'Page', 'Hero'])
  })

  it('anchors the elements so an edit keeps their identity', () => {
    const hero = starterModules('Acme Studio').find((file) => file.path.endsWith('Hero.tsx'))
    const result = readModuleSource(hero?.path ?? '', hero?.content ?? '')
    expect(result.anchoredNodeIds).toContain('hero-root')
    expect(result.anchoredNodeIds).toContain('hero-title')
  })

  it('reads the Hero animation as Motion rather than as an unknown component', () => {
    const hero = starterModules('Acme Studio').find((file) => file.path.endsWith('Hero.tsx'))
    const result = readModuleSource(hero?.path ?? '', hero?.content ?? '')
    const title = result.nodes['hero-title']
    expect(title).toBeDefined()
    // Recovered as an h1 carrying an animation, which is what the animation panel edits.
    expect((title as { tag?: string }).tag).toBe('h1')
    expect((title as { animation?: unknown }).animation).toBeDefined()
  })

  it('marks configuration as not editable', () => {
    // Configuration goes to disk for the build; it is not something to hand a designer.
    expect(fileAt('package.json')?.module).toBe(false)
    expect(fileAt('tsconfig.json')?.module).toBe(false)
  })

  it('returns only modules from starterModules', () => {
    expect(starterModules('Acme Studio').map((file) => file.path))
      .toEqual(['app/layout.tsx', 'app/page.tsx', 'components/Hero.tsx'])
  })
})

describe('the manifest comes from the pinned baseline', () => {
  const manifest = JSON.parse(fileAt('package.json')?.content ?? '{}') as {
    name?: string
    private?: boolean
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  it('names the package after the site', () => {
    expect(manifest.name).toBe('acme-studio')
  })

  it('is private', () => {
    expect(manifest.private).toBe(true)
  })

  it('pins every baseline package', () => {
    for (const entry of allBaselinePackages()) {
      const found = entry.dev
        ? manifest.devDependencies?.[entry.name]
        : manifest.dependencies?.[entry.name]
      expect(found).toBe(entry.version)
    }
  })

  it('ships next-themes, because the layout imports it', () => {
    // A layout importing a package the manifest omits fails at install, not at review.
    expect(manifest.dependencies?.['next-themes']).toBeDefined()
    expect(fileAt('app/layout.tsx')?.content).toContain("from 'next-themes'")
  })

  it('ships motion, because the starter component imports it', () => {
    expect(manifest.dependencies?.['motion']).toBeDefined()
    expect(fileAt('components/Hero.tsx')?.content).toContain('motion/react-client')
  })
})

describe('the layout is correct about hydration', () => {
  const layout = fileAt('app/layout.tsx')?.content ?? ''

  it('suppresses the hydration warning next-themes requires', () => {
    // next-themes sets the class before React hydrates, so server and client markup differ
    // by design and React would report it on every page load.
    expect(layout).toContain('suppressHydrationWarning')
  })

  it('renders children inside the theme provider', () => {
    expect(layout).toMatch(/<ThemeProvider[^>]*>\s*\{children\}/)
  })

  it('imports the stylesheet, or nothing is styled', () => {
    expect(layout).toContain("import './globals.css'")
  })
})

describe('the stylesheet', () => {
  const css = fileAt('app/globals.css')?.content ?? ''

  it('imports Tailwind', () => {
    expect(css).toContain('@import "tailwindcss"')
  })

  it('aliases shadcn names onto tokens so a token change moves the whole site', () => {
    expect(css).toContain('@theme inline')
    expect(css).toContain('--color-primary: var(--primary)')
  })

  it('declares a dark block carrying the same names as light', () => {
    // A component must never need to know which mode it is in.
    const light = css.slice(css.indexOf(':root'), css.indexOf('.dark {'))
    const dark = css.slice(css.indexOf('.dark {'))
    for (const token of ['--background', '--foreground', '--primary', '--border']) {
      expect(light).toContain(token)
      expect(dark).toContain(token)
    }
  })

  it('registers the dark variant, or dark: utilities do nothing', () => {
    expect(css).toContain('@custom-variant dark')
  })
})

describe('the starter stays small', () => {
  it('ships one page and one component', () => {
    // Every extra starter page is something a tenant has to delete before the site is
    // theirs, and a place for our example copy to reach production.
    const pages = files.filter((file) => /^app\/.*page\.tsx$/.test(file.path))
    expect(pages).toHaveLength(1)
  })

  it('composes the page from a component rather than inlining everything', () => {
    // The starter should demonstrate the shape the engine wants.
    expect(fileAt('app/page.tsx')?.content).toContain('<Hero />')
  })

  it('is deterministic', () => {
    expect(JSON.stringify(starterFiles('Acme Studio')))
      .toBe(JSON.stringify(starterFiles('Acme Studio')))
  })

  it('escapes a site name containing a quote', () => {
    // An unescaped apostrophe in the metadata title is a syntax error in the layout.
    const quoted = starterFiles("Bob's Bikes").find((file) => file.path === 'app/layout.tsx')
    expect(readModuleSource('app/layout.tsx', quoted?.content ?? '').diagnostics).toEqual([])
  })

  it('carries no eslint key, which Next 16 removed from NextConfig', () => {
    // Caught by compiling the starter against the real installed Next rather than by review.
    expect(fileAt('next.config.ts')?.content).not.toMatch(/^\s*eslint:/m)
  })
})
