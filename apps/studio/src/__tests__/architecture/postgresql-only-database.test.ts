import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { pgMigrations } from '../../../server/db/migrations-pg'
import { DEFAULT_LOCAL_DATABASE_URL } from '../../../server/db'

const STUDIO_ROOT = join(import.meta.dir, '../../..')
const WORKSPACE_ROOT = join(STUDIO_ROOT, '../..')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

function walk(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory)) {
      if (['node_modules', 'dist', '.git', '.tmp'].includes(entry)) continue
      const path = join(directory, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) visit(path)
      else if (SOURCE_EXTENSIONS.has(extname(path))) files.push(path)
    }
  }
  visit(root)
  return files
}

function source(path: string): string {
  return readFileSync(path, 'utf8')
}

function relativeWorkspacePath(path: string): string {
  return relative(WORKSPACE_ROOT, path).replaceAll('\\', '/')
}

describe('PostgreSQL-only database architecture', () => {
  it('has one adapter and one canonical migration stream', () => {
    expect(existsSync(join(STUDIO_ROOT, 'server/db/postgres.ts'))).toBe(true)
    expect(existsSync(join(STUDIO_ROOT, 'server/db/migrations-pg.ts'))).toBe(true)
    expect(existsSync(join(STUDIO_ROOT, 'server/db/sqlite.ts'))).toBe(false)
    expect(existsSync(join(STUDIO_ROOT, 'server/db/migrations-sqlite.ts'))).toBe(false)

    const ids = pgMigrations.map(({ id }) => id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('requires PostgreSQL URLs and keeps the local default canonical', () => {
    expect(DEFAULT_LOCAL_DATABASE_URL).toBe('postgres://instatic:instatic@127.0.0.1:5433/instatic')
    const dbFactory = source(join(STUDIO_ROOT, 'server/db/index.ts'))
    expect(dbFactory).toContain("import { createPostgresClient } from './postgres'")
    expect(dbFactory).toContain("migrations: pgMigrations")
    expect(dbFactory).toContain("isPostgresDatabaseUrl(normalized)")
    expect(dbFactory).not.toMatch(/createSqliteClient|sqliteMigrations|migrations-sqlite/)
  })

  it('contains no SQLite runtime, local-tooling, benchmark, or ordinary-test dependency', () => {
    const productionFiles = [
      ...walk(join(STUDIO_ROOT, 'server')),
      ...walk(join(STUDIO_ROOT, 'scripts')),
    ].filter((path) => !/\.(?:test|spec)\.[^.]+$/.test(path) && !path.includes('/__tests__/'))
    const ordinaryTests = [
      ...walk(join(STUDIO_ROOT, 'server')),
      ...walk(join(STUDIO_ROOT, 'src/__tests__')),
      ...walk(join(STUDIO_ROOT, 'tests')),
    ].filter((path) => /\.(?:test|spec)\.[^.]+$/.test(path) && !path.includes('/__tests__/architecture/'))
    const forbidden = /bun:sqlite|createSqliteClient|sqliteMigrations|migrations-sqlite|server\/db\/sqlite|legacySqliteTransitionSource|fuma\/transition/i
    const violations = [...productionFiles, ...ordinaryTests]
      .filter((path) => forbidden.test(source(path)))
      .map(relativeWorkspacePath)
    expect(violations).toEqual([])
  })

  it('ships no SQLite deployment or transition artifact', () => {
    for (const path of [
      'compose.sqlite.yml',
      'docs/deployment/render/sqlite/render.yaml',
      'apps/studio/scripts/fuma-transition.ts',
      'apps/studio/server/fuma/transition',
    ]) {
      expect(existsSync(join(WORKSPACE_ROOT, path)), `${path} must stay removed`).toBe(false)
    }

    const rootPackage = source(join(WORKSPACE_ROOT, 'package.json'))
    const studioPackage = source(join(STUDIO_ROOT, 'package.json'))
    expect(rootPackage).not.toContain('fuma:transition')
    expect(studioPackage).not.toContain('fuma:transition')
  })
})
