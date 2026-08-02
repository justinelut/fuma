import type { Dialect } from './client'

type JsonFieldExpr = { readonly __brand: 'JsonFieldExpr'; readonly sql: string }
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Build a validated PostgreSQL JSON scalar extraction expression.
 * Identifiers are validated before this branded fragment can enter raw SQL.
 */
export function jsonField(column: string, field: string, _dialect: Dialect): JsonFieldExpr {
  if (!IDENT_RE.test(column)) {
    throw new Error(`[db/jsonExtract] invalid column identifier: ${column}`)
  }
  if (!IDENT_RE.test(field)) {
    throw new Error(`[db/jsonExtract] invalid field identifier: ${field}`)
  }
  return Object.freeze({ __brand: 'JsonFieldExpr', sql: `${column}->>'${field}'` } as const)
}
