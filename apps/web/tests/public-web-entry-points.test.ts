import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Value } from '@sinclair/typebox/value'
import { PublicHandoffRequestSchema } from '@fuma/public-contracts'

/**
 * Two production regressions the existing link test could not catch, because it
 * strips the query string before resolving a target:
 *
 *   1. `/start` renders only when its `kind`/`source` parameters satisfy
 *      PublicHandoffRequestSchema. The footer and mobile menu shipped
 *      `source=footer` and `source=mobile_menu`, which are not in the schema, so
 *      every login and sign-up entry point from those surfaces returned 404.
 *   2. The standalone server serves `/public` assets only if that directory is
 *      copied into the runtime image. It was not, so every product screenshot
 *      404'd in production while resolving locally.
 *
 * Whether a deployed asset actually responds 200 is an HTTP fact, not a source
 * fact, so that assertion lives in the deploy smoke test rather than here.
 */

const WEB = path.resolve(import.meta.dir, '..')
const APP = path.join(WEB, 'app')
const COMPONENTS = path.join(WEB, 'components')
const LIB = path.join(WEB, 'lib')

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

async function productionSources(): Promise<string[]> {
  return [
    ...await walk(APP, (f) => f.endsWith('.tsx') || f.endsWith('.ts')),
    ...await walk(COMPONENTS, (f) => f.endsWith('.tsx') || f.endsWith('.ts')),
    ...await walk(LIB, (f) => f.endsWith('.ts')),
  ].filter((f) => !f.includes(`${path.sep}ui${path.sep}`) && !f.includes('.test.'))
}

/** Reproduce the route's own validation: unknown keys or values must not ship. */
function handoffRejects(target: string): string | null {
  // Runtime-composed targets are validated by their construction site, not here.
  if (target.includes('${')) return null
  const query = target.split('?')[1]
  if (!query) return 'missing handoff parameters'
  const params = new URLSearchParams(query.replaceAll('&amp;', '&'))
  const raw = Object.fromEntries(params.entries())
  const kind = raw.kind
  if (typeof kind !== 'string') return 'missing kind'

  const value: Record<string, unknown> = { kind, source: raw.source }
  for (const key of ['profile', 'planId', 'priceBookVersion', 'cadence', 'templateId', 'expertId'] as const) {
    if (raw[key]) value[key] = raw[key]
  }

  return Value.Check(PublicHandoffRequestSchema, value) ? null : 'rejected by PublicHandoffRequestSchema'
}

describe('public handoff entry points', () => {
  test('every literal /start link the site renders satisfies the handoff schema', async () => {
    const broken: string[] = []
    for (const file of await productionSources()) {
      const src = await fs.readFile(file, 'utf8')
      for (const match of src.matchAll(/['"`](\/start\?[^'"`]+)['"`]/g)) {
        const target = match[1]!
        const reason = handoffRejects(target)
        if (reason) broken.push(`${path.relative(WEB, file)} → ${target} (${reason})`)
      }
    }
    expect(broken).toEqual([])
  })

  test('login and sign-up are reachable from the footer and the mobile menu', async () => {
    for (const file of ['components/site-shell.tsx', 'components/mobile-menu.tsx']) {
      const src = await fs.readFile(path.join(WEB, file), 'utf8')
      const targets = [...src.matchAll(/['"`](\/start\?[^'"`]+)['"`]/g)].map((m) => m[1]!)
      expect(targets.some((t) => t.includes('kind=sign_in'))).toBe(true)
      expect(targets.some((t) => t.includes('kind=sign_up'))).toBe(true)
      for (const target of targets) expect(handoffRejects(target)).toBeNull()
    }
  })
})

describe('public static assets', () => {
  test('the runtime image ships the public directory alongside standalone output', async () => {
    const dockerfile = await fs.readFile(
      path.resolve(WEB, '../../infra/fuma-phase-13-18/docker/public-web.Dockerfile'),
      'utf8',
    )
    expect(dockerfile).toContain('/workspace/apps/web/.next/standalone')
    expect(dockerfile).toContain('/workspace/apps/web/.next/static')
    // Without this the standalone server returns 404 for every /public asset.
    expect(dockerfile).toContain('/workspace/apps/web/public ./apps/web/public')
  })

  test('committed product imagery backs the paths the site renders', async () => {
    const committed = await walk(path.join(WEB, 'public'), () => true)
    expect(committed.length).toBeGreaterThan(0)
    const referenced = new Set<string>()
    for (const file of await productionSources()) {
      const src = await fs.readFile(file, 'utf8')
      // JSX image attributes for real assets, not the HTML shown inside code samples.
      for (const match of src.matchAll(/\bsrc=\{?["'](\/product\/[\w.-]+)["']/g)) referenced.add(match[1]!)
    }
    const missing = [...referenced].filter((asset) => !committed.some((f) => f.endsWith(asset)))
    expect(missing).toEqual([])
  })
})
