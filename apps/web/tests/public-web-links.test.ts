import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * The only frontend guarantee worth automating on a marketing site: links work.
 *
 * This walks every component and route, extracts internal link targets, and proves
 * each one resolves to a real App Router route. Motion, spacing and colour are design
 * decisions reviewed in a browser, not asserted in a test suite.
 */

const WEB = path.resolve(import.meta.dir, '..')
const APP = path.join(WEB, 'app')

async function walk(dir: string, filter: (f: string) => boolean): Promise<string[]> {
  const out: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'test-results'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full, filter))
    else if (filter(entry.name)) out.push(full)
  }
  return out
}

/** Every routable path the App Router actually serves. */
async function actualRoutes(): Promise<{ statics: Set<string>; dynamics: RegExp[] }> {
  const pages = await walk(APP, (f) => f === 'page.tsx' || f === 'route.ts')
  const statics = new Set<string>()
  const dynamics: RegExp[] = []
  for (const page of pages) {
    const rel = path.relative(APP, path.dirname(page))
    // Route groups like (marketing) do not appear in the URL.
    const segments = rel.split(path.sep).filter((s) => s && !s.startsWith('('))
    const route = `/${segments.join('/')}`.replace(/\/$/, '') || '/'
    if (route.includes('[')) {
      const pattern = route
        .replace(/\[\[\.\.\.[^\]]+\]\]/g, '(?:.*)')
        .replace(/\[\.\.\.[^\]]+\]/g, '.+')
        .replace(/\[[^\]]+\]/g, '[^/]+')
      dynamics.push(new RegExp(`^${pattern}$`))
    } else {
      statics.add(route)
    }
  }
  return { statics, dynamics }
}

function resolves(target: string, routes: { statics: Set<string>; dynamics: RegExp[] }): boolean {
  const pathOnly = (target.split('#')[0] ?? '').split('?')[0] ?? ''
  const normalized = pathOnly.length > 1 ? pathOnly.replace(/\/$/, '') : pathOnly
  if (!normalized || normalized === '/') return true
  if (routes.statics.has(normalized)) return true
  return routes.dynamics.some((re) => re.test(normalized))
}

describe('public site link integrity', () => {
  test('every internal link target resolves to a real route', async () => {
    const routes = await actualRoutes()
    const sources = [
      ...await walk(APP, (f) => f.endsWith('.tsx')),
      ...await walk(path.join(WEB, 'components'), (f) => f.endsWith('.tsx')),
    ].filter((f) => !f.includes(`${path.sep}ui${path.sep}`))

    const broken: string[] = []
    for (const file of sources) {
      const src = await fs.readFile(file, 'utf8')
      // Literal internal hrefs only; computed targets are covered by typedRoutes at compile time.
      for (const match of src.matchAll(/href="(\/[^"]*)"/g)) {
        const target = match[1]!
        if (!resolves(target, routes)) broken.push(`${path.relative(WEB, file)} → ${target}`)
      }
    }

    expect(broken).toEqual([])
  })

  test('internal navigation uses next/link so routing stays client-side', async () => {
    const sources = [
      ...await walk(APP, (f) => f.endsWith('.tsx')),
      ...await walk(path.join(WEB, 'components'), (f) => f.endsWith('.tsx')),
    ].filter((f) => !f.includes(`${path.sep}ui${path.sep}`))

    const rawInternalAnchors: string[] = []
    for (const file of sources) {
      const src = await fs.readFile(file, 'utf8')
      for (const match of src.matchAll(/<a\b[^>]*href="\/[^"]*"/g)) {
        rawInternalAnchors.push(`${path.relative(WEB, file)}: ${match[0].slice(0, 60)}`)
      }
    }

    expect(rawInternalAnchors).toEqual([])
  })
})


describe('public site horizontal containment', () => {
  test('the decorative hero bloom cannot extend the document', async () => {
    const css = await fs.readFile(path.join(APP, 'globals.css'), 'utf8')

    // Generic horizontal overflow cannot be proved from source: scrollWidth depends on the
    // rendered cascade, pseudo-elements, fonts and viewport. The full check stays a browser
    // measurement. This fast guard covers the concrete regression that actually happened
    // twice: `.fuma-bloom::before` overhung its container and grew the document by exactly
    // the overhang width (16px at 390px, from `calc(100% + 2rem)`).
    const bloom = css.match(/\.fuma-bloom::before\s*\{(?<rules>[\s\S]*?)\}/)?.groups?.rules ?? ''
    // Assert the containment RULE rather than one literal width, so the guard survives design
    // changes: the bloom must be capped by min(<n>px, 100%) and carry max-width: 100%.
    expect(bloom).toMatch(/width:\s*min\(\s*\d+px\s*,\s*100%\s*\);/)
    expect(bloom).toContain('max-width: 100%;')
    // Document-level containment so no decorative layer can extend the page.
    expect(css).toContain('overflow-x: clip')
  })
})
