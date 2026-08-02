import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { unzipSync } from 'fflate'
import {
  NextSourceExportManifestSchema,
  NextSourceGitHubExportReceiptSchema,
  NextSourceGitHubExportRequestSchema,
  buildNextSourceExport,
  type NextSourceExportArtifact,
  type NextSourceGitHubExportReceipt,
} from '@core/siteImport'
import type { EditorSiteDocument } from '../editor'
import type { DbClient } from '../../db/client'
import {
  ObjectStorageError,
  sha256Hex,
  type TenantObjectStorage,
} from '../objectStorage'
import { PostgresPublishSnapshotAuthority, canonicalPublishJson } from '../publishing/postgresAdapters'
import { PostgresReleaseRepository } from '../releases'
import { NextSourceEditorCommitReceiptSchema, type NextSourceEditorCommitReceipt } from './commit'
import type { NextSourceScope } from './postgres'
import type { GitHubAppNextSourceExportAdapter } from './github'

const HASH = Type.String({ pattern: '^[a-f0-9]{64}$' })
const ID = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })

export const NextSourceGitHubProviderCommandSchema = Type.Object({
  installationId: Type.String({ pattern: '^[1-9][0-9]{0,19}$' }),
  request: NextSourceGitHubExportRequestSchema,
}, { additionalProperties: false })
export type NextSourceGitHubProviderCommand = Static<typeof NextSourceGitHubProviderCommandSchema>

export const NextSourceReleaseExportRecordSchema = Type.Object({
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
  state: Type.Union([
    Type.Literal('artifact-created'),
    Type.Literal('github-pending'),
    Type.Literal('github-exported'),
  ]),
  version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  githubOperationId: Type.Union([ID, Type.Null()]),
  githubRequest: Type.Union([NextSourceGitHubProviderCommandSchema, Type.Null()]),
  githubReceipt: Type.Union([NextSourceGitHubExportReceiptSchema, Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  exportedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
}, { additionalProperties: false })
export type NextSourceReleaseExportRecord = Static<typeof NextSourceReleaseExportRecordSchema>

type AttemptRow = Readonly<{ snapshot_id: string; snapshot_hash: string }>
type CommitRow = Readonly<{ receipt_json: unknown }>
type ExportRow = Readonly<{
  export_id: string
  revision_id: string
  release_id: string
  source_snapshot_id: string
  source_snapshot_hash_sha256: string
  document_hash_sha256: string
  object_key: string
  object_hash_sha256: string
  object_size_bytes: string | number | bigint
  manifest_json: unknown
  github_operation_id: string | null
  github_request_json: unknown | null
  github_receipt_json: unknown | null
  state: string
  version: string | number | bigint
  created_at: string | Date
  exported_at: string | Date | null
}>

const textDecoder = new TextDecoder('utf-8', { fatal: true })
const textEncoder = new TextEncoder()

function canonicalHash(value: unknown): string {
  return sha256Hex(textEncoder.encode(canonicalPublishJson(value)))
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Stored next-source export JSON is invalid.')
  }
}

function filesFromArchive(archive: Uint8Array): NextSourceExportArtifact['files'] {
  const entries = unzipSync(archive)
  const files: NextSourceExportArtifact['files'] = { files: {} }
  for (const [path, bytes] of Object.entries(entries).sort(([left], [right]) => left.localeCompare(right))) {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('Stored export archive contains an unsafe path.')
    }
    files.files[path] = { bytes }
  }
  if (!files.files['fuma-export.json']) throw new Error('Stored export archive is missing its provenance manifest.')
  return files
}

function parseCommit(value: unknown): NextSourceEditorCommitReceipt {
  const parsed = safeParseValue(NextSourceEditorCommitReceiptSchema, parseJson(value))
  if (!parsed.ok) throw new Error('Stored source editor commit evidence is invalid.')
  return parsed.value
}

function iso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Stored export timestamp is invalid.')
  return date.toISOString()
}

function positive(value: string | number | bigint): number {
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < 1) throw new Error('Stored export object size is invalid.')
  return numeric
}

function releaseRoute(logicalPath: string): string {
  if (logicalPath === '/index.html') return '/'
  if (!logicalPath.endsWith('.html')) throw new Error(`Release HTML artifact has no replaceable route: ${logicalPath}`)
  const route = logicalPath.slice(0, -'.html'.length)
  if (!/^\/[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(route) || route.includes('//') || route.includes('/../')) {
    throw new Error(`Release HTML artifact path is not canonical: ${logicalPath}`)
  }
  return route
}

function safeArtifactPath(logicalPath: string): string {
  if (!logicalPath.startsWith('/') || logicalPath.includes('..') || logicalPath.includes('\\')) {
    throw new Error(`Unsafe release artifact path: ${logicalPath}`)
  }
  return logicalPath.slice(1)
}

function rawHtmlRouteSource(html: string): string {
  return `const html = ${JSON.stringify(html)}\n\nexport function GET(): Response {\n  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } })\n}\n`
}

function assertStaticReplaceableDocument(document: EditorSiteDocument): void {
  if (Object.keys(document.site.runtime.scripts).length > 0) {
    throw new Error('Release export is blocked until site scripts are mapped to replaceable adapters.')
  }
  const allowed = new Set(['base.body', 'base.container', 'base.text', 'base.link', 'base.button'])
  const trees = [
    ...document.pages,
    ...document.layouts,
    ...document.visualComponents.map(({ tree }) => tree),
  ]
  for (const tree of trees) {
    for (const node of Object.values(tree.nodes)) {
      if (!allowed.has(node.moduleId)) throw new Error(`Release module ${node.moduleId} is outside the complete static export subset.`)
      if (node.propBindings && Object.keys(node.propBindings).length > 0) throw new Error('Release prop bindings require a replaceable content adapter.')
      if ('dynamicBindings' in node && node.dynamicBindings && Object.keys(node.dynamicBindings).length > 0) {
        throw new Error('Release dynamic bindings require a replaceable content adapter.')
      }
    }
  }
}

async function verifiedReleaseBytes(
  storage: TenantObjectStorage,
  scope: NextSourceScope,
  artifact: Readonly<{
    objectKey: string
    contentHashSha256: string
    sizeBytes: number
    mimeType: string
  }>,
): Promise<Uint8Array> {
  const objectScope = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
  }
  const metadata = await storage.head(objectScope, artifact.objectKey)
  if (
    metadata.key !== artifact.objectKey
    || metadata.checksumSha256 !== artifact.contentHashSha256
    || metadata.sizeBytes !== artifact.sizeBytes
    || metadata.mimeType !== artifact.mimeType
  ) throw new Error('Immutable release artifact metadata changed before export.')
  const bytes = await storage.get(objectScope, artifact.objectKey)
  if (bytes.byteLength !== artifact.sizeBytes || sha256Hex(bytes) !== artifact.contentHashSha256) {
    throw new Error('Immutable release artifact bytes changed before export.')
  }
  return bytes
}

async function putImmutableExport(
  storage: TenantObjectStorage,
  scope: NextSourceScope,
  key: string,
  bytes: Uint8Array,
  hash: string,
): Promise<void> {
  const objectScope = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
  }
  try {
    await storage.put({
      scope: objectScope,
      key,
      bytes,
      mimeType: 'application/zip',
      checksumSha256: hash,
    })
  } catch (error) {
    if (!(error instanceof ObjectStorageError) || error.code !== 'already_exists') throw error
    const metadata = await storage.head(objectScope, key)
    if (metadata.checksumSha256 !== hash || metadata.sizeBytes !== bytes.byteLength || metadata.mimeType !== 'application/zip') {
      throw new Error('Existing export object conflicts with immutable export evidence.', { cause: error })
    }
  }
}

export class NextSourceReleaseExportService {
  readonly #db: DbClient
  readonly #scope: NextSourceScope
  readonly #releaseStorage: TenantObjectStorage
  readonly #exportStorage: TenantObjectStorage
  readonly #now: () => Date

  constructor(input: Readonly<{
    db: DbClient
    scope: NextSourceScope
    releaseStorage: TenantObjectStorage
    exportStorage: TenantObjectStorage
    now?: () => Date
  }>) {
    if (input.db.dialect !== 'postgres') throw new TypeError('Hosted release export requires PostgreSQL.')
    this.#db = input.db
    this.#scope = input.scope
    this.#releaseStorage = input.releaseStorage
    this.#exportStorage = input.exportStorage
    this.#now = input.now ?? (() => new Date())
  }

  async create(releaseId: string): Promise<Readonly<{
    replayed: boolean
    record: NextSourceReleaseExportRecord
    artifact: NextSourceExportArtifact
  }>> {
    const existing = await this.#find(releaseId)
    if (existing) {
      const archive = await this.#exportStorage.get({
        organizationId: this.#scope.organizationId,
        workspaceId: this.#scope.workspaceId,
        siteId: this.#scope.siteId,
      }, existing.objectKey)
      if (archive.byteLength !== existing.objectSizeBytes || sha256Hex(archive) !== existing.objectHashSha256) {
        throw new Error('Stored export archive no longer matches durable evidence.')
      }
      return Object.freeze({ replayed: true, record: existing, artifact: { files: filesFromArchive(archive), archive, manifest: existing.manifest } })
    }
    const releaseScope = {
      platformId: this.#scope.platformId,
      organizationId: this.#scope.organizationId,
      workspaceId: this.#scope.workspaceId,
      siteId: this.#scope.siteId,
      ownerKey: this.#scope.ownerKey,
      generation: this.#scope.ownerGeneration,
      state: 'active' as const,
      transferFence: null,
    }
    const release = await new PostgresReleaseRepository(this.#db).forScope(releaseScope).read(releaseId)
    if (!release || !['ready', 'active'].includes(release.status) || !release.manifest) {
      throw new Error('Exact ready or active immutable release is unavailable.')
    }
    const attempts = await this.#db.unsafe<AttemptRow>(`
      select distinct snapshot_id,snapshot_hash
      from fuma_publish_attempts
      where platform_id=$1 and owner_key=$2 and organization_id=$3 and workspace_id=$4
        and site_id=$5 and release_id=$6 and snapshot_hash=$7 and stage in ('finalized','activated')
    `, [
      this.#scope.platformId,
      this.#scope.ownerKey,
      this.#scope.organizationId,
      this.#scope.workspaceId,
      this.#scope.siteId,
      releaseId,
      release.sourceSnapshotHashSha256,
    ])
    if (attempts.rows.length !== 1) throw new Error('Exact finalized publish snapshot evidence is unavailable or ambiguous.')
    const attempt = attempts.rows[0]!
    const snapshot = await new PostgresPublishSnapshotAuthority(this.#db).claimExact(
      { scope: releaseScope, profileId: this.#scope.profileId },
      attempt.snapshot_id,
      attempt.snapshot_hash,
    )
    const document = snapshot.document as EditorSiteDocument
    assertStaticReplaceableDocument(document)
    const commitRows = await this.#db.unsafe<CommitRow>(`
      select receipt_json from fuma_next_source_editor_commits_v1
      where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
        and owner_key=$5 and owner_generation=$6 and profile_id=$7 and mutation_id=$8
    `, [
      this.#scope.platformId,
      this.#scope.organizationId,
      this.#scope.workspaceId,
      this.#scope.siteId,
      this.#scope.ownerKey,
      this.#scope.ownerGeneration,
      this.#scope.profileId,
      snapshot.id,
    ])
    if (commitRows.rows.length !== 1) throw new Error('Release snapshot is not bound to one exact imported source commit.')
    const sourceCommit = parseCommit(commitRows.rows[0]!.receipt_json)
    const documentHashSha256 = canonicalHash(document)
    if (sourceCommit.documentHashSha256 !== documentHashSha256) {
      throw new Error('Release snapshot document differs from source editor commit evidence.')
    }

    const assets: Record<string, string | { encoding: 'base64'; content: string }> = {}
    const routes: Array<{ path: string; title: string; kind: 'raw-html'; source: string }> = []
    for (const releaseArtifact of [...release.manifest.artifacts].sort((left, right) => left.logicalPath.localeCompare(right.logicalPath))) {
      const bytes = await verifiedReleaseBytes(this.#releaseStorage, this.#scope, releaseArtifact)
      const logical = safeArtifactPath(releaseArtifact.logicalPath)
      if (releaseArtifact.kind === 'html') {
        let html: string
        try { html = textDecoder.decode(bytes) } catch { throw new Error(`Release HTML is not valid UTF-8: ${releaseArtifact.logicalPath}`) }
        const page = document.pages.find(({ slug }) => (slug === 'index' ? '/index.html' : `/${slug}.html`) === releaseArtifact.logicalPath)
        routes.push({ path: releaseRoute(releaseArtifact.logicalPath), title: page?.title ?? releaseArtifact.logicalPath, kind: 'raw-html', source: rawHtmlRouteSource(html) })
        assets[`public/_fuma-release/html/${logical}`] = { encoding: 'base64', content: Buffer.from(bytes).toString('base64') }
      } else {
        assets[`public/${logical}`] = { encoding: 'base64', content: Buffer.from(bytes).toString('base64') }
      }
    }
    if (routes.length === 0) throw new Error('Release has no semantic HTML routes to export.')
    const exportIdentity = canonicalHash({
      scope: this.#scope,
      releaseId,
      releaseHashSha256: release.manifest.manifestHashSha256,
      sourceRevisionId: sourceCommit.revisionId,
      sourceSnapshotId: snapshot.id,
      sourceSnapshotHashSha256: snapshot.hashSha256,
    })
    const exportId = `next-export:${exportIdentity}`
    const artifact = await buildNextSourceExport({
      exportId,
      destination: sourceCommit.destination,
      releaseId,
      releaseHashSha256: release.manifest.manifestHashSha256,
      sourceSnapshotId: snapshot.id,
      sourceSnapshotHashSha256: snapshot.hashSha256,
      documentHashSha256,
      siteName: document.site.name,
      sourceRevisionId: sourceCommit.revisionId,
      adapters: [],
      routes,
      assets,
      contentSnapshot: document,
    })
    const objectHashSha256 = sha256Hex(artifact.archive)
    const objectKey = `exports/next-source/${objectHashSha256}.zip`
    const createdAt = this.#now().toISOString()
    await putImmutableExport(this.#exportStorage, this.#scope, objectKey, artifact.archive, objectHashSha256)
    await this.#db.unsafe(`
      insert into fuma_next_source_exports_v1(
        export_id,revision_id,release_id,source_snapshot_id,source_snapshot_hash_sha256,document_hash_sha256,
        platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
        object_key,object_hash_sha256,object_size_bytes,manifest_json,state,created_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::text::jsonb,'artifact-created',$18)
      on conflict(export_id) do nothing
    `, [
      exportId,
      sourceCommit.revisionId,
      releaseId,
      snapshot.id,
      snapshot.hashSha256,
      documentHashSha256,
      this.#scope.platformId,
      this.#scope.organizationId,
      this.#scope.workspaceId,
      this.#scope.siteId,
      this.#scope.ownerKey,
      this.#scope.ownerGeneration,
      this.#scope.profileId,
      objectKey,
      objectHashSha256,
      artifact.archive.byteLength,
      JSON.stringify(artifact.manifest),
      createdAt,
    ])
    const stored = await this.#find(releaseId)
    if (!stored || stored.exportId !== exportId || stored.objectHashSha256 !== objectHashSha256) {
      throw new Error('Durable release export evidence conflicts with generated artifact.')
    }
    return Object.freeze({ replayed: false, record: stored, artifact })
  }

  async readArtifact(releaseId: string): Promise<Readonly<{
    record: NextSourceReleaseExportRecord
    archive: Uint8Array
  }>> {
    const record = await this.#find(releaseId)
    if (!record) throw new Error('Durable release export artifact is unavailable.')
    const archive = await this.#exportStorage.get({
      organizationId: this.#scope.organizationId,
      workspaceId: this.#scope.workspaceId,
      siteId: this.#scope.siteId,
    }, record.objectKey)
    if (archive.byteLength !== record.objectSizeBytes || sha256Hex(archive) !== record.objectHashSha256) {
      throw new Error('Stored export archive no longer matches durable evidence.')
    }
    return Object.freeze({ record, archive })
  }

  async exportToGitHub(input: Readonly<{
    releaseId: string
    command: NextSourceGitHubProviderCommand
    adapter: GitHubAppNextSourceExportAdapter
  }>): Promise<Readonly<{
    replayed: boolean
    record: NextSourceReleaseExportRecord
    receipt: NextSourceGitHubExportReceipt
  }>> {
    const command = safeParseValue(NextSourceGitHubProviderCommandSchema, input.command)
    if (!command.ok) throw new Error('Invalid GitHub provider export command.')
    const built = await this.create(input.releaseId)
    const operationId = `next-github:${canonicalHash({
      exportId: built.record.exportId,
      installationId: command.value.installationId,
      request: command.value.request,
    })}`
    if (built.record.state === 'artifact-created') {
      await this.#db.unsafe(`
        update fuma_next_source_exports_v1 set
          github_operation_id=$1,github_request_json=$2::text::jsonb,
          state='github-pending',version=version+1
        where export_id=$3 and platform_id=$4 and organization_id=$5 and workspace_id=$6
          and site_id=$7 and owner_key=$8 and owner_generation=$9 and profile_id=$10
          and state='artifact-created'
      `, [
        operationId,
        JSON.stringify(command.value),
        built.record.exportId,
        this.#scope.platformId,
        this.#scope.organizationId,
        this.#scope.workspaceId,
        this.#scope.siteId,
        this.#scope.ownerKey,
        this.#scope.ownerGeneration,
        this.#scope.profileId,
      ])
    }
    let pending = await this.#find(input.releaseId)
    if (
      !pending
      || pending.githubOperationId !== operationId
      || canonicalPublishJson(pending.githubRequest) !== canonicalPublishJson(command.value)
    ) throw new Error('GitHub export operation conflicts with durable provider evidence.')
    if (pending.state === 'github-exported') {
      if (!pending.githubReceipt) throw new Error('Completed GitHub export lost its receipt.')
      return Object.freeze({ replayed: true, record: pending, receipt: pending.githubReceipt })
    }
    if (pending.state !== 'github-pending') throw new Error('GitHub export is not in a recoverable pending state.')
    const receipt = await input.adapter.exportOrRecover(built.artifact, command.value.request)
    const exportedAt = this.#now().toISOString()
    await this.#db.unsafe(`
      update fuma_next_source_exports_v1 set
        github_receipt_json=$1::text::jsonb,state='github-exported',exported_at=$2,version=version+1
      where export_id=$3 and platform_id=$4 and organization_id=$5 and workspace_id=$6
        and site_id=$7 and owner_key=$8 and owner_generation=$9 and profile_id=$10
        and state='github-pending' and github_operation_id=$11
    `, [
      JSON.stringify(receipt),
      exportedAt,
      pending.exportId,
      this.#scope.platformId,
      this.#scope.organizationId,
      this.#scope.workspaceId,
      this.#scope.siteId,
      this.#scope.ownerKey,
      this.#scope.ownerGeneration,
      this.#scope.profileId,
      operationId,
    ])
    pending = await this.#find(input.releaseId)
    if (!pending || pending.state !== 'github-exported' || !pending.githubReceipt) {
      throw new Error('GitHub export provider receipt was not durably finalized.')
    }
    if (canonicalPublishJson(pending.githubReceipt) !== canonicalPublishJson(receipt)) {
      throw new Error('GitHub export provider receipt conflicts with durable evidence.')
    }
    return Object.freeze({ replayed: false, record: pending, receipt: pending.githubReceipt })
  }

  async #find(releaseId: string): Promise<NextSourceReleaseExportRecord | null> {
    const result = await this.#db.unsafe<ExportRow>(`
      select export_id,revision_id,release_id,source_snapshot_id,source_snapshot_hash_sha256,
        document_hash_sha256,object_key,object_hash_sha256,object_size_bytes,
        manifest_json,github_operation_id,github_request_json,github_receipt_json,
        state,version,created_at,exported_at
      from fuma_next_source_exports_v1
      where platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4
        and owner_key=$5 and owner_generation=$6 and profile_id=$7 and release_id=$8
    `, [
      this.#scope.platformId,
      this.#scope.organizationId,
      this.#scope.workspaceId,
      this.#scope.siteId,
      this.#scope.ownerKey,
      this.#scope.ownerGeneration,
      this.#scope.profileId,
      releaseId,
    ])
    if (result.rows.length > 1) throw new Error('Release export evidence is ambiguous.')
    const row = result.rows[0]
    if (!row) return null
    const manifest = safeParseValue(NextSourceExportManifestSchema, parseJson(row.manifest_json))
    if (!manifest.ok) throw new Error('Stored release export manifest is invalid.')
    const commitRows = await this.#db.unsafe<CommitRow>(`
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
      row.revision_id,
    ])
    if (commitRows.rows.length !== 1) throw new Error('Stored export lost source commit ancestry.')
    const commit = parseCommit(commitRows.rows[0]!.receipt_json)
    if (commit.mutationId !== row.source_snapshot_id || commit.documentHashSha256 !== row.document_hash_sha256) {
      throw new Error('Stored export snapshot ancestry differs from source commit evidence.')
    }
    const githubRequest = row.github_request_json === null
      ? null
      : safeParseValue(NextSourceGitHubProviderCommandSchema, parseJson(row.github_request_json))
    const githubReceipt = row.github_receipt_json === null
      ? null
      : safeParseValue(NextSourceGitHubExportReceiptSchema, parseJson(row.github_receipt_json))
    if (githubRequest !== null && !githubRequest.ok) throw new Error('Stored GitHub export request is invalid.')
    if (githubReceipt !== null && !githubReceipt.ok) throw new Error('Stored GitHub export receipt is invalid.')
    const candidate = {
      exportId: row.export_id,
      releaseId: row.release_id,
      sourceRevisionId: row.revision_id,
      sourceSnapshotId: row.source_snapshot_id,
      sourceSnapshotHashSha256: row.source_snapshot_hash_sha256,
      documentHashSha256: row.document_hash_sha256,
      objectKey: row.object_key,
      objectHashSha256: row.object_hash_sha256,
      objectSizeBytes: positive(row.object_size_bytes),
      manifest: manifest.value,
      state: row.state,
      version: positive(row.version),
      githubOperationId: row.github_operation_id,
      githubRequest: githubRequest?.value ?? null,
      githubReceipt: githubReceipt?.value ?? null,
      createdAt: iso(row.created_at),
      exportedAt: row.exported_at === null ? null : iso(row.exported_at),
    }
    const parsed = safeParseValue(NextSourceReleaseExportRecordSchema, candidate)
    if (!parsed.ok) throw new Error('Stored release export record is invalid.')
    return parsed.value
  }
}
