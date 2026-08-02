export interface DbResult<Row = Record<string, unknown>> {
  rows: Row[]
  rowCount: number
}

/** PostgreSQL is the platform's sole database dialect. */
export type Dialect = 'postgres'

/** Build a PostgreSQL positional placeholder for `db.unsafe()` SQL. */
export function placeholder(_dialect: Dialect, index: number): string {
  if (!Number.isSafeInteger(index) || index < 1) throw new RangeError('PostgreSQL placeholder index must be positive.')
  return `$${index}`
}

/**
 * PostgreSQL client contract used by repositories and handlers.
 * Tagged-template calls and `.unsafe()` always bind values as parameters.
 */
export interface DbClient {
  <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>>
  unsafe<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DbResult<Row>>
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>
  close?(): Promise<void>
  readonly dialect: 'postgres'
}
