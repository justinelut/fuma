import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import {
  PostgresEditorScopedStorage,
  type EditorDraftMutationReceipt,
  type EditorDraftStreamKey,
} from '../../../server/fuma/editor'
import { editorDraftSequencesMigration } from '../../../server/fuma/db/migrations/000012_editor_draft_sequences'
import {
  HOSTED_MIGRATION_CHECKSUMS,
  hostedMigrations,
  runnableHostedMigrations,
} from '../../../server/fuma/db/migrations'
import {
  assertHostedMigrationIsAdditive,
  hostedMigrationChecksum,
  nextHostedMigrationId,
} from '../../../server/fuma/db/migrationPolicy'

const CHECKSUM = '92048e16ad1a019569731cbcfcfbb39dbfd6bd439b62ea448af7107a28ed4070'
const STREAM: EditorDraftStreamKey = {
  platformId: 'platform-fuma',
  ownerKey: 'owner-a',
  generation: 7,
  profileId: 'website',
  resourceKind: 'site-document',
  logicalId: 'site-a',
}
const DOCUMENT = {
  site: {
    id: 'site-a', name: 'Stored', breakpoints: [], settings: { shortcuts: {} },
    styleRules: {}, files: [],
    explorer: {
      pages: { expandedFolders: [], emptyFolders: [], rowOrder: [] },
      styles: { expandedFolders: [], emptyFolders: [], rowOrder: [] },
      scripts: { expandedFolders: [], emptyFolders: [], rowOrder: [] },
      templates: { folders: [], items: [] }, components: { folders: [], items: [] },
    },
    packageJson: { dependencies: {}, devDependencies: {} },
    runtime: { dependencyLock: { version: 1, packages: {}, updatedAt: 1 }, scripts: {}, styles: {} },
    createdAt: 1, updatedAt: 2,
  },
  pages: [], visualComponents: [], layouts: [],
}

function result<Row>(rows: Row[], rowCount = rows.length): DbResult<Row> {
  return { rows, rowCount }
}

function normalized(sql: string): string {
  return sql.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

type Call = Readonly<{ sql: string; values: readonly unknown[] }>

class RecordingDb {
  readonly calls: Call[] = []
  receipt: EditorDraftMutationReceipt | null = null
  readonly client: DbClient

  constructor() {
    const query = (async <Row = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<DbResult<Row>> => {
      const sql = strings.join('?')
      this.calls.push({ sql, values: structuredClone(values) })
      const compact = normalized(sql)
      if (compact.startsWith('select sequence')) {
        return result([{ sequence: 5n }] as unknown as Row[])
      }
      if (compact.startsWith('select request_hash') && this.receipt) {
        return result([{
          request_hash: this.receipt.requestHash,
          expected_sequence: this.receipt.expectedSequence,
          accepted_sequence: this.receipt.acceptedSequence,
          document_json: this.receipt.document,
        }] as unknown as Row[])
      }
      return result<Row>([], compact.startsWith('update fuma_editor_draft_heads') ? 1 : 0)
    }) as DbClient
    query.unsafe = async () => { throw new Error('unsafe SQL forbidden') }
    query.transaction = async (work) => await work(query)
    this.client = Object.assign(query, { dialect: 'postgres' as const })
  }
}

function find(db: RecordingDb, prefix: string): Call {
  const call = db.calls.find(({ sql }) => normalized(sql).startsWith(prefix))
  if (!call) throw new Error(`missing SQL: ${prefix}`)
  return call
}

describe('FUMA-028 PostgreSQL draft sequencing', () => {
  it('locks a fully scoped head and advances it with an exact compare-and-swap', async () => {
    const db = new RecordingDb()
    const storage = new PostgresEditorScopedStorage(db.client)
    await storage.transaction(async (transaction) => {
      expect(await transaction.lockDraftSequence(STREAM)).toBe(5)
      await transaction.setDraftSequence(STREAM, 5, 6)
    })

    const insert = find(db, 'insert into fuma_editor_draft_heads')
    expect(normalized(insert.sql)).toContain(
      'on conflict ( platform_id, owner_key, owner_generation, profile_id, resource_kind, logical_id ) do nothing',
    )
    expect(insert.values).toEqual(Object.values(STREAM))
    const lock = find(db, 'select sequence')
    expect(normalized(lock.sql)).toContain(
      'where platform_id = ? and owner_key = ? and owner_generation = ? and profile_id = ? and resource_kind = ? and logical_id = ? for update',
    )
    expect(lock.values).toEqual(Object.values(STREAM))
    const update = find(db, 'update fuma_editor_draft_heads')
    expect(normalized(update.sql)).toContain(
      'and profile_id = ? and resource_kind = ? and logical_id = ? and sequence = ?',
    )
    expect(update.values).toEqual([6, ...Object.values(STREAM), 5])
  })

  it('stores and hydrates duplicate receipts under every stream predicate', async () => {
    const db = new RecordingDb()
    db.receipt = {
      requestHash: 'a'.repeat(64), expectedSequence: 5, acceptedSequence: 6, document: DOCUMENT,
    }
    const storage = new PostgresEditorScopedStorage(db.client)
    await storage.transaction(async (transaction) => {
      expect(await transaction.getDraftMutationReceipt(STREAM, 'tab-a.1')).toEqual(db.receipt)
      await transaction.putDraftMutationReceipt(STREAM, 'tab-a.1', db.receipt!)
    })

    const select = find(db, 'select request_hash')
    const predicates = 'where platform_id = ? and owner_key = ? and owner_generation = ? and profile_id = ? and resource_kind = ? and logical_id = ? and mutation_id = ?'
    expect(normalized(select.sql)).toContain(predicates)
    expect(select.values).toEqual([...Object.values(STREAM), 'tab-a.1'])
    const insert = find(db, 'insert into fuma_editor_draft_mutations')
    expect(insert.values.slice(0, 7)).toEqual([...Object.values(STREAM), 'tab-a.1'])
    expect(insert.values.at(-1)).toBe(JSON.stringify(DOCUMENT))
  })

  it('appends one additive checksum-finalized migration without changing history', () => {
    const migrationIndex = hostedMigrations.findIndex(({ id }) => id === editorDraftSequencesMigration.id)
    expect(migrationIndex).toBeGreaterThan(0)
    expect(nextHostedMigrationId(hostedMigrations.slice(0, migrationIndex), 'editor draft sequences'))
      .toBe(editorDraftSequencesMigration.id)
    expect(hostedMigrations[migrationIndex]).toBe(editorDraftSequencesMigration)
    expect(HOSTED_MIGRATION_CHECKSUMS[editorDraftSequencesMigration.id]).toBe(CHECKSUM)
    expect(hostedMigrationChecksum(editorDraftSequencesMigration.sql)).toBe(CHECKSUM)
    expect(runnableHostedMigrations).toContain(editorDraftSequencesMigration)
    expect(() => assertHostedMigrationIsAdditive(editorDraftSequencesMigration)).not.toThrow()

    const sql = normalized(editorDraftSequencesMigration.sql)
    expect(sql).not.toMatch(/\b(?:alter|drop|truncate|delete from)\b/)
    expect(sql).toContain('create table fuma_editor_draft_heads')
    expect(sql).toContain('create table fuma_editor_draft_mutations')
    expect(sql).toContain('accepted_sequence = expected_sequence + 1')
    expect(sql).toContain("resource_kind text not null check (resource_kind = 'site-document')")
    expect(sql).toContain("jsonb_typeof(document_json) = 'object'")
  })
})
