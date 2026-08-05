import { SQL } from 'bun'
import type { DbClient, DbResult } from './client'

type BunTransactionSql = SQL & Readonly<{
  savepoint<T>(callback: (sql: SQL) => Promise<T>): Promise<T>
}>

export function createPostgresClient(
  connectionString: string,
  options: Readonly<{ max?: number; idleTimeout?: number }> = {},
): DbClient {
  const sql = options.max === undefined && options.idleTimeout === undefined
    ? new SQL(connectionString)
    : new SQL({
        url: connectionString,
        max: options.max,
        idleTimeout: options.idleTimeout,
      })
  return Object.assign(wrapSql(sql), {
    close: async () => { await sql.close() },
  })
}

/**
 * Walk every column in a returned row and normalize PostgreSQL driver values:
 *
 * - Date instances become ISO 8601 strings for stable repository results.
 * - String-valued `*_json` columns are JSON.parsed for columns that
 *   intentionally store JSON in text rather than jsonb.
 */
export function normalizePostgresRow<Row>(row: Row): Row {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return row
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    const normalized = value instanceof Date ? value.toISOString() : value
    if (key.endsWith('_json') && typeof normalized === 'string' && normalized.length > 0) {
      try {
        result[key] = JSON.parse(normalized)
      } catch {
        result[key] = normalized
      }
    } else {
      result[key] = normalized
    }
  }
  return result as Row
}

/**
 * Affected-or-returned row count for a Bun SQL result.
 *
 * Bun exposes the command's row count on the result array's `.count` property:
 * for SELECT / RETURNING it equals the number of returned rows, and for a
 * non-RETURNING UPDATE / DELETE / INSERT it is the number of *affected* rows
 * (which PostgreSQL streams as a CommandComplete tag, not as data rows — so
 * `result.length` is 0 there). Using `.count` gives `rowCount` consistent
 * affected-or-returned semantics. It falls back to `length` if the property is
 * ever absent.
 */
function resultRowCount<Row>(result: Row[]): number {
  const count = (result as { count?: unknown }).count
  return typeof count === 'number' ? count : result.length
}

function wrapSql(sql: SQL, insideTransaction = false): DbClient {
  const fn = (async <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    const rows = await sql<Row[]>(strings, ...values)
    return { rows: rows.map(normalizePostgresRow), rowCount: resultRowCount(rows) }
  }) as DbClient

  fn.unsafe = async <Row = Record<string, unknown>>(
    rawSql: string,
    params?: unknown[],
  ): Promise<DbResult<Row>> => {
    const rows = params !== undefined
      ? await sql.unsafe<Row[]>(rawSql, params as unknown[])
      : await sql.unsafe<Row[]>(rawSql)
    return { rows: rows.map(normalizePostgresRow), rowCount: resultRowCount(rows) }
  }

  fn.transaction = async <T>(cb: (tx: DbClient) => Promise<T>): Promise<T> => {
    if (insideTransaction) {
      return await (sql as BunTransactionSql).savepoint(async (txSql: SQL) => (
        await cb(wrapSql(txSql, true))
      ))
    }
    return await sql.begin(async (txSql) => cb(wrapSql(txSql as unknown as SQL, true)))
  }

  return Object.assign(fn, { dialect: 'postgres' as const })
}
