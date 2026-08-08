/**
 * Server code may not depend on a package the production image does not install.
 *
 * THE OUTAGE THIS CLOSES: `server/fuma/canvas/tailwindCompile.ts` imported `tailwindcss` at module
 * scope, and that module is reachable from `server/index.ts` through the canvas CSS route. Tailwind
 * resolved fine in the monorepo through the hoisted workspace node_modules, so every test and every
 * local run passed. But the runtime image builds with
 *
 *     RUN bun install --frozen-lockfile --production --filter @fuma/studio
 *
 * and `tailwindcss` was declared as a DEV dependency, so `--production` dropped it. The studio pod
 * crash-looped on `Cannot find package 'tailwindcss'`, the rollout failed, and the platform stayed on
 * the previous image - all to serve one endpoint.
 *
 * A TYPECHECK CANNOT CATCH THIS. Types resolve from the workspace, so tsc is clean either way. Only the
 * dependency SECTION distinguishes what the image installs, which is why this is a gate over
 * package.json rather than a compile step.
 */

import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const STUDIO = join(import.meta.dir, '..', '..', '..')
const SERVER = join(STUDIO, 'server')

const manifest = JSON.parse(readFileSync(join(STUDIO, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const runtimeDeps = new Set(Object.keys(manifest.dependencies ?? {}))
const devOnlyDeps = new Set(
  Object.keys(manifest.devDependencies ?? {}).filter((name) => !runtimeDeps.has(name)),
)

function serverFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      serverFiles(full, found)
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) {
      found.push(full)
    }
  }
  return found
}

/** Bare specifiers only. A relative path is not a package. */
function importedPackages(source: string): string[] {
  const packages = new Set<string>()
  for (const match of source.matchAll(/(?:from|import)\s+['"]([^'".][^'"]*)['"]/g)) {
    const specifier = match[1]
    if (specifier.startsWith('node:') || specifier.startsWith('bun:')) continue
    const parts = specifier.split('/')
    packages.add(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
  }
  return [...packages]
}

describe('the production image installs everything the server imports', () => {
  it('no server file imports a package that only exists in devDependencies', () => {
    const offenders: string[] = []
    for (const file of serverFiles(SERVER)) {
      const source = readFileSync(file, 'utf8')
      for (const pkg of importedPackages(source)) {
        if (devOnlyDeps.has(pkg)) {
          offenders.push(`${file.slice(STUDIO.length + 1)} imports dev-only '${pkg}'`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('tailwindcss specifically is a RUNTIME dependency, since the canvas compiles CSS server-side', () => {
    // Named explicitly because this is the one that caused the outage, so a move back to
    // devDependencies fails here with the reason rather than in a cluster ten minutes later.
    expect(runtimeDeps.has('tailwindcss')).toBe(true)
    expect(devOnlyDeps.has('tailwindcss')).toBe(false)
  })

  it('the runtime image really does drop dev dependencies, so this gate is not theatre', () => {
    const dockerfile = readFileSync(
      join(STUDIO, '..', '..', 'infra', 'fuma-phase-13-18', 'docker', 'runtime.Dockerfile'),
      'utf8',
    )
    expect(dockerfile).toContain('--production')
  })

  it('the canvas compiler loads tailwind LAZILY so a resolution failure degrades one endpoint', () => {
    // Defence in depth on top of the declaration: a dependency only one feature needs must not decide
    // whether the server boots.
    const source = readFileSync(join(SERVER, 'fuma', 'canvas', 'tailwindCompile.ts'), 'utf8')
    expect(source).toContain("await import('tailwindcss')")
    // The top-level import must be gone, or the lazy path is decoration.
    expect(source).not.toMatch(/^import \{ compile \} from 'tailwindcss'/m)
  })
})
