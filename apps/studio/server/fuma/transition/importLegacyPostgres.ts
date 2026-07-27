import {
  backfillLegacyStaffIdentities,
  backfillLegacyStaffIdentitiesInTransaction,
} from '../../auth/hosted/legacyIdentity'
import type { DbClient } from '../../db/client'
import {
  decodeDatabaseValue,
  encodeDatabaseValue,
  tableContentHash,
  validateLegacyTransitionArtifact,
  type EncodedDatabaseValue,
  type LegacyTransitionArtifact,
  type LegacyTransitionTable,
} from './artifact'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new LegacyImportError(`Unsafe transition identifier: ${value}`)
  return `"${value}"`
}

export class LegacyImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LegacyImportError'
  }
}
export class LegacyImportCountMismatchError extends LegacyImportError {
  constructor(table: string) {
    super(`Legacy import row-count validation failed for ${table}.`)
    this.name = 'LegacyImportCountMismatchError'
  }
}
export class LegacyImportHashMismatchError extends LegacyImportError {
  constructor(table: string) {
    super(`Legacy import content-hash validation failed for ${table}.`)
    this.name = 'LegacyImportHashMismatchError'
  }
}
export class LegacyImportForeignKeyMismatchError extends LegacyImportError {
  constructor(table: string, column: string) {
    super(`Legacy import foreign-key validation failed for ${table}.${column}.`)
    this.name = 'LegacyImportForeignKeyMismatchError'
  }
}

interface DestinationColumn {
  column_name: string
  data_type: string
}

export function assertLegacyTableValidation(input: Readonly<{
  table: string
  expectedCount: number
  actualCount: number
  expectedHash: string
  actualHash: string
  foreignKeyViolations: ReadonlyArray<{ column: string; count: number }>
}>): void {
  if (input.actualCount !== input.expectedCount) throw new LegacyImportCountMismatchError(input.table)
  if (input.actualHash !== input.expectedHash) throw new LegacyImportHashMismatchError(input.table)
  const violation = input.foreignKeyViolations.find(({ count }) => count !== 0)
  if (violation) throw new LegacyImportForeignKeyMismatchError(input.table, violation.column)
}
interface ImportReceipt {
  artifact_hash: string
  state: 'running' | 'complete'
}
interface ImportedTableReceipt {
  table_name: string
  row_count: number | bigint
  content_hash: string
}

export interface LegacyImportReport {
  sourceFingerprint: string
  artifactHash: string
  tableCount: number
  rowCount: number
  importedTables: string[]
  resumedTables: string[]
  complete: boolean
}

function primaryKeyColumns(table: LegacyTransitionTable): string[] {
  return table.columns
    .filter(({ primaryKeyPosition }) => primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
    .map(({ name }) => name)
}

function orderedTables(artifact: LegacyTransitionArtifact): LegacyTransitionTable[] {
  const remaining = new Map(artifact.tables.map((table) => [table.name, table]))
  const ordered: LegacyTransitionTable[] = []
  const completed = new Set<string>()
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((table) => table.foreignKeys.every((foreignKey) => {
      const column = table.columns.find(({ name }) => name === foreignKey.fromColumn)
      if (!column?.notNull) return true
      return foreignKey.targetTable !== table.name && completed.has(foreignKey.targetTable)
    }))
    if (ready.length === 0) {
      throw new LegacyImportError('Legacy import contains a non-nullable foreign-key cycle.')
    }
    ready.sort((left, right) => left.name.localeCompare(right.name))
    for (const table of ready) {
      ordered.push(table)
      completed.add(table.name)
      remaining.delete(table.name)
    }
  }
  return ordered
}

async function destinationColumns(db: DbClient, table: LegacyTransitionTable): Promise<Map<string, DestinationColumn>> {
  const result = await db<DestinationColumn>`
    select column_name, data_type
    from information_schema.columns
    where table_schema = current_schema() and table_name = ${table.name}
    order by ordinal_position
  `
  const columns = new Map(result.rows.map((column) => [column.column_name, column]))
  for (const sourceColumn of table.columns) {
    if (!columns.has(sourceColumn.name)) {
      throw new LegacyImportError(`PostgreSQL destination is missing ${table.name}.${sourceColumn.name}.`)
    }
  }
  return columns
}

function decodedValue(value: EncodedDatabaseValue, destinationType: string): unknown {
  const decoded = decodeDatabaseValue(value)
  if (destinationType === 'boolean' && typeof decoded === 'number') return decoded !== 0
  return decoded
}

function insertSql(table: LegacyTransitionTable): string {
  const columnNames = table.columns.map(({ name }) => name)
  const keys = primaryKeyColumns(table)
  if (keys.length === 0) throw new LegacyImportError(`Legacy import table ${table.name} has no primary key.`)
  const assignments = columnNames
    .filter((name) => !keys.includes(name))
    .map((name) => `${quoteIdentifier(name)} = excluded.${quoteIdentifier(name)}`)
  const conflict = assignments.length > 0 ? `do update set ${assignments.join(', ')}` : 'do nothing'
  return `insert into ${quoteIdentifier(table.name)} (${columnNames.map(quoteIdentifier).join(', ')}) values (${columnNames.map((_, index) => `$${index + 1}`).join(', ')}) on conflict (${keys.map(quoteIdentifier).join(', ')}) ${conflict}`
}

async function upsertTableRows(
  db: DbClient,
  table: LegacyTransitionTable,
  columns: ReadonlyMap<string, DestinationColumn>,
  availableTables: ReadonlySet<string>,
): Promise<void> {
  const deferredColumns = new Set(table.foreignKeys
    .filter(({ targetTable }) => targetTable === table.name || !availableTables.has(targetTable))
    .map(({ fromColumn }) => fromColumn))
  const sql = insertSql(table)
  for (const row of table.rows) {
    const params = table.columns.map(({ name }) => {
      if (deferredColumns.has(name)) return null
      const destination = columns.get(name)
      if (!destination) throw new LegacyImportError(`Destination column metadata missing for ${table.name}.${name}.`)
      return decodedValue(row[name]!, destination.data_type)
    })
    await db.unsafe(sql, params)
  }
}

async function restoreTableRows(
  db: DbClient,
  table: LegacyTransitionTable,
  columns: ReadonlyMap<string, DestinationColumn>,
): Promise<void> {
  const sql = insertSql(table)
  for (const row of table.rows) {
    const params = table.columns.map(({ name }) => decodedValue(row[name]!, columns.get(name)!.data_type))
    await db.unsafe(sql, params)
  }
}

function canonicalTimestamp(value: unknown): EncodedDatabaseValue {
  if (typeof value !== 'string') return encodeDatabaseValue(value)
  const explicitUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  const instant = new Date(explicitUtc)
  if (Number.isNaN(instant.getTime())) return encodeDatabaseValue(value)
  return { kind: 'string', value: instant.toISOString() }
}

function normalizedEncodedValue(value: unknown, destinationType: string): EncodedDatabaseValue {
  if (destinationType === 'boolean') {
    if (typeof value === 'boolean') return { kind: 'number', value: value ? 1 : 0 }
    if (typeof value === 'number') return { kind: 'number', value: value === 0 ? 0 : 1 }
  }
  if (destinationType === 'bigint' && (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string')) {
    return { kind: 'string', value: String(value) }
  }
  if (destinationType.includes('timestamp')) return canonicalTimestamp(value)
  return encodeDatabaseValue(value)
}

function targetEncodedValue(value: unknown, destinationType: string): EncodedDatabaseValue {
  return normalizedEncodedValue(value, destinationType)
}

function expectedEncodedValue(value: EncodedDatabaseValue, destinationType: string): EncodedDatabaseValue {
  return normalizedEncodedValue(decodeDatabaseValue(value), destinationType)
}

async function validateTable(
  db: DbClient,
  table: LegacyTransitionTable,
  columns: ReadonlyMap<string, DestinationColumn>,
): Promise<void> {
  const countResult = await db.unsafe<{ count: number | bigint }>(
    `select count(*) as count from ${quoteIdentifier(table.name)}`,
  )
  const keys = primaryKeyColumns(table)
  const selectedColumns = table.columns.map(({ name }) => quoteIdentifier(name)).join(', ')
  const result = await db.unsafe<Record<string, unknown>>(
    `select ${selectedColumns} from ${quoteIdentifier(table.name)} order by ${keys.map(quoteIdentifier).join(', ')}`,
  )
  const rows = result.rows.map((row) => Object.fromEntries(table.columns.map(({ name }) => [
    name,
    targetEncodedValue(row[name], columns.get(name)!.data_type),
  ])))
  const expectedRows = table.rows.map((row) => Object.fromEntries(table.columns.map(({ name }) => [
    name,
    expectedEncodedValue(row[name]!, columns.get(name)!.data_type),
  ])))
  const foreignKeyViolations: Array<{ column: string; count: number }> = []
  for (const foreignKey of table.foreignKeys) {
    const sql = `select count(*) as count from ${quoteIdentifier(table.name)} source left join ${quoteIdentifier(foreignKey.targetTable)} target on source.${quoteIdentifier(foreignKey.fromColumn)} = target.${quoteIdentifier(foreignKey.targetColumn)} where source.${quoteIdentifier(foreignKey.fromColumn)} is not null and target.${quoteIdentifier(foreignKey.targetColumn)} is null`
    const violations = await db.unsafe<{ count: number | bigint }>(sql)
    foreignKeyViolations.push({
      column: foreignKey.fromColumn,
      count: Number(violations.rows[0]?.count ?? 0),
    })
  }
  assertLegacyTableValidation({
    table: table.name,
    expectedCount: table.rows.length,
    actualCount: Number(countResult.rows[0]?.count ?? -1),
    expectedHash: tableContentHash({ columns: table.columns, rows: expectedRows }),
    actualHash: tableContentHash({ columns: table.columns, rows }),
    foreignKeyViolations,
  })
}

export function planLegacyImport(artifactInput: unknown): LegacyImportReport {
  const artifact = validateLegacyTransitionArtifact(artifactInput)
  return {
    sourceFingerprint: artifact.sourceFingerprint,
    artifactHash: artifact.artifactHash,
    tableCount: artifact.tables.length,
    rowCount: artifact.tables.reduce((sum, table) => sum + table.rows.length, 0),
    importedTables: artifact.tables.map(({ name }) => name),
    resumedTables: [],
    complete: false,
  }
}

export async function importLegacySqliteToPostgres(
  db: DbClient,
  artifactInput: unknown,
): Promise<LegacyImportReport> {
  if (db.dialect !== 'postgres') throw new LegacyImportError('Legacy import destination must be PostgreSQL.')
  const artifact = validateLegacyTransitionArtifact(artifactInput)
  const existing = await db<ImportReceipt>`
    select artifact_hash, state from fuma_legacy_imports
    where source_fingerprint = ${artifact.sourceFingerprint}
  `
  if (existing.rows[0] && existing.rows[0].artifact_hash !== artifact.artifactHash) {
    throw new LegacyImportError('Legacy import resume artifact does not match the original artifact hash.')
  }

  const ordered = orderedTables(artifact)
  const columnMaps = new Map<string, Map<string, DestinationColumn>>()
  for (const table of ordered) columnMaps.set(table.name, await destinationColumns(db, table))

  if (!existing.rows[0]) {
    await db`
      insert into fuma_legacy_imports
        (source_fingerprint, artifact_hash, state, source_table_count, source_row_count)
      values (
        ${artifact.sourceFingerprint}, ${artifact.artifactHash}, ${'running'},
        ${artifact.tables.length},
        ${artifact.tables.reduce((sum, table) => sum + table.rows.length, 0)}
      )
    `
  }

  const progress = await db<ImportedTableReceipt>`
    select table_name, row_count, content_hash
    from fuma_legacy_import_tables
    where source_fingerprint = ${artifact.sourceFingerprint}
    order by table_name
  `
  const completed = new Set<string>()
  for (const receipt of progress.rows) {
    const table = artifact.tables.find(({ name }) => name === receipt.table_name)
    if (!table || Number(receipt.row_count) !== table.rows.length || receipt.content_hash !== table.contentHash) {
      throw new LegacyImportError(`Legacy import resume receipt is invalid for ${receipt.table_name}.`)
    }
    completed.add(receipt.table_name)
  }

  if (existing.rows[0]?.state === 'complete') {
    if (completed.size !== ordered.length) {
      throw new LegacyImportError('Completed legacy import is missing table receipts.')
    }
    for (const table of ordered) await validateTable(db, table, columnMaps.get(table.name)!)
    await backfillLegacyStaffIdentities(db)
    return {
      ...planLegacyImport(artifact),
      importedTables: [],
      resumedTables: ordered.map(({ name }) => name),
      complete: true,
    }
  }

  const importedTables: string[] = []
  const resumedTables = ordered.filter(({ name }) => completed.has(name)).map(({ name }) => name)
  for (const table of ordered) {
    if (completed.has(table.name)) continue
    await db.transaction(async (tx) => {
      await upsertTableRows(tx, table, columnMaps.get(table.name)!, completed)
      await tx`
        insert into fuma_legacy_import_tables
          (source_fingerprint, table_name, row_count, content_hash)
        values (${artifact.sourceFingerprint}, ${table.name}, ${table.rows.length}, ${table.contentHash})
      `
    })
    completed.add(table.name)
    importedTables.push(table.name)
  }

  await db.transaction(async (tx) => {
    for (const table of ordered) await restoreTableRows(tx, table, columnMaps.get(table.name)!)
    for (const table of ordered) await validateTable(tx, table, columnMaps.get(table.name)!)
    await backfillLegacyStaffIdentitiesInTransaction(tx)
    await tx`
      update fuma_legacy_imports
      set state = ${'complete'}, completed_at = current_timestamp
      where source_fingerprint = ${artifact.sourceFingerprint}
    `
  })

  return {
    ...planLegacyImport(artifact),
    importedTables,
    resumedTables,
    complete: true,
  }
}
