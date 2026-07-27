import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'

const HOSTED_MIGRATION_ID = /^(\d{6})_([a-z][a-z0-9]*(?:_[a-z0-9]+)*)$/
const DESTRUCTIVE_SQL = /\b(?:drop\s+(?:(?:materialized\s+)?view|table|column|constraint|index|schema|database|trigger|function|type|sequence)|truncate(?:\s+table)?|delete\s+from|alter\s+table[\s\S]{0,200}?\b(?:drop\s+(?:column|constraint)|rename\s+(?:column|to))|vacuum\s+full|reindex)\b/i
const TRANSACTION_SQL = /\b(?:begin|commit|rollback|savepoint)\b/i

/**
 * Removes SQL comments and quoted string/dollar bodies before top-level policy
 * checks. Procedure bodies legitimately contain PL/pgSQL BEGIN/END blocks;
 * transaction control remains forbidden everywhere else because the hosted
 * runner owns the outer transaction.
 */
function topLevelSql(sql: string): string {
  let result = ''
  let index = 0

  while (index < sql.length) {
    const current = sql[index]
    const next = sql[index + 1]

    if (current === '-' && next === '-') {
      index += 2
      while (index < sql.length && sql[index] !== '\n') index += 1
      result += '\n'
      continue
    }

    if (current === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2)
      index = end === -1 ? sql.length : end + 2
      result += ' '
      continue
    }

    if (current === "'") {
      index += 1
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2
          continue
        }
        if (sql[index] === "'") {
          index += 1
          break
        }
        index += 1
      }
      result += ' '
      continue
    }

    if (current === '$') {
      const delimiterMatch = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index))
      if (delimiterMatch) {
        const delimiter = delimiterMatch[0]
        const bodyEnd = sql.indexOf(delimiter, index + delimiter.length)
        index = bodyEnd === -1 ? sql.length : bodyEnd + delimiter.length
        result += ' '
        continue
      }
    }

    result += current
    index += 1
  }

  return result
}

export type HostedMigration = Readonly<{
  id: string
  description: string
  sql: string
}>

export type HostedMigrationHistoryRow = Readonly<{
  id: string
  checksum: string
}>

export const HostedMigrationReportSchema = Type.Object({
  mode: Type.Union([Type.Literal('dry-run'), Type.Literal('apply')]),
  currentId: Type.Union([Type.String(), Type.Null()]),
  nextId: Type.String(),
  applied: Type.Array(Type.String()),
  pending: Type.Array(Type.String()),
}, { additionalProperties: false })

export type HostedMigrationReport = Static<typeof HostedMigrationReportSchema>

export class HostedMigrationError extends Error {
  readonly migrationId: string | null

  constructor(message: string, migrationId: string | null = null) {
    super(message)
    this.name = 'HostedMigrationError'
    this.migrationId = migrationId
  }
}

export function hostedMigrationChecksum(sql: string): string {
  return new Bun.CryptoHasher('sha256').update(sql).digest('hex')
}

export function assertHostedMigrationIsAdditive(migration: HostedMigration): void {
  if (DESTRUCTIVE_SQL.test(migration.sql)) {
    throw new HostedMigrationError(
      `Hosted migration ${migration.id} contains destructive SQL; Fuma migrations are additive and forward-only.`,
      migration.id,
    )
  }
  if (TRANSACTION_SQL.test(topLevelSql(migration.sql))) {
    throw new HostedMigrationError(
      `Hosted migration ${migration.id} contains transaction control; the hosted runner owns the transaction.`,
      migration.id,
    )
  }
}

export function nextHostedMigrationId(
  migrations: readonly HostedMigration[],
  description: string,
): string {
  const slug = description.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(slug)) {
    throw new HostedMigrationError('Hosted migration description must produce a non-empty snake_case name.')
  }
  const highest = migrations.reduce((max, migration) => {
    const match = HOSTED_MIGRATION_ID.exec(migration.id)
    if (!match) throw new HostedMigrationError(`Invalid hosted migration ID: ${migration.id}`, migration.id)
    return Math.max(max, Number(match[1]))
  }, 0)
  return `${String(highest + 1).padStart(6, '0')}_${slug}`
}

export const HOSTED_MIGRATION_CHECKSUM_SENTINEL = '0'.repeat(64)

export function assertHostedMigrationManifest(
  migrations: readonly HostedMigration[],
  immutableChecksums: Readonly<Record<string, string>>,
): void {
  const ids = migrations.map(({ id }) => id)
  const manifestIds = Object.keys(immutableChecksums)
  if (new Set(ids).size !== ids.length) throw new HostedMigrationError('Hosted migration IDs must be unique.')
  if (ids.join('\n') !== [...ids].sort().join('\n')) {
    throw new HostedMigrationError('Hosted migrations must be ordered by increasing ID.')
  }
  if (ids.join('\n') !== manifestIds.join('\n')) {
    throw new HostedMigrationError('Hosted migration history was added, deleted, or reordered without updating its immutable manifest.')
  }
  let reachedUnappliedSuffix = false
  for (const migration of migrations) {
    if (!HOSTED_MIGRATION_ID.test(migration.id)) {
      throw new HostedMigrationError(`Invalid hosted migration ID: ${migration.id}`, migration.id)
    }
    assertHostedMigrationIsAdditive(migration)
    const declaredChecksum = immutableChecksums[migration.id]
    if (declaredChecksum === HOSTED_MIGRATION_CHECKSUM_SENTINEL) {
      reachedUnappliedSuffix = true
      continue
    }
    if (reachedUnappliedSuffix) {
      throw new HostedMigrationError(
        `Hosted migration ${migration.id} is finalized after an unapplied migration. Finalize checksums in source order.`,
        migration.id,
      )
    }
    if (hostedMigrationChecksum(migration.sql) !== declaredChecksum) {
      throw new HostedMigrationError(
        `Hosted migration ${migration.id} no longer matches its immutable checksum. Add a new migration instead of editing history.`,
        migration.id,
      )
    }
  }
}

export function planHostedMigrations(
  migrations: readonly HostedMigration[],
  history: readonly HostedMigrationHistoryRow[],
): { applied: string[]; pending: HostedMigration[] } {
  const byId = new Map(migrations.map((migration) => [migration.id, migration]))
  const historyIds = history.map(({ id }) => id)
  if (new Set(historyIds).size !== historyIds.length) {
    throw new HostedMigrationError('Hosted migration history contains duplicate IDs.')
  }
  if (historyIds.join('\n') !== [...historyIds].sort().join('\n')) {
    throw new HostedMigrationError('Hosted migration history is not ordered.')
  }
  for (const row of history) {
    const migration = byId.get(row.id)
    if (!migration) {
      throw new HostedMigrationError(
        `Applied hosted migration ${row.id} is absent from source history. Restore the deleted migration.`,
        row.id,
      )
    }
    const checksum = hostedMigrationChecksum(migration.sql)
    if (row.checksum !== checksum) {
      throw new HostedMigrationError(
        `Applied hosted migration ${row.id} has an edited checksum. Restore history and add a new migration.`,
        row.id,
      )
    }
  }
  const expectedPrefix = migrations.slice(0, history.length).map(({ id }) => id)
  if (historyIds.join('\n') !== expectedPrefix.join('\n')) {
    throw new HostedMigrationError('Hosted migration history is not a contiguous forward-only prefix.')
  }
  return { applied: historyIds, pending: migrations.slice(history.length) }
}

export function validateHostedMigrationReport(value: unknown): HostedMigrationReport {
  const parsed = safeParseValue(HostedMigrationReportSchema, value)
  if (!parsed.ok) throw new HostedMigrationError('Hosted migration report failed validation.')
  return parsed.value
}
