import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import {
  GitHubAppNextSourceIngestor,
  NextSourceAdaptationService,
  NextSourceDraftRevisionSchema,
  NextSourceFixReceiptSchema,
  NextSourceGitHubSelectionSchema,
  NextSourceIngestReceiptSchema,
  NextSourceRollbackReceiptSchema,
  ingestLocalNextSource,
  type NextSourceDestination,
} from '@core/siteImport'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import type { AuditService } from '../audit'
import type { MeteringCollector } from '../metering'
import { sha256Hex, type TenantObjectStorage } from '../objectStorage'
import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { DbClient } from '../../db/client'
import { BetterAuthNextSourceOwnerConfirmation, PostgresNextSourceAdaptationAuthority } from './authority'
import { GitHubAppNextSourceExportAdapter, type GitHubAppInstallationTokenAuthority, type HostedNextSourceGitHubConfig, type SafeGitHubZipballFetchPort } from './github'
import { PostgresNextSourceDraftRepository, type NextSourceScope } from './postgres'
import {
  EditorScopedRepository,
  EditorSessionAuthority,
  EditorSiteSessionIdentitySchema,
  PostgresEditorScopedStorage,
} from '../editor'
import {
  NextSourceEditorCommitCommandSchema,
  NextSourceEditorCommitReceiptSchema,
  NextSourceEditorCommitService,
} from './commit'
import { NextSourceProjectionError } from './projection'
import { PostgresReleaseRepository } from '../releases'
import { NextSourceGitHubProviderCommandSchema, NextSourceReleaseExportRecordSchema, NextSourceReleaseExportService } from './export'

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 2_000 }) }, { additionalProperties: false })
const DraftResponseSchema = Type.Object({ revision: NextSourceDraftRevisionSchema, receipt: NextSourceIngestReceiptSchema }, { additionalProperties: false })
const RevisionResponseSchema = Type.Object({ revision: NextSourceDraftRevisionSchema }, { additionalProperties: false })
const FixResponseSchema = Type.Object({ receipt: NextSourceFixReceiptSchema }, { additionalProperties: false })
const FixDetailResponseSchema = Type.Object({
  receipt: NextSourceFixReceiptSchema,
  changes: Type.Array(Type.Object({
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    expectedSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    before: Type.String({ maxLength: 1_000_000 }),
    after: Type.String({ maxLength: 1_000_000 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 500 }),
}, { additionalProperties: false })
const ApplyResponseSchema = Type.Object({ revision: NextSourceDraftRevisionSchema }, { additionalProperties: false })
const RollbackResponseSchema = Type.Object({ receipt: NextSourceRollbackReceiptSchema }, { additionalProperties: false })
const CommitResponseSchema = Type.Object({ state: Type.Literal('committed'), replayed: Type.Boolean(), receipt: NextSourceEditorCommitReceiptSchema }, { additionalProperties: false })
const CommitConflictResponseSchema = Type.Object({
  state: Type.Literal('conflict'),
  code: Type.Union([Type.Literal('draft-sequence-conflict'), Type.Literal('mutation-id-reused')]),
  expectedSequence: Type.Integer({ minimum: 0 }),
  authoritativeSequence: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })
const ExportCommandSchema = Type.Object({
  github: Type.Optional(NextSourceGitHubProviderCommandSchema),
}, { additionalProperties: false })
const ExportResponseSchema = Type.Object({
  state: Type.Union([
    Type.Literal('artifact-created'),
    Type.Literal('github-pending'),
    Type.Literal('github-exported'),
  ]),
  replayed: Type.Boolean(),
  record: NextSourceReleaseExportRecordSchema,
}, { additionalProperties: false })
const BlockedResponseSchema = Type.Object({ state: Type.Literal('blocked'), reason: Type.String({ minLength: 1, maxLength: 2_000 }) }, { additionalProperties: false })
const WorkflowStateResponseSchema = Type.Object({
  editorSequence: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  activeRelease: Type.Union([
    Type.Object({
      releaseId: Type.String({ minLength: 1, maxLength: 255 }),
      activatedAt: Type.String({ format: 'date-time' }),
    }, { additionalProperties: false }),
    Type.Null(),
  ]),
}, { additionalProperties: false })
const LocalQuerySchema = Type.Object({ locator: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false })

type ResolveSession = (headers: Headers) => Promise<HostedResolvedSession | null>

function response<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Next source route response failed strict TypeBox validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } })
}
function failure(error: unknown): Response {
  if (error instanceof NextSourceProjectionError) {
    return response(BlockedResponseSchema, { state: 'blocked', reason: error.message }, 409)
  }
  console.error('[fuma-next-source] request failed:', error)
  const message = error instanceof Error ? error.message : 'Next source request failed.'
  const denied = /owner|authority|scope|destination|unavailable/i.test(message)
  const conflict = /changed|conflict|already|replay/i.test(message)
  return response(ErrorSchema, { error: message }, denied ? 403 : conflict ? 409 : 400)
}
function scope(input: FumaScopedRouteHandlerInput): NextSourceScope {
  return Object.freeze({ platformId: input.repositoryScope.platformId, organizationId: input.repositoryScope.organizationId, workspaceId: input.repositoryScope.workspaceId, siteId: input.repositoryScope.siteId, ownerKey: input.repositoryScope.ownerKey, ownerGeneration: input.repositoryScope.generation, profileId: input.context.profile.id })
}
function destination(value: NextSourceScope): NextSourceDestination {
  return { organizationId: value.organizationId, workspaceId: value.workspaceId, siteId: value.siteId }
}
function releaseScope(value: NextSourceScope) {
  return Object.freeze({
    platformId: value.platformId,
    organizationId: value.organizationId,
    workspaceId: value.workspaceId,
    siteId: value.siteId,
    ownerKey: value.ownerKey,
    generation: value.ownerGeneration,
    state: 'active' as const,
    transferFence: null,
  })
}
function repository(db: DbClient, storage: TenantObjectStorage, value: NextSourceScope) {
  return new PostgresNextSourceDraftRepository({ db, storage, scope: value })
}
async function editorRepository(db: DbClient, route: FumaScopedRouteHandlerInput) {
  const editorSessionId = await new EditorSessionAuthority().resolveEditorSessionKey(Object.freeze({
    context: route.context,
    repositoryScope: route.repositoryScope,
  }))
  const identity = safeParseValue(EditorSiteSessionIdentitySchema, {
    ...route.repositoryScope,
    profileId: route.context.profile.id,
    editorSessionId,
  })
  if (!identity.ok) throw new Error('Exact editor session identity is unavailable.')
  return new EditorScopedRepository(new PostgresEditorScopedStorage(db)).forScope(Object.freeze(identity.value))
}
async function audit(service: AuditService, input: FumaScopedRouteHandlerInput, changedFields: readonly string[]) {
  await service.recordRequest(input.context, { action: 'site.updated', target: 'site', outcome: 'success', metadata: { changedFields: [...changedFields] } })
}
async function meter(collector: MeteringCollector, value: NextSourceScope, id: string, bytes: number, occurredAt: string) {
  await collector.record({ idempotencyKey: `next-source:${id}`, organizationId: value.organizationId, workspaceId: value.workspaceId, siteId: value.siteId, occurredAt, internalWorkload: false, kind: 'storage', logicalBytes: bytes, sourceBytes: bytes, variantBytes: 0, releaseBytes: 0, localBackupBytes: 0, offsiteBytes: 0 })
}

export function createNextSourceScopedRoutes(input: Readonly<{
  db: DbClient
  storage: TenantObjectStorage
  releaseStorage: TenantObjectStorage
  audit: AuditService
  metering: MeteringCollector
  resolveSession: ResolveSession
  github?: Readonly<{ config: HostedNextSourceGitHubConfig; tokens: GitHubAppInstallationTokenAuthority; fetch: SafeGitHubZipballFetchPort }>
}>): readonly FumaScopedRouteDeclaration[] {
  const wrap = (method: FumaScopedRouteDeclaration['method'], path: string, permission: FumaScopedRouteDeclaration['permission'], handler: (route: FumaScopedRouteHandlerInput) => Promise<Response>): FumaScopedRouteDeclaration => Object.freeze({ method, path, permission, handler: async (route) => { try { return await handler(route) } catch (error) { return failure(error) } } })
  return Object.freeze([
    wrap('POST', '/source-import/drafts', 'site.structure.edit', async (route) => {
      const contentLength = Number(route.request.headers.get('content-length') ?? '0')
      if (contentLength > MAX_ARCHIVE_BYTES) return response(ErrorSchema, { error: 'Next source archive exceeds the source byte limit.' }, 413)
      const url = new URL(route.request.url)
      const parsedQuery = safeParseValue(LocalQuerySchema, { locator: url.searchParams.get('locator') ?? '' })
      if (!parsedQuery.ok || [...url.searchParams.keys()].some((key) => key !== 'locator')) return response(ErrorSchema, { error: 'Next source locator is invalid.' }, 400)
      const bytes = new Uint8Array(await route.request.arrayBuffer())
      if (bytes.byteLength > MAX_ARCHIVE_BYTES) return response(ErrorSchema, { error: 'Next source archive exceeds the source byte limit.' }, 413)
      const bound = scope(route)
      const ingested = await ingestLocalNextSource({ kind: 'zip', name: parsedQuery.value.locator, bytes }, destination(bound))
      const store = repository(input.db, input.storage, bound)
      const service = new NextSourceAdaptationService({ repository: store, authority: new PostgresNextSourceAdaptationAuthority({ db: input.db, scope: bound }), ownerConfirmation: { async verifyOwner() { return { active: false, direct: false, impersonating: false, ownerGeneration: 0 } } } })
      const revision = await service.createDraft(ingested.fileMap, { destination: destination(bound), provenance: ingested.receipt.provenance })
      await store.putIngestReceipt(revision.revisionId, ingested.receipt)
      await meter(input.metering, bound, ingested.receipt.receiptId, ingested.receipt.totalBytes, ingested.receipt.createdAt)
      await audit(input.audit, route, ['nextSourceDraft', revision.revisionId, revision.sourceHashSha256])
      return response(DraftResponseSchema, { revision, receipt: ingested.receipt }, 201)
    }),
    wrap('POST', '/source-import/github/drafts', 'site.structure.edit', async (route) => {
      if (!input.github) return response(ErrorSchema, { error: 'GitHub App source ingestion is not configured.' }, 503)
      const selection = await readValidatedBody(route.request, NextSourceGitHubSelectionSchema)
      if (!selection) return response(ErrorSchema, { error: 'Exact GitHub installation, repository, branch, and commit are required.' }, 400)
      const bound = scope(route)
      const ingested = await new GitHubAppNextSourceIngestor({ tokens: input.github.tokens, transport: input.github.fetch }).ingest(selection, destination(bound))
      const store = repository(input.db, input.storage, bound)
      const service = new NextSourceAdaptationService({ repository: store, authority: new PostgresNextSourceAdaptationAuthority({ db: input.db, scope: bound }), ownerConfirmation: { async verifyOwner() { return { active: false, direct: false, impersonating: false, ownerGeneration: 0 } } } })
      const revision = await service.createDraft(ingested.fileMap, { destination: destination(bound), provenance: ingested.receipt.provenance })
      await store.putIngestReceipt(revision.revisionId, ingested.receipt)
      await meter(input.metering, bound, ingested.receipt.receiptId, ingested.receipt.totalBytes, ingested.receipt.createdAt)
      await audit(input.audit, route, ['nextSourceGitHubDraft', revision.revisionId, revision.sourceHashSha256])
      return response(DraftResponseSchema, { revision, receipt: ingested.receipt }, 201)
    }),
    wrap('GET', '/source-import/workflow-state', 'site.read', async (route) => {
      const bound = scope(route)
      const draft = await (await editorRepository(input.db, route)).loadDraft()
      const releases = new PostgresReleaseRepository(input.db).forScope(releaseScope(bound))
      const activeRelease = await releases.transaction(async (transaction) => await transaction.getActivePointer())
      return response(WorkflowStateResponseSchema, {
        editorSequence: draft.sequence,
        activeRelease: activeRelease
          ? { releaseId: activeRelease.releaseId, activatedAt: activeRelease.activatedAt }
          : null,
      })
    }),
    wrap('GET', '/source-import/revisions/:revisionId', 'site.read', async (route) => {
      const value = await repository(input.db, input.storage, scope(route)).getRevision(route.params.revisionId!)
      return value ? response(RevisionResponseSchema, { revision: value.revision }) : response(ErrorSchema, { error: 'Source revision was not found.' }, 404)
    }),
    wrap('GET', '/source-import/fixes/:receiptId', 'site.read', async (route) => {
      const store = repository(input.db, input.storage, scope(route))
      const value = await store.getFix(route.params.receiptId!)
      if (!value) return response(ErrorSchema, { error: 'Source fix receipt was not found.' }, 404)
      const source = await store.getRevision(value.receipt.authority.sourceRevisionId)
      if (!source) throw new Error('Source fix input revision is unavailable.')
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const changes = value.patches.map((patch) => {
        const file = source.files.files[patch.path]
        if (!file || sha256Hex(file.bytes) !== patch.expectedSha256) {
          throw new Error('Source fix patch differs from its exact input revision.')
        }
        let before: string
        try { before = decoder.decode(file.bytes) } catch { throw new Error('Source fix input is not valid UTF-8.') }
        if (before.length > 1_000_000) throw new Error('Source fix diff exceeds the review byte limit.')
        return { path: patch.path, expectedSha256: patch.expectedSha256, before, after: patch.replacement }
      })
      return response(FixDetailResponseSchema, { receipt: value.receipt, changes })
    }),
    wrap('POST', '/source-import/fixes/:receiptId/confirm', 'site.structure.edit', async (route) => {
      const bound = scope(route)
      const service = new NextSourceAdaptationService({ repository: repository(input.db, input.storage, bound), authority: new PostgresNextSourceAdaptationAuthority({ db: input.db, scope: bound }), ownerConfirmation: new BetterAuthNextSourceOwnerConfirmation({ db: input.db, context: route.context, requestHeaders: route.request.headers, resolveSession: input.resolveSession, scope: bound }) })
      const actorId = route.context.actor.kind === 'staff' ? route.context.actor.userId : ''
      const receipt = await service.confirmFix({ receiptId: route.params.receiptId!, ownerActorId: actorId })
      await audit(input.audit, route, ['nextSourceFixConfirmed', receipt.receiptId])
      return response(FixResponseSchema, { receipt })
    }),
    wrap('POST', '/source-import/fixes/:receiptId/apply', 'site.structure.edit', async (route) => {
      const bound = scope(route)
      const service = new NextSourceAdaptationService({ repository: repository(input.db, input.storage, bound), authority: new PostgresNextSourceAdaptationAuthority({ db: input.db, scope: bound }), ownerConfirmation: { async verifyOwner() { return { active: false, direct: false, impersonating: false, ownerGeneration: 0 } } } })
      const revision = await service.applyFix(route.params.receiptId!)
      await meter(input.metering, bound, revision.revisionId, revision.analysis.files.reduce((sum, file) => sum + file.sizeBytes, 0), revision.createdAt)
      await audit(input.audit, route, ['nextSourceFixApplied', route.params.receiptId!, revision.revisionId])
      return response(ApplyResponseSchema, { revision }, 201)
    }),
    wrap('POST', '/source-import/rollback/:currentRevisionId/:restoreRevisionId', 'site.structure.edit', async (route) => {
      const bound = scope(route)
      const service = new NextSourceAdaptationService({ repository: repository(input.db, input.storage, bound), authority: new PostgresNextSourceAdaptationAuthority({ db: input.db, scope: bound }), ownerConfirmation: { async verifyOwner() { return { active: false, direct: false, impersonating: false, ownerGeneration: 0 } } } })
      const actorId = route.context.actor.kind === 'staff' ? route.context.actor.userId : 'internal-job-denied'
      const receipt = await service.rollback({ currentRevisionId: route.params.currentRevisionId!, restoreRevisionId: route.params.restoreRevisionId!, actorId })
      await audit(input.audit, route, ['nextSourceRollback', receipt.receiptId])
      return response(RollbackResponseSchema, { receipt }, 201)
    }),
    wrap('POST', '/source-import/revisions/:revisionId/commit', 'site.structure.edit', async (route) => {
      const command = await readValidatedBody(route.request, NextSourceEditorCommitCommandSchema)
      if (!command) return response(ErrorSchema, { error: 'Exact expected editor draft sequence is required.' }, 400)
      if (route.context.actor.kind !== 'staff') return response(ErrorSchema, { error: 'Direct staff editor authority is required.' }, 403)
      const bound = scope(route)
      const service = new NextSourceEditorCommitService({
        db: input.db,
        scope: bound,
        sources: repository(input.db, input.storage, bound),
        editor: await editorRepository(input.db, route),
      })
      const result = await service.commit({
        revisionId: route.params.revisionId!,
        expectedSequence: command.expectedSequence,
        actorId: route.context.actor.userId,
      })
      if (result.outcome === 'conflict') {
        return response(CommitConflictResponseSchema, {
          state: 'conflict',
          code: result.code,
          expectedSequence: result.expectedSequence,
          authoritativeSequence: result.authoritativeSequence,
        }, 409)
      }
      await audit(input.audit, route, [
        'nextSourceEditorCommit',
        result.receipt.commitId,
        result.receipt.revisionId,
        result.receipt.sourceHashSha256,
        result.receipt.documentHashSha256,
      ])
      return response(CommitResponseSchema, { state: 'committed', replayed: result.replayed, receipt: result.receipt }, result.replayed ? 200 : 201)
    }),
    wrap('GET', '/source-export/releases/:releaseId/archive', 'site.read', async (route) => {
      const bound = scope(route)
      const artifact = await new NextSourceReleaseExportService({
        db: input.db,
        scope: bound,
        releaseStorage: input.releaseStorage,
        exportStorage: input.storage,
      }).readArtifact(route.params.releaseId!)
      return new Response(Uint8Array.from(artifact.archive), {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'content-disposition': `attachment; filename="fuma-next-source-${artifact.record.objectHashSha256.slice(0, 16)}.zip"`,
          'content-length': String(artifact.archive.byteLength),
          'content-type': 'application/zip',
          'x-content-type-options': 'nosniff',
        },
      })
    }),
    wrap('POST', '/source-export/releases/:releaseId', 'site.structure.edit', async (route) => {
      const command = await readValidatedBody(route.request, ExportCommandSchema)
      if (!command) return response(ErrorSchema, { error: 'Export command is invalid.' }, 400)
      const bound = scope(route)
      const exporter = new NextSourceReleaseExportService({
        db: input.db,
        scope: bound,
        releaseStorage: input.releaseStorage,
        exportStorage: input.storage,
      })
      const result = command.github
        ? input.github
          ? await exporter.exportToGitHub({
              releaseId: route.params.releaseId!,
              command: command.github,
              adapter: new GitHubAppNextSourceExportAdapter({
                tokens: input.github.tokens,
                installationId: command.github.installationId,
                config: input.github.config,
              }),
            })
          : null
        : await exporter.create(route.params.releaseId!)
      if (!result) return response(ErrorSchema, { error: 'GitHub App export is not configured.' }, 503)
      await meter(input.metering, bound, result.record.exportId, result.record.objectSizeBytes, result.record.createdAt)
      await audit(input.audit, route, [
        'nextSourceReleaseExport',
        result.record.exportId,
        result.record.releaseId,
        result.record.sourceSnapshotId,
        result.record.sourceSnapshotHashSha256,
        result.record.objectHashSha256,
        result.record.state,
        result.record.githubOperationId ?? 'artifact-only',
      ])
      return response(ExportResponseSchema, {
        state: result.record.state,
        replayed: result.replayed,
        record: result.record,
      }, result.replayed ? 200 : 201)
    }),
  ])
}
