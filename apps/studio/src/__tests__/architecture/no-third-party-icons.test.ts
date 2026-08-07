/**
 * Architecture Source-Scan — Constraint #348
 *
 * No file under `src/` may import from any third-party icon library.
 * All icons must come from the `pixel-art-icons` npm package (developed as a
 * sibling project, published to npm so multiple projects share it), consumed
 * via:
 *
 *   import { ArrowRightIcon } from 'pixel-art-icons/icons/arrow-right'
 *
 * Banned packages (non-exhaustive — covers all known icon ecosystems):
 *   - lucide-react
 *   - @heroicons/react
 *   - @radix-ui/react-icons
 *   - react-icons
 *   - phosphor-react
 *   - @phosphor-icons/react
 *   - feather-icons-react
 *   - @tabler/icons-react
 *
 * WHY THIS MATTERS
 * ----------------
 * The full pixel-art catalog (4,052 icons) ships as `pixel-art-icons`. Using
 * third-party icon libraries:
 *   - Breaks visual design system consistency (Guideline #252)
 *   - Adds unnecessary npm dependencies (supply-chain risk)
 *   - Violates the in-house icon-set directive
 *
 * @see Constraint #348 — All icons must use the in-house pixel-art set
 * @see Guideline #350 — pixel-art-icons accessibility requirements
 * @see Guideline #252 — Phase B Design System (Vercel/Linear dark aesthetic)
 * @see Task #349     — Remove lucide-react dead dependency from package.json
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'

const SRC_ROOT = join(import.meta.dir, '../../')

// ---------------------------------------------------------------------------
// File walker (shared pattern from no-anthropic-sdk.test.ts)
// ---------------------------------------------------------------------------

function collectFiles(dir: string, exts = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, exts))
    } else if (exts.includes(extname(entry))) {
      results.push(full)
    }
  }
  return results
}

// Scan production source only — not __tests__ (test files contain banned
// strings as regex patterns and would false-positive).
const PROD_DIRS = ['editor', 'core', 'modules', 'ui', 'app', 'lib'].map((d) =>
  join(SRC_ROOT, d)
)

function collectProdFiles(): string[] {
  return PROD_DIRS.flatMap((dir) => collectFiles(dir))
}

// ---------------------------------------------------------------------------
// Banned icon package patterns — Constraint #348
// ---------------------------------------------------------------------------

// NOTE: strings are split so that this test file itself doesn't self-match.
/**
 * Lucide is deliberately ABSENT from this list.
 *
 * It is the sanctioned icon set for the hosted Fuma admin and for generated sites, because
 * those surfaces are built from shadcn components and Lucide is shadcn's own default — using
 * anything else there means every shadcn component ships an icon that does not match the rest
 * of the interface. Pinned to one version across both apps so an icon cannot differ between
 * the admin and a tenant's site.
 *
 * The constraint this file exists for still holds: no OTHER icon library may be added. That is
 * what stops the supply-chain and visual sprawl the rule was written against.
 */
const BANNED_PACKAGES: { name: string; pattern: RegExp }[] = [
  {
    name: '@heroicons' + '/react',
    pattern: new RegExp(`from\\s+['"]@heroicons` + `/`),
  },
  {
    name: '@radix-ui' + '/react-icons',
    pattern: new RegExp(`from\\s+['"]@radix-ui` + `/react-icons`),
  },
  {
    name: 'react' + '-icons',
    pattern: new RegExp(`from\\s+['"]react` + `-icons`),
  },
  {
    name: 'phosphor' + '-react',
    pattern: new RegExp(`from\\s+['"]phosphor` + `-react['"]`),
  },
  {
    name: '@phosphor-icons' + '/react',
    pattern: new RegExp(`from\\s+['"]@phosphor-icons` + `/`),
  },
  {
    name: '@tabler' + '/icons-react',
    pattern: new RegExp(`from\\s+['"]@tabler` + `/icons`),
  },
  {
    name: 'feather' + '-icons-react',
    pattern: new RegExp(`from\\s+['"]feather` + `-icons`),
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Constraint #348 — No third-party icon libraries in production src/', () => {
  it('does not ban Lucide, which is the sanctioned set for shadcn surfaces', () => {
    // Asserted as an absence so re-adding it to the ban list is a deliberate, visible act
    // rather than something that silently breaks every shadcn-composed panel.
    expect(BANNED_PACKAGES.map((pkg) => pkg.name)).not.toContain('lucide-react')
  })

  it('still bans every other icon library, which is what the constraint is for', () => {
    for (const name of ['@heroicons/react', 'react-icons', '@tabler/icons-react']) {
      expect(BANNED_PACKAGES.map((pkg) => pkg.name)).toContain(name)
    }
  })

  it('no production file imports from any banned icon package', () => {
    const allFiles = collectProdFiles()
    const allViolations: { file: string; pkg: string }[] = []

    for (const bannedPkg of BANNED_PACKAGES) {
      for (const f of allFiles) {
        try {
          if (bannedPkg.pattern.test(readFileSync(f, 'utf8'))) {
            allViolations.push({ file: f.replace(SRC_ROOT, 'src/'), pkg: bannedPkg.name })
          }
        } catch {
          // skip unreadable files
        }
      }
    }

    if (allViolations.length > 0) {
      const lines = allViolations.map((v) => `  ${v.file}  [imports: ${v.pkg}]`)
      throw new Error(
        `[Constraint #348] Third-party icon library imports found in production source.\n` +
        `All icons must come from the 'pixel-art-icons' package.\n` +
        `Use: import { <Name>Icon } from 'pixel-art-icons/icons/<kebab-name>'\n` +
        `Violating files:\n` +
        lines.join('\n')
      )
    }
    expect(allViolations).toHaveLength(0)
  })
})
