/**
 * Architecture gate — the React engine invariants.
 *
 * The visual builder's conversion to React rests on a short list of rules
 * recorded in `docs/architecture/react-engine-invariants.md`. This gate enforces
 * the ones that are mechanically checkable today and asserts the record still
 * enumerates all of them, so the list cannot silently shrink while the code that
 * depends on it keeps being written.
 *
 * Invariants 3 and 4 — typed TSX as canonical source, and opaque treatment of
 * arbitrary developer code — govern code that does not exist yet. They are
 * deliberately not asserted with a fake test; the record is the commitment until
 * the generator and reader land, at which point their own gates arrive with them.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const STUDIO_ROOT = join(import.meta.dir, '../../../')
const REPO_ROOT = join(STUDIO_ROOT, '../../')
const INVARIANTS_DOC = join(REPO_ROOT, 'docs/architecture/react-engine-invariants.md')

/**
 * Validation libraries other than TypeBox. Fuma validates with TypeBox at every
 * untyped boundary; a second one in Studio means two competing sources of truth.
 * Zod is legitimate in generated tenant site code, which is a separate package.
 */
const COMPETING_VALIDATORS = [
  'zod',
  'yup',
  'joi',
  'valibot',
  'superstruct',
  'ajv',
  'io-ts',
  'runtypes',
] as const

/** Animation libraries. Motion is the only permitted one. */
const ANIMATION_LIBRARIES = [
  'motion',
  'framer-motion',
  'gsap',
  'animejs',
  'popmotion',
  '@react-spring/web',
  'react-transition-group',
] as const

/** Icon sets. Lucide is what shadcn ships; Pixelarticons is existing chrome. */
const COMPETING_ICON_LIBRARIES = [
  '@phosphor-icons/react',
  'react-icons',
  '@heroicons/react',
  'feather-icons',
  'react-feather',
] as const

function studioDependencies(): Record<string, string> {
  const manifest: unknown = JSON.parse(readFileSync(join(STUDIO_ROOT, 'package.json'), 'utf8'))
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('apps/studio/package.json did not parse to an object')
  }
  const { dependencies, devDependencies } = manifest as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  return { ...(dependencies ?? {}), ...(devDependencies ?? {}) }
}

describe('react engine invariants', () => {
  it('records every invariant so the list cannot shrink unnoticed', () => {
    expect(existsSync(INVARIANTS_DOC)).toBe(true)
    const record = readFileSync(INVARIANTS_DOC, 'utf8')
    // One heading per invariant. Renumbering is fine; dropping one is not.
    const headings = record.match(/^## Invariant \d+ — .+$/gm) ?? []
    expect(headings.length).toBe(7)

    // Each invariant's subject must still be named, so a heading cannot be
    // reworded into something that no longer commits to anything.
    for (const subject of [
      'no HTML string authoring',
      'Tailwind is the only styling vocabulary',
      'canonical page source is typed TSX',
      'arbitrary developer code is opaque',
      'one animation library',
      'one validation library per side of the boundary',
      'one icon library',
    ]) {
      expect(record).toContain(subject)
    }
  })

  it('states the honest exception rather than claiming zero CSS variables', () => {
    const record = readFileSync(INVARIANTS_DOC, 'utf8')
    // Tailwind v4 compiles @theme tokens to custom properties. Pretending
    // otherwise would make the invariant unachievable and therefore ignored.
    expect(record).toContain('Honest exception')
    expect(record).toContain('compiles design tokens *to* CSS')
  })

  it('keeps Studio on one validation library', () => {
    const deps = studioDependencies()
    const found = COMPETING_VALIDATORS.filter((name) => name in deps)
    if (found.length > 0) {
      throw new Error(
        '[react-engine-invariants] Studio validates with TypeBox. A second validation '
        + `library belongs in generated site code, not here: ${found.join(', ')}. `
        + 'FUMA-032 fails for the same reason.',
      )
    }
    // TypeBox must actually be present, or the rule is vacuous.
    expect('@sinclair/typebox' in deps).toBe(true)
  })

  it('permits at most one animation library, and only Motion', () => {
    const deps = studioDependencies()
    const found = ANIMATION_LIBRARIES.filter((name) => name in deps)
    expect(found.length).toBeLessThanOrEqual(1)
    for (const name of found) {
      expect(name).toBe('motion')
    }
  })

  it('does not depend on paid Motion+ components', () => {
    const deps = studioDependencies()
    // Motion+ ships through the same package behind a licence; a separate
    // dependency named for it would mean a paid feature became load-bearing.
    expect('motion-plus' in deps).toBe(false)
    expect('@motionone/plus' in deps).toBe(false)
  })

  it('keeps one icon library for shadcn surfaces', () => {
    const deps = studioDependencies()
    const found = COMPETING_ICON_LIBRARIES.filter((name) => name in deps)
    if (found.length > 0) {
      throw new Error(
        '[react-engine-invariants] shadcn ships Lucide and is designed around it. '
        + `Remove the competing icon set: ${found.join(', ')}.`,
      )
    }
    expect('lucide-react' in deps).toBe(true)
  })

  it('pins the icon library to an exact version so surfaces cannot drift apart', () => {
    const deps = studioDependencies()
    const pinned = deps['lucide-react']
    expect(pinned).toBeDefined()
    // A range lets two apps in one monorepo resolve different icon sets, which
    // shows up as mismatched stroke weights between surfaces.
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
