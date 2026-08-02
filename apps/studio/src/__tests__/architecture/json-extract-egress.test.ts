import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const PROJECT_ROOT = join(import.meta.dir, '../../..')
const SERVER_ROOT = join(PROJECT_ROOT, 'server')
const COMMENT_RE = /\/\/.*$|\/\*[\s\S]*?\*\//gm

function walk(directory: string, files: string[] = []): string[] {
  if (!existsSync(directory)) return files
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, files)
    else if (extname(path) === '.ts' && !path.includes('/__tests__/') && !path.endsWith('.test.ts')) files.push(path)
  }
  return files
}

function sqliteJsonExtractionViolations(): string[] {
  const violations: string[] = []
  for (const path of walk(SERVER_ROOT)) {
    const lines = readFileSync(path, 'utf8')
      .replace(COMMENT_RE, (comment) => comment.replace(/[^\n]/g, ' '))
      .split('\n')
    lines.forEach((line, index) => {
      if (/\bjson_extract\s*\(/i.test(line)) {
        violations.push(`${relative(PROJECT_ROOT, path)}:${index + 1}`)
      }
    })
  }
  return violations
}

describe('PostgreSQL JSON extraction', () => {
  test('keeps the validated PostgreSQL jsonField helper present', () => {
    const helper = join(PROJECT_ROOT, 'server/db/jsonExtract.ts')
    expect(existsSync(helper)).toBe(true)
    expect(readFileSync(helper, 'utf8')).toContain("sql: `${column}->>'${field}'`")
  })

  test('contains no SQLite JSON extraction operator in production server code', () => {
    expect(sqliteJsonExtractionViolations()).toEqual([])
  })
})
