import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../../../..')

function read(path: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8')
}

describe('workspace test-process isolation', () => {
  test('keeps Studio happy-dom globals out of independent Next and governance suites', () => {
    const bunfig = read('bunfig.toml')
    const manifest = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>
    }

    expect(bunfig).toContain('preload = ["./apps/studio/src/__tests__/setup.ts"]')
    for (const isolatedSuite of [
      'apps/web/tests/**',
      'apps/control-surfaces/tests/**',
      'packages/fuma-governance-launch/tests/**',
    ]) {
      expect(bunfig).toContain(`"${isolatedSuite}"`)
    }

    expect(manifest.scripts?.['test:web']).toBe('bun --cwd=apps/web run test')
    expect(manifest.scripts?.['test:control']).toBe('bun --cwd=apps/control-surfaces run test')
    expect(manifest.scripts?.['test:governance']).toBe('bun --cwd=packages/fuma-governance-launch run test')
    expect(manifest.scripts?.test).toBe(
      'bun test && bun run test:web && bun run test:control && bun run test:governance',
    )
  })
})
