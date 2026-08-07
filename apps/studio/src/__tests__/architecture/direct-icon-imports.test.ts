/**
 * Architecture Source-Scan — Direct Icon Imports
 *
 * Production UI must import concrete icon components from
 * `pixel-art-icons/icons/<name>` instead of rendering through any lazy `Icon`
 * wrapper. Direct file imports keep the large icon catalog available without
 * adding first-render async loading or importing every icon.
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'

const SRC_ROOT = join(import.meta.dir, '../../')

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

const PROD_DIRS = ['editor', 'core', 'modules', 'ui', 'app', 'lib'].map((d) =>
  join(SRC_ROOT, d),
)

/**
 * Code generators are excluded.
 *
 * Files under `core/generatedSite/` emit source text for a *tenant's* site; they do not render
 * anything themselves. Scanning them as admin UI reports the tenant's `<Icon />` — a concrete
 * Lucide component chosen inside the generated file — as if the admin were rendering a lazy
 * wrapper. That is a false positive, and a gate that cries wolf gets ignored when it is right.
 */
const GENERATOR_DIRS = [join(SRC_ROOT, 'core', 'generatedSite')]

function isGenerator(file: string): boolean {
  return GENERATOR_DIRS.some((dir) => file.startsWith(dir))
}

function collectProdFiles(): string[] {
  return PROD_DIRS.flatMap((dir) => collectFiles(dir)).filter((file) => !isGenerator(file))
}

describe('Direct icon imports — no lazy Icon wrapper in production UI', () => {
  it('production source does not import a lazy pixel-art-icons/Icon wrapper or render <Icon>', () => {
    const violations: string[] = []

    for (const filePath of collectProdFiles()) {
      const rel = filePath.replace(SRC_ROOT, 'src/')

      const source = readFileSync(filePath, 'utf8')
      if (
        /from\s+['"]pixel-art-icons\/Icon['"]/.test(source) ||
        /<Icon\b/.test(source)
      ) {
        violations.push(rel)
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Lazy Icon wrapper usage found in production UI.\n` +
          `Import concrete icons from 'pixel-art-icons/icons/<name>' instead.\n\n` +
          violations.map((f) => `  ${f}`).join('\n'),
      )
    }

    expect(violations).toHaveLength(0)
  })
})
