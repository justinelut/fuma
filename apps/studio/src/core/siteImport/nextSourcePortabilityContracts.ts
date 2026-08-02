import { Type, type Static } from '@core/utils/typeboxHelpers'
import { NextSourceAnalysisReportSchema, NextSourceDestinationSchema, NextSourceProvenanceSchema } from './nextSourceContracts'

const ID = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })
const PATH = Type.String({ minLength: 1, maxLength: 4096 })
const SHA256 = Type.String({ pattern: '^[a-f0-9]{64}$' })
const COMMIT = Type.String({ pattern: '^[a-f0-9]{40}$' })
const TIMESTAMP = Type.String({ format: 'date-time' })
const POSITIVE = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

export const NextSourceGitHubSelectionSchema = Type.Object({
  installationId: ID,
  owner: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9-]*$' }),
  repository: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' }),
  branch: Type.String({ minLength: 1, maxLength: 255 }),
  commitSha: COMMIT,
}, { additionalProperties: false })
export type NextSourceGitHubSelection = Static<typeof NextSourceGitHubSelectionSchema>

export const NextSourceIngestReceiptSchema = Type.Object({
  receiptId: ID,
  destination: NextSourceDestinationSchema,
  provenance: NextSourceProvenanceSchema,
  exactCommitSha: Type.Union([COMMIT, Type.Null()]),
  sourceHashSha256: SHA256,
  fileCount: POSITIVE,
  totalBytes: POSITIVE,
  tokenPersisted: Type.Literal(false),
  scriptsExecuted: Type.Literal(false),
  packagesInstalled: Type.Literal(false),
  createdAt: TIMESTAMP,
}, { additionalProperties: false })
export type NextSourceIngestReceipt = Static<typeof NextSourceIngestReceiptSchema>

export const NextSourcePatchSchema = Type.Object({
  path: PATH,
  expectedSha256: SHA256,
  replacement: Type.String({ maxLength: 1_000_000 }),
}, { additionalProperties: false })
export type NextSourcePatch = Static<typeof NextSourcePatchSchema>

export const NextSourceGoogleFontSystemMappingSchema = Type.Object({
  importName: ID,
  localBinding: ID,
  instanceBinding: ID,
  requestedFamily: Type.String({ minLength: 1, maxLength: 255 }),
  sourceVariable: Type.String({ pattern: '^--font-[a-z0-9-]+$', maxLength: 255 }),
  tokenVariable: Type.String({ pattern: '^--font-[a-z0-9-]+$', maxLength: 255 }),
  stylesheetPath: PATH,
  stylesheetSha256: SHA256,
  subsets: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: 16, uniqueItems: true }),
  weights: Type.Array(Type.String({ pattern: '^[1-9]00$' }), { minItems: 1, maxItems: 9, uniqueItems: true }),
  styles: Type.Array(Type.Union([Type.Literal('normal'), Type.Literal('italic')]), { minItems: 1, maxItems: 2, uniqueItems: true }),
  display: Type.Literal('swap'),
  fallbackStack: Type.String({ minLength: 1, maxLength: 1024 }),
}, { additionalProperties: false })
export type NextSourceGoogleFontSystemMapping = Static<typeof NextSourceGoogleFontSystemMappingSchema>

export const NextSourceGoogleFontSystemFixPlanSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  kind: Type.Literal('next-font-google-system-fallback'),
  sourceRevisionId: ID,
  destination: NextSourceDestinationSchema,
  diagnosticId: Type.String({ minLength: 1, maxLength: 8192 }),
  diagnosticIds: Type.Array(Type.String({ minLength: 1, maxLength: 8192 }), { minItems: 1, maxItems: 9, uniqueItems: true }),
  sourcePath: PATH,
  sourcePathSha256: SHA256,
  inputSourceHashSha256: SHA256,
  policyVersion: Type.Literal('fuma-next-16.2.9-react-19.2.5/1'),
  mappings: Type.Array(NextSourceGoogleFontSystemMappingSchema, { minItems: 1, maxItems: 8 }),
  patches: Type.Array(NextSourcePatchSchema, { minItems: 2, maxItems: 9 }),
  styleChange: Type.Literal('review-required-system-fallback'),
  networkAccessed: Type.Literal(false),
  fontDownloaded: Type.Literal(false),
  importedCodeExecuted: Type.Literal(false),
  dependencyChanged: Type.Literal(false),
}, { additionalProperties: false })
export type NextSourceGoogleFontSystemFixPlan = Static<typeof NextSourceGoogleFontSystemFixPlanSchema>

export const NextSourceFixAuthoritySchema = Type.Object({
  kind: Type.Union([Type.Literal('deterministic'), Type.Literal('ai'), Type.Literal('mcp')]),
  actorId: ID,
  operationId: ID,
  sourceRevisionId: ID,
  destination: NextSourceDestinationSchema,
  ownerGeneration: POSITIVE,
  capability: Type.Union([
    Type.Literal('source.read'),
    Type.Literal('source.mutate'),
    Type.Literal('source.confirm'),
  ]),
  meteringReservationId: Type.Union([ID, Type.Null()]),
}, { additionalProperties: false })
export type NextSourceFixAuthority = Static<typeof NextSourceFixAuthoritySchema>

export const NextSourceFixReceiptSchema = Type.Object({
  receiptId: ID,
  diagnosticIds: Type.Array(Type.String({ minLength: 1, maxLength: 8192 }), { minItems: 1, uniqueItems: true, maxItems: 500 }),
  authority: NextSourceFixAuthoritySchema,
  inputSourceHashSha256: SHA256,
  outputSourceHashSha256: SHA256,
  patchHashSha256: SHA256,
  executableChange: Type.Boolean(),
  state: Type.Union([
    Type.Literal('proposed'),
    Type.Literal('owner-confirmed'),
    Type.Literal('applied'),
    Type.Literal('revoked'),
  ]),
  confirmationActorId: Type.Union([ID, Type.Null()]),
  createdAt: TIMESTAMP,
  confirmedAt: Type.Union([TIMESTAMP, Type.Null()]),
}, { additionalProperties: false })
export type NextSourceFixReceipt = Static<typeof NextSourceFixReceiptSchema>

export const NextSourceDraftRevisionSchema = Type.Object({
  revisionId: ID,
  destination: NextSourceDestinationSchema,
  provenance: NextSourceProvenanceSchema,
  parentRevisionId: Type.Union([ID, Type.Null()]),
  sourceHashSha256: SHA256,
  analysis: NextSourceAnalysisReportSchema,
  fixReceiptIds: Type.Array(ID, { uniqueItems: true, maxItems: 2_000 }),
  state: Type.Union([
    Type.Literal('draft'),
    Type.Literal('confirmed'),
    Type.Literal('superseded'),
    Type.Literal('rolled-back'),
  ]),
  createdAt: TIMESTAMP,
}, { additionalProperties: false })
export type NextSourceDraftRevision = Static<typeof NextSourceDraftRevisionSchema>

export const NextSourceRollbackReceiptSchema = Type.Object({
  receiptId: ID,
  destination: NextSourceDestinationSchema,
  fromRevisionId: ID,
  restoredRevisionId: ID,
  restoredSourceHashSha256: SHA256,
  actorId: ID,
  createdAt: TIMESTAMP,
}, { additionalProperties: false })
export type NextSourceRollbackReceipt = Static<typeof NextSourceRollbackReceiptSchema>

export const NextSourceExportAdapterSchema = Type.Union([
  Type.Literal('content'), Type.Literal('members'), Type.Literal('subscriptions'),
  Type.Literal('payments'), Type.Literal('forms'), Type.Literal('newsletters'),
  Type.Literal('podcasts'), Type.Literal('media'),
])
export type NextSourceExportAdapter = Static<typeof NextSourceExportAdapterSchema>

export const NextSourceExportRequestSchema = Type.Object({
  exportId: ID,
  destination: NextSourceDestinationSchema,
  releaseId: ID,
  releaseHashSha256: SHA256,
  sourceSnapshotId: ID,
  sourceSnapshotHashSha256: SHA256,
  documentHashSha256: SHA256,
  siteName: Type.String({ minLength: 1, maxLength: 200 }),
  sourceRevisionId: ID,
  adapters: Type.Array(NextSourceExportAdapterSchema, { uniqueItems: true, maxItems: 8 }),
  routes: Type.Array(Type.Object({
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    title: Type.String({ minLength: 1, maxLength: 500 }),
    kind: Type.Optional(Type.Union([Type.Literal('page'), Type.Literal('raw-html')])),
    source: Type.String({ maxLength: 8_000_000 }),
  }, { additionalProperties: false }), { maxItems: 10_000 }),
  assets: Type.Record(PATH, Type.Union([
    Type.String({ maxLength: 8_000_000 }),
    Type.Object({
      encoding: Type.Literal('base64'),
      content: Type.String({ maxLength: 360_000_000, pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' }),
    }, { additionalProperties: false }),
  ])),
  contentSnapshot: Type.Unknown(),
}, { additionalProperties: false })
export type NextSourceExportRequest = Static<typeof NextSourceExportRequestSchema>

export const NextSourceExportManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  exportId: ID,
  destination: NextSourceDestinationSchema,
  releaseId: ID,
  releaseHashSha256: SHA256,
  sourceSnapshotId: ID,
  sourceSnapshotHashSha256: SHA256,
  documentHashSha256: SHA256,
  sourceRevisionId: ID,
  repositoryHashSha256: SHA256,
  fileHashes: Type.Record(PATH, SHA256),
  adapters: Type.Array(NextSourceExportAdapterSchema, { uniqueItems: true, maxItems: 8 }),
  containsSecrets: Type.Literal(false),
  privateFumaImports: Type.Literal(false),
}, { additionalProperties: false })
export type NextSourceExportManifest = Static<typeof NextSourceExportManifestSchema>

export const NextSourceGitHubExportRequestSchema = Type.Object({
  owner: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9-]*$' }),
  repository: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' }),
  baseBranch: Type.String({ minLength: 1, maxLength: 255 }),
  baseCommitSha: COMMIT,
  branch: Type.String({ minLength: 1, maxLength: 255 }),
  title: Type.String({ minLength: 1, maxLength: 70 }),
  body: Type.String({ maxLength: 10_000 }),
}, { additionalProperties: false })
export type NextSourceGitHubExportRequest = Static<typeof NextSourceGitHubExportRequestSchema>

export const NextSourceGitHubExportReceiptSchema = Type.Object({
  owner: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9-]*$' }),
  repository: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' }),
  branch: Type.String({ minLength: 1, maxLength: 255 }),
  baseCommitSha: COMMIT,
  commitSha: COMMIT,
  pullRequestNumber: POSITIVE,
  pullRequestUrl: Type.String({ pattern: '^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/pull/[1-9][0-9]*$', maxLength: 4096 }),
  defaultBranchWritten: Type.Literal(false),
  repositoryHashSha256: SHA256,
}, { additionalProperties: false })
export type NextSourceGitHubExportReceipt = Static<typeof NextSourceGitHubExportReceiptSchema>
