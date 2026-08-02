import { zipSync, type Zippable } from 'fflate'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import {
  NextSourceDraftRevisionSchema,
  NextSourceExportManifestSchema,
  NextSourceFixReceiptSchema,
  NextSourceGitHubExportReceiptSchema,
  NextSourceGitHubExportRequestSchema,
  NextSourceGitHubSelectionSchema,
  NextSourceIngestReceiptSchema,
  NextSourceRollbackReceiptSchema,
  type FileMap,
  type NextSourceDestination,
  type NextSourceDraftRevision,
  type NextSourceGitHubExportRequest,
  type NextSourceGitHubSelection,
  type NextSourceIngestReceipt,
} from '@core/siteImport'

const ID = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })
const HASH = Type.String({ pattern: '^[a-f0-9]{64}$' })
const SEQUENCE = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const ErrorResponseSchema = Type.Union([
  Type.Object({ error: Type.String({ minLength: 1, maxLength: 2_000 }) }, { additionalProperties: false }),
  Type.Object({ state: Type.Literal('blocked'), reason: Type.String({ minLength: 1, maxLength: 2_000 }) }, { additionalProperties: false }),
])
const DraftResponseSchema = Type.Object({ revision: NextSourceDraftRevisionSchema, receipt: NextSourceIngestReceiptSchema }, { additionalProperties: false })
const RevisionResponseSchema = Type.Object({ revision: NextSourceDraftRevisionSchema }, { additionalProperties: false })
const FixResponseSchema = Type.Object({ receipt: NextSourceFixReceiptSchema }, { additionalProperties: false })
const FixDetailResponseSchema = Type.Object({
  receipt: NextSourceFixReceiptSchema,
  changes: Type.Array(Type.Object({
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    expectedSha256: HASH,
    before: Type.String({ maxLength: 1_000_000 }),
    after: Type.String({ maxLength: 1_000_000 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 500 }),
}, { additionalProperties: false })
const ApplyResponseSchema = Type.Object({ revision: NextSourceDraftRevisionSchema }, { additionalProperties: false })
const RollbackResponseSchema = Type.Object({ receipt: NextSourceRollbackReceiptSchema }, { additionalProperties: false })
const EditorCommitReceiptSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  commitId: ID,
  revisionId: ID,
  sourceHashSha256: HASH,
  documentHashSha256: HASH,
  mutationId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }),
  expectedSequence: SEQUENCE,
  acceptedSequence: SEQUENCE,
  actorId: ID,
  destination: Type.Object({ organizationId: ID, workspaceId: ID, siteId: ID }, { additionalProperties: false }),
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  createdAt: Type.String({ format: 'date-time' }),
}, { additionalProperties: false })
const CommitResponseSchema = Type.Object({ state: Type.Literal('committed'), replayed: Type.Boolean(), receipt: EditorCommitReceiptSchema }, { additionalProperties: false })
const CommitConflictResponseSchema = Type.Object({
  state: Type.Literal('conflict'),
  code: Type.Union([Type.Literal('draft-sequence-conflict'), Type.Literal('mutation-id-reused')]),
  expectedSequence: SEQUENCE,
  authoritativeSequence: SEQUENCE,
}, { additionalProperties: false })
const GitHubProviderCommandSchema = Type.Object({
  installationId: Type.String({ pattern: '^[1-9][0-9]{0,19}$' }),
  request: NextSourceGitHubExportRequestSchema,
}, { additionalProperties: false })
const ReleaseExportRecordSchema = Type.Object({
  exportId: ID,
  releaseId: ID,
  sourceRevisionId: ID,
  sourceSnapshotId: ID,
  sourceSnapshotHashSha256: HASH,
  documentHashSha256: HASH,
  objectKey: Type.String({ pattern: '^exports/next-source/[a-f0-9]{64}\\.zip$' }),
  objectHashSha256: HASH,
  objectSizeBytes: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  manifest: NextSourceExportManifestSchema,
  state: Type.Union([Type.Literal('artifact-created'), Type.Literal('github-pending'), Type.Literal('github-exported')]),
  version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  githubOperationId: Type.Union([ID, Type.Null()]),
  githubRequest: Type.Union([GitHubProviderCommandSchema, Type.Null()]),
  githubReceipt: Type.Union([NextSourceGitHubExportReceiptSchema, Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  exportedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
}, { additionalProperties: false })
const WorkflowStateResponseSchema = Type.Object({
  editorSequence: SEQUENCE,
  activeRelease: Type.Union([
    Type.Object({
      releaseId: ID,
      activatedAt: Type.String({ format: 'date-time' }),
    }, { additionalProperties: false }),
    Type.Null(),
  ]),
}, { additionalProperties: false })
const ExportResponseSchema = Type.Object({
  state: Type.Union([Type.Literal('artifact-created'), Type.Literal('github-pending'), Type.Literal('github-exported')]),
  replayed: Type.Boolean(),
  record: ReleaseExportRecordSchema,
}, { additionalProperties: false })

export type HostedNextSourceDraft = Readonly<{ revision: NextSourceDraftRevision; receipt: NextSourceIngestReceipt }>
export type HostedNextSourceWorkflowState = Static<typeof WorkflowStateResponseSchema>
export type HostedNextSourceFix = Static<typeof FixDetailResponseSchema>
export type HostedNextSourceEditorCommit = Static<typeof CommitResponseSchema>
export type HostedNextSourceEditorConflict = Static<typeof CommitConflictResponseSchema>
export type HostedNextSourceReleaseExport = Static<typeof ExportResponseSchema>

function scopedPath(destination: NextSourceDestination, suffix: string): string {
  return `/api/fuma/organizations/${encodeURIComponent(destination.organizationId)}/workspaces/${encodeURIComponent(destination.workspaceId)}/sites/${encodeURIComponent(destination.siteId)}${suffix}`
}

function archive(fileMap: FileMap): Uint8Array {
  const entries: Zippable = {}
  for (const [path, file] of Object.entries(fileMap.files).sort(([a], [b]) => a.localeCompare(b))) entries[path] = [file.bytes, { level: 0, mtime: new Date('1980-01-01T00:00:00.000Z') }]
  return zipSync(entries)
}

function errorMessage(value: unknown, status: number): string {
  const parsed = safeParseValue(ErrorResponseSchema, value)
  if (!parsed.ok) return `Next.js source request failed with status ${status}.`
  return 'error' in parsed.value ? parsed.value.error : parsed.value.reason
}

async function requestJson<T extends TSchema>(schema: T, url: string, init?: RequestInit): Promise<Static<T>> {
  const response = await fetch(url, { credentials: 'same-origin', ...init })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(errorMessage(body, response.status))
  const parsed = safeParseValue(schema, body)
  if (!parsed.ok) throw new Error('Next.js source request returned an invalid response.')
  return parsed.value
}

function jsonPost(body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

export async function persistHostedNextSourceDraft(input: Readonly<{ destination: NextSourceDestination; locator: string; fileMap: FileMap }>): Promise<HostedNextSourceDraft> {
  const archiveBody = Uint8Array.from(archive(input.fileMap)).buffer
  return requestJson(DraftResponseSchema, `${scopedPath(input.destination, '/source-import/drafts')}?locator=${encodeURIComponent(input.locator)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: archiveBody,
  })
}

export async function persistHostedNextSourceGitHubDraft(destination: NextSourceDestination, selection: NextSourceGitHubSelection): Promise<HostedNextSourceDraft> {
  const valid = safeParseValue(NextSourceGitHubSelectionSchema, selection)
  if (!valid.ok || !/^[1-9][0-9]{0,19}$/.test(valid.value.installationId)) throw new Error('Exact GitHub installation, repository, branch, and commit are required.')
  return requestJson(DraftResponseSchema, scopedPath(destination, '/source-import/github/drafts'), jsonPost(valid.value))
}

export async function readHostedNextSourceWorkflowState(destination: NextSourceDestination): Promise<HostedNextSourceWorkflowState> {
  return requestJson(WorkflowStateResponseSchema, scopedPath(destination, '/source-import/workflow-state'))
}

export async function readHostedNextSourceRevision(destination: NextSourceDestination, revisionId: string): Promise<NextSourceDraftRevision> {
  const result = await requestJson(RevisionResponseSchema, scopedPath(destination, `/source-import/revisions/${encodeURIComponent(revisionId)}`))
  return result.revision
}

export async function readHostedNextSourceFix(destination: NextSourceDestination, receiptId: string): Promise<HostedNextSourceFix> {
  return requestJson(FixDetailResponseSchema, scopedPath(destination, `/source-import/fixes/${encodeURIComponent(receiptId)}`))
}

export async function confirmHostedNextSourceFix(destination: NextSourceDestination, receiptId: string) {
  return (await requestJson(FixResponseSchema, scopedPath(destination, `/source-import/fixes/${encodeURIComponent(receiptId)}/confirm`), jsonPost())).receipt
}

export async function applyHostedNextSourceFix(destination: NextSourceDestination, receiptId: string): Promise<NextSourceDraftRevision> {
  return (await requestJson(ApplyResponseSchema, scopedPath(destination, `/source-import/fixes/${encodeURIComponent(receiptId)}/apply`), jsonPost())).revision
}

export async function rollbackHostedNextSource(destination: NextSourceDestination, currentRevisionId: string, restoreRevisionId: string) {
  return (await requestJson(RollbackResponseSchema, scopedPath(destination, `/source-import/rollback/${encodeURIComponent(currentRevisionId)}/${encodeURIComponent(restoreRevisionId)}`), jsonPost())).receipt
}

export async function commitHostedNextSource(destination: NextSourceDestination, revisionId: string, expectedSequence: number): Promise<HostedNextSourceEditorCommit | HostedNextSourceEditorConflict> {
  const response = await fetch(scopedPath(destination, `/source-import/revisions/${encodeURIComponent(revisionId)}/commit`), {
    credentials: 'same-origin',
    ...jsonPost({ expectedSequence }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (response.status === 409) {
    const conflict = safeParseValue(CommitConflictResponseSchema, body)
    if (conflict.ok) return conflict.value
  }
  if (!response.ok) throw new Error(errorMessage(body, response.status))
  const committed = safeParseValue(CommitResponseSchema, body)
  if (!committed.ok) throw new Error('Editor commit returned an invalid response.')
  return committed.value
}

export async function exportHostedNextSourceRelease(input: Readonly<{
  destination: NextSourceDestination
  releaseId: string
  github?: Readonly<{ installationId: string; request: NextSourceGitHubExportRequest }>
}>): Promise<HostedNextSourceReleaseExport> {
  return requestJson(
    ExportResponseSchema,
    scopedPath(input.destination, `/source-export/releases/${encodeURIComponent(input.releaseId)}`),
    jsonPost(input.github ? { github: input.github } : {}),
  )
}

export async function downloadHostedNextSourceRelease(destination: NextSourceDestination, releaseId: string): Promise<Readonly<{ bytes: Uint8Array; filename: string }>> {
  const response = await fetch(scopedPath(destination, `/source-export/releases/${encodeURIComponent(releaseId)}/archive`), {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new Error(errorMessage(body, response.status))
  }
  if (response.headers.get('content-type') !== 'application/zip') throw new Error('Release export download returned an invalid content type.')
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = disposition.match(/^attachment; filename="(fuma-next-source-[a-f0-9]{16}\.zip)"$/)
  if (!match) throw new Error('Release export download returned invalid filename evidence.')
  const declaredLength = Number(response.headers.get('content-length') ?? '0')
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > 512 * 1024 * 1024) {
    throw new Error('Release export download returned an invalid byte length.')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength !== declaredLength) throw new Error('Release export download byte length conflicts with durable evidence.')
  return Object.freeze({ bytes, filename: match[1]! })
}
