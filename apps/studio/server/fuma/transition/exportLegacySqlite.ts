import type { DbClient } from '../../db/client'
import {
  calculateArtifactHash,
  canonicalJson,
  encodeDatabaseValue,
  sha256,
  tableContentHash,
  validateLegacyTransitionArtifact,
  type LegacyTransitionArtifact,
  type LegacyTransitionTable,
} from './artifact'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe SQLite transition identifier: ${value}`)
  return `"${value}"`
}

interface SqliteTableRow { name: string }
interface SqliteColumnRow {
  cid: number
  name: string
  type: string
  notnull: number
  pk: number
}
interface SqliteForeignKeyRow {
  table: string
  from: string
  to: string
}

async function exportTable(db: DbClient, name: string): Promise<LegacyTransitionTable> {
  const columnsResult = await db.unsafe<SqliteColumnRow>(`pragma table_info(${quoteIdentifier(name)})`)
  const foreignKeysResult = await db.unsafe<SqliteForeignKeyRow>(`pragma foreign_key_list(${quoteIdentifier(name)})`)
  const columns = columnsResult.rows
    .sort((left, right) => left.cid - right.cid)
    .map((column) => ({
      name: column.name,
      declaredType: column.type,
      notNull: column.notnull === 1,
      primaryKeyPosition: column.pk,
    }))
  if (columns.length === 0) throw new Error(`Legacy SQLite table ${name} has no columns.`)
  const orderColumns = columns
    .filter(({ primaryKeyPosition }) => primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
  const stableOrder = (orderColumns.length > 0 ? orderColumns : columns)
    .map(({ name: columnName }) => quoteIdentifier(columnName))
    .join(', ')
  const result = await db.unsafe<Record<string, unknown>>(
    `select * from ${quoteIdentifier(name)} order by ${stableOrder}`,
  )
  const rows = result.rows.map((row) => Object.fromEntries(
    columns.map(({ name: columnName }) => [columnName, encodeDatabaseValue(row[columnName])]),
  ))
  const tableWithoutHash = {
    name,
    columns,
    foreignKeys: foreignKeysResult.rows.map((foreignKey) => ({
      fromColumn: foreignKey.from,
      targetTable: foreignKey.table,
      targetColumn: foreignKey.to,
    })),
    rows,
  }
  return { ...tableWithoutHash, contentHash: tableContentHash(tableWithoutHash) }
}

export async function exportLegacySqlite(db: DbClient): Promise<LegacyTransitionArtifact> {
  if (db.dialect !== 'sqlite') {
    throw new Error('Legacy transition export requires the inherited SQLite source database.')
  }
  const schemaMigrationIds = (await db<{ id: string }>`
    select id from schema_migrations order by id
  `).rows.map(({ id }) => id)
  if (schemaMigrationIds.length === 0) {
    throw new Error('Legacy SQLite source has no inherited migration history; refusing an ambiguous export.')
  }
  const tableNames = (await db.unsafe<SqliteTableRow>(`
    select name from sqlite_master
    where type = 'table'
      and name not like 'sqlite_%'
      and name <> 'schema_migrations'
    order by name
  `)).rows.map(({ name }) => name)
  const tables: LegacyTransitionTable[] = []
  for (const name of tableNames) tables.push(await exportTable(db, name))
  const sourceFingerprint = sha256(canonicalJson({
    schemaMigrationIds,
    tables: tables.map(({ name, contentHash, rows }) => ({ name, contentHash, rowCount: rows.length })),
  }))
  const withoutHash = {
    format: 'fuma-legacy-sqlite-v1' as const,
    sourceFingerprint,
    schemaMigrationIds,
    tables,
  }
  return validateLegacyTransitionArtifact({
    ...withoutHash,
    artifactHash: calculateArtifactHash(withoutHash),
  })
}

export function summarizeLegacyExport(artifact: LegacyTransitionArtifact): {
  sourceFingerprint: string
  artifactHash: string
  tableCount: number
  rowCount: number
  tableHashes: Array<{ table: string; rowCount: number; contentHash: string }>
} {
  return {
    sourceFingerprint: artifact.sourceFingerprint,
    artifactHash: artifact.artifactHash,
    tableCount: artifact.tables.length,
    rowCount: artifact.tables.reduce((sum, table) => sum + table.rows.length, 0),
    tableHashes: artifact.tables.map((table) => ({
      table: table.name,
      rowCount: table.rows.length,
      contentHash: table.contentHash,
    })),
  }
}
