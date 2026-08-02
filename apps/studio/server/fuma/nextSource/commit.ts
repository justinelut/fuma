import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import type { NextSourceDraftRepository } from '@core/siteImport'
import type { DbClient } from '../../db/client'
import type { BoundEditorScopedRepository } from '../editor'
import type { NextSourceScope } from './postgres'
import { projectNextSourceRevision } from './projection'
import { sha256Hex } from '../objectStorage'

const ID = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })
const HASH = Type.String({ pattern: '^[a-f0-9]{64}$' })
const SEQUENCE = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })

export const NextSourceEditorCommitReceiptSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  commitId: ID,
  revisionId: ID,
  sourceHashSha256: HASH,
  documentHashSha256: HASH,
  mutationId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  expectedSequence: SEQUENCE,
  acceptedSequence: SEQUENCE,
  actorId: ID,
  destination: Type.Object({
    organizationId: ID,
    workspaceId: ID,
    siteId: ID,
  }, { additionalProperties: false }),
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  createdAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
export type NextSourceEditorCommitReceipt = Static<typeof NextSourceEditorCommitReceiptSchema>

export const NextSourceEditorCommitCommandSchema = Type.Object({
  expectedSequence: SEQUENCE,
}, { additionalProperties: false })
export type NextSourceEditorCommitCommand = Static<typeof NextSourceEditorCommitCommandSchema>

type CommitRow = Readonly<{ receipt_json: unknown }>

const encoder = new TextEncoder()
const hashText = (value: string): string => sha256Hex(encoder.encode(value))

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function parseReceipt(value: unknown): NextSourceEditorCommitReceipt {
  const parsed = safeParseValue(
    NextSourceEditorCommitReceiptSchema,
    typeof value === 'string' ? JSON.parse(value) : value,
  )
  if (!parsed.ok) throw new Error('Stored source editor commit receipt failed strict TypeBox validation.')
  return parsed.value
}

export class NextSourceEditorCommitService {
  readonly #db: DbClient
  readonly #scope: NextSourceScope
  readonly #sources: NextSourceDraftRepository
  readonly #editor: BoundEditorScopedRepository
  readonly #now: () => Date

  constructor(input: Readonly<{
    db: DbClient
    scope: NextSourceScope
    sources: NextSourceDraftRepository
    editor: BoundEditorScopedRepository
    now?: () => Date
  }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted source editor commit requires PostgreSQL.')
    this.#db = input.db
    this.#scope = input.scope
    this.#sources = input.sources
    this.#editor = input.editor
    this.#now = input.now ?? (() => new Date())
  }

  async commit(input: Readonly<{
    revisionId: string
    expectedSequence: number
    actorId: string
    siteName?: string
  }>): Promise<Readonly<{
    outcome: 'committed'
    replayed: boolean
    receipt: NextSourceEditorCommitReceipt
  }> | Readonly<{
    outcome: 'conflict'
    code: 'draft-sequence-conflict' | 'mutation-id-reused'
    expectedSequence: number
    authoritativeSequence: number
  }>> {
    const prior = await this.#find(input.revisionId)
    if (prior) return Object.freeze({ outcome: 'committed', replayed: true, receipt: prior })
    const source = await this.#sources.getRevision(input.revisionId)
    if (!source) throw new Error('Exact source revision is unavailable in this tenant scope.')
    const projection = projectNextSourceRevision({
      revision: source.revision,
      files: source.files,
      profileId: this.#scope.profileId,
      ...(input.siteName ? { siteName: input.siteName } : {}),
    })
    const identityHash = hashText(canonical({
      scope: this.#scope,
      revisionId: source.revision.revisionId,
      sourceHashSha256: source.revision.sourceHashSha256,
      documentHashSha256: projection.documentHashSha256,
    }))
    const mutationId = `nextsource:${identityHash.slice(0, 64)}`
    const mutation = await this.#editor.mutateDraft({
      mutationId,
      expectedSequence: input.expectedSequence,
      operations: [{ kind: 'replace-document', document: projection.document }],
    })
    if (mutation.outcome === 'conflict') {
      return Object.freeze({
        outcome: 'conflict',
        code: mutation.code,
        expectedSequence: mutation.expectedSequence,
        authoritativeSequence: mutation.authoritativeSequence,
      })
    }
    const acceptedDocumentHash = hashText(canonical(mutation.document))
    if (acceptedDocumentHash !== projection.documentHashSha256) {
      throw new Error('Accepted editor mutation document does not match the exact source projection hash.')
    }
    const receiptValue = {
      schemaVersion: 1 as const,
      commitId: `next-commit:${identityHash}`,
      revisionId: source.revision.revisionId,
      sourceHashSha256: source.revision.sourceHashSha256,
      documentHashSha256: projection.documentHashSha256,
      mutationId,
      expectedSequence: mutation.expectedSequence,
      acceptedSequence: mutation.sequence,
      actorId: input.actorId,
      destination: source.revision.destination,
      ownerGeneration: this.#scope.ownerGeneration,
      createdAt: this.#now().toISOString(),
    }
    const receipt = safeParseValue(NextSourceEditorCommitReceiptSchema, receiptValue)
    if (!receipt.ok) throw new Error('Source editor commit produced invalid durable evidence.')
    await this.#db.unsafe(`
      insert into fuma_next_source_editor_commits_v1(
        commit_id,revision_id,platform_id,organization_id,workspace_id,site_id,
        owner_key,owner_generation,profile_id,source_hash_sha256,document_hash_sha256,
        editor_resource_kind,editor_logical_id,mutation_id,expected_sequence,accepted_sequence,
        actor_id,receipt_json,created_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'site-document',$6,$12,$13,$14,$15,$16::text::jsonb,$17::timestamptz)
      on conflict(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id) do nothing
    `, [
      receipt.value.commitId,
      receipt.value.revisionId,
      this.#scope.platformId,
      this.#scope.organizationId,
      this.#scope.workspaceId,
      this.#scope.siteId,
      this.#scope.ownerKey,
      this.#scope.ownerGeneration,
      this.#scope.profileId,
      receipt.value.sourceHashSha256,
      receipt.value.documentHashSha256,
      receipt.value.mutationId,
      receipt.value.expectedSequence,
      receipt.value.acceptedSequence,
      receipt.value.actorId,
      JSON.stringify(receipt.value),
      receipt.value.createdAt,
    ])
    const stored = await this.#find(input.revisionId)
    if (!stored || canonical(stored) !== canonical(receipt.value)) {
      throw new Error('Source editor commit replay evidence conflicts with the accepted mutation.')
    }
    return Object.freeze({ outcome: 'committed', replayed: mutation.replayed, receipt: stored })
  }

  async #find(revisionId: string): Promise<NextSourceEditorCommitReceipt | null> {
    const result = await this.#db.unsafe<CommitRow>(`
      select receipt_json from fuma_next_source_editor_commits_v1
      where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
        and owner_key=$5 and owner_generation=$6 and profile_id=$7 and revision_id=$8
    `, [
      this.#scope.platformId,
      this.#scope.organizationId,
      this.#scope.workspaceId,
      this.#scope.siteId,
      this.#scope.ownerKey,
      this.#scope.ownerGeneration,
      this.#scope.profileId,
      revisionId,
    ])
    if (result.rows.length > 1) throw new Error('Source editor commit evidence is ambiguous.')
    return result.rows[0] ? parseReceipt(result.rows[0].receipt_json) : null
  }
}
