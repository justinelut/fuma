import { Buffer } from 'node:buffer'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { safeParseJson } from '@core/utils/jsonValidate'

const DatabaseValueSchema = Type.Union([
  Type.Object({ kind: Type.Literal('null') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('string'), value: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('number'), value: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('boolean'), value: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('json'), value: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('bytes'), base64: Type.String({ pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' }) }, { additionalProperties: false }),
])

const LegacyColumnSchema = Type.Object({
  name: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }),
  declaredType: Type.String(),
  notNull: Type.Boolean(),
  primaryKeyPosition: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })

const LegacyForeignKeySchema = Type.Object({
  fromColumn: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }),
  targetTable: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }),
  targetColumn: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }),
}, { additionalProperties: false })

export const LegacyTransitionTableSchema = Type.Object({
  name: Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }),
  columns: Type.Array(LegacyColumnSchema, { minItems: 1 }),
  foreignKeys: Type.Array(LegacyForeignKeySchema),
  rows: Type.Array(Type.Record(Type.String(), DatabaseValueSchema)),
  contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, { additionalProperties: false })

export const LegacyTransitionArtifactSchema = Type.Object({
  format: Type.Literal('fuma-legacy-sqlite-v1'),
  sourceFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  artifactHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  schemaMigrationIds: Type.Array(Type.String()),
  tables: Type.Array(LegacyTransitionTableSchema),
}, { additionalProperties: false })

export type EncodedDatabaseValue = Static<typeof DatabaseValueSchema>
export type LegacyTransitionTable = Static<typeof LegacyTransitionTableSchema>
export type LegacyTransitionArtifact = Static<typeof LegacyTransitionArtifactSchema>

export class LegacyTransitionArtifactError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LegacyTransitionArtifactError'
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

export function encodeDatabaseValue(value: unknown): EncodedDatabaseValue {
  if (value === null || value === undefined) return { kind: 'null' }
  if (value instanceof Uint8Array) {
    return { kind: 'bytes', base64: Buffer.from(value).toString('base64') }
  }
  if (typeof value === 'string') return { kind: 'string', value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new LegacyTransitionArtifactError('Database number is not finite.')
    return { kind: 'number', value }
  }
  if (typeof value === 'boolean') return { kind: 'boolean', value }
  if (typeof value === 'object') return { kind: 'json', value: canonicalJson(value) }
  throw new LegacyTransitionArtifactError(`Unsupported database value type: ${typeof value}`)
}

export function decodeDatabaseValue(value: EncodedDatabaseValue): unknown {
  if (value.kind === 'null') return null
  if (value.kind === 'string' || value.kind === 'number' || value.kind === 'boolean') return value.value
  if (value.kind === 'bytes') return Uint8Array.from(Buffer.from(value.base64, 'base64'))
  const parsed = safeParseJson(value.value, Type.Unknown())
  if (!parsed.ok) throw new LegacyTransitionArtifactError('Encoded JSON value is invalid.')
  return parsed.value
}

export function tableContentHash(table: Pick<LegacyTransitionTable, 'columns' | 'rows'>): string {
  return sha256(canonicalJson({ columns: table.columns.map(({ name }) => name), rows: table.rows }))
}

function artifactPayload(artifact: Omit<LegacyTransitionArtifact, 'artifactHash'>): string {
  return canonicalJson(artifact)
}

export function calculateArtifactHash(artifact: Omit<LegacyTransitionArtifact, 'artifactHash'>): string {
  return sha256(artifactPayload(artifact))
}

export function validateLegacyTransitionArtifact(value: unknown): LegacyTransitionArtifact {
  const parsed = safeParseValue(LegacyTransitionArtifactSchema, value)
  if (!parsed.ok) throw new LegacyTransitionArtifactError('Legacy transition artifact failed TypeBox validation.')
  const artifact = parsed.value
  const tableNames = artifact.tables.map(({ name }) => name)
  if (new Set(tableNames).size !== tableNames.length) {
    throw new LegacyTransitionArtifactError('Legacy transition artifact contains duplicate tables.')
  }
  for (const table of artifact.tables) {
    const columnNames = table.columns.map(({ name }) => name)
    if (new Set(columnNames).size !== columnNames.length) {
      throw new LegacyTransitionArtifactError(`Legacy transition table ${table.name} contains duplicate columns.`)
    }
    if (table.rows.some((row) => Object.keys(row).sort().join('\n') !== [...columnNames].sort().join('\n'))) {
      throw new LegacyTransitionArtifactError(`Legacy transition table ${table.name} row shape does not match its columns.`)
    }
    for (const row of table.rows) {
      for (const value of Object.values(row)) decodeDatabaseValue(value)
    }
    if (tableContentHash(table) !== table.contentHash) {
      throw new LegacyTransitionArtifactError(`Legacy transition table ${table.name} content hash does not match.`)
    }
  }
  const { artifactHash: _artifactHash, ...withoutHash } = artifact
  if (calculateArtifactHash(withoutHash) !== artifact.artifactHash) {
    throw new LegacyTransitionArtifactError('Legacy transition artifact hash does not match.')
  }
  const expectedFingerprint = sha256(canonicalJson({
    schemaMigrationIds: artifact.schemaMigrationIds,
    tables: artifact.tables.map(({ name, contentHash, rows }) => ({ name, contentHash, rowCount: rows.length })),
  }))
  if (expectedFingerprint !== artifact.sourceFingerprint) {
    throw new LegacyTransitionArtifactError('Legacy transition source fingerprint does not match.')
  }
  return artifact
}
