import { describe, test, expect } from 'bun:test'
import { pgMigrations } from '../../../server/db/migrations-pg'

interface JsonbColumn { name: string; migrationId: string }
const JSONB_COLUMN = /(\w+)\s+jsonb\b/g

function jsonbColumns(): JsonbColumn[] {
  const columns: JsonbColumn[] = []
  for (const migration of pgMigrations) {
    JSONB_COLUMN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = JSONB_COLUMN.exec(migration.sql)) !== null) {
      columns.push({ name: match[1]!, migrationId: migration.id })
    }
  }
  return columns
}

describe('PostgreSQL JSON column naming', () => {
  test('every jsonb column has the _json suffix', () => {
    const violations = jsonbColumns().filter(({ name }) => !name.endsWith('_json'))
    if (violations.length > 0) {
      throw new Error(`PostgreSQL jsonb columns must end in _json:\n${violations.map(({ name, migrationId }) => `  ${name} (${migrationId})`).join('\n')}`)
    }
    expect(violations).toEqual([])
  })
})
