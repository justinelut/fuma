import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { pgMigrations } from '../../../server/db/migrations-pg'

const PROJECT_ROOT = join(import.meta.dir, '../../../')

function walk(directory: string, output: string[] = []): string[] {
  if (!existsSync(directory)) return output
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) walk(full, output)
    else if (extname(entry) === '.ts') output.push(full)
  }
  return output
}

function hasLegacyTableDdl(sql: string): boolean {
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase()
  return normalized.includes('create table pages')
    || normalized.includes('create table page_versions')
    || normalized.includes('create table if not exists pages')
    || normalized.includes('create table if not exists page_versions')
}

describe('PostgreSQL schema has no legacy page tables', () => {
  test('no migration creates pages or page_versions', () => {
    expect(pgMigrations.filter((migration) => hasLegacyTableDdl(migration.sql))).toEqual([])
  })

  test('live server SQL does not query removed page tables', () => {
    const migrationFile = join(PROJECT_ROOT, 'server/db/migrations-pg.ts')
    const violations: string[] = []
    for (const file of walk(join(PROJECT_ROOT, 'server')).filter((candidate) => candidate !== migrationFile)) {
      const stripped = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      if (/\bfrom\s+page(?:s|_versions)\b/i.test(stripped)) violations.push(relative(PROJECT_ROOT, file))
    }
    expect(violations).toEqual([])
  })
})
