/**
 * siteImport — public barrel for the Super Import pipeline.
 *
 * Phase 1: cssToStyleRules + associated types.
 * Phase 2: ingestInput, classifyFiles, buildImportPlan (buildPlan.ts),
 *          commitImportPlan (commitPlan.ts),
 *          applyConflictResolutions + all plan/result types.
 *
 * @see docs/features/site-import.md
 */

// ── Phase 1 ──────────────────────────────────────────────────────────────────

export { cssToStyleRules } from './cssToStyleRules'


// ── Phase 2 — input ingestion ─────────────────────────────────────────────────

export { ingestInput } from './ingestInput'


// ── Phase 2 — file classification ────────────────────────────────────────────

export { classifyFiles } from './classifyFiles'

// ── Phase 2 — HTML page planning ──────────────────────────────────────────────

export { makeHtmlPagePlan, deriveSlug, prettifyTitle, resolveHref } from './htmlPagePlan'


// ── Phase 2 — asset collection + URL normalisation ───────────────────────────

export { buildAssetPlan } from './assetPlan'
export type { CssFileResult } from './assetPlan'

// ── Phase 2 — cross-stylesheet class semantics ───────────────────────────────

// ── Phase 2 — internal link rewriting (→ dynamic page refs) ──────────────────

export { rewriteInternalLinks } from './linkRewrite'

// ── Phase 2 — URL rewriting ───────────────────────────────────────────────────

export { applyAssetRewrites } from './applyAssetRewrites'

// ── Phase 2 — colour-token extraction ─────────────────────────────────────────

export { extractRootColorTokens, isCssColorValue } from './colorTokens'

// ── Phase 2 — font-token extraction ───────────────────────────────────────────

// ── Phase 2 — conflict detection + resolution ─────────────────────────────────

export { detectConflicts, applyConflictResolutions } from './conflicts'


// ── Phase 2 — adapter interfaces ─────────────────────────────────────────────

export type { SiteImportAdapter, SiteImportTransaction } from './adapter'

// ── Phase 2 — top-level orchestration ────────────────────────────────────────

export { buildImportPlan } from './buildPlan'
export { commitImportPlan } from './commitPlan'

// ── FUMA-077 — non-executing Next.js source analysis ─────────────────────────

export { analyzeNextSource } from './analyzeNextSource'
export {
  NEXT_SOURCE_INSTALLED_VERSIONS,
  NEXT_SOURCE_POLICY_VERSION,
  classifyNextSourceImport,
} from './nextSourcePolicy'
export {
  NextSourceAnalysisReportSchema,
  NextSourceAnalysisRequestSchema,
  NextSourceAssetEvidenceSchema,
  NextSourceConfigurationEvidenceSchema,
  NextSourceDependencyEvidenceSchema,
  NextSourceDestinationSchema,
  NextSourceDiagnosticCategorySchema,
  NextSourceDiagnosticSchema,
  NextSourceFileEvidenceSchema,
  NextSourceImportSchema,
  NextSourceInteractionAuthoritySchema,
  NextSourceInteractionBindingSchema,
  NextSourceInteractionEvidenceSchema,
  NextSourceInteractionKindSchema,
  NextSourceModuleSchema,
  NextSourcePackageEvidenceSchema,
  NextSourceProvenanceSchema,
  NextSourceRouteSchema,
  NextSourceSpanSchema,
  NextSourceStyleEvidenceSchema,
} from './nextSourceContracts'
export {
  isNextSourceInteractionAuthorityAvailable,
  isReviewedNextSourceInteractionBinding,
  nextSourceAuthoritiesForInteraction,
} from './nextSourceInteractionBindings'
export type {
  NextSourceAnalysisReport,
  NextSourceAnalysisRequest,
  NextSourceAssetEvidence,
  NextSourceConfigurationEvidence,
  NextSourceDependencyEvidence,
  NextSourceDestination,
  NextSourceDiagnostic,
  NextSourceDiagnosticCategory,
  NextSourceFileEvidence,
  NextSourceImport,
  NextSourceInteractionAuthority,
  NextSourceInteractionBinding,
  NextSourceInteractionEvidence,
  NextSourceInteractionKind,
  NextSourceModule,
  NextSourcePackageEvidence,
  NextSourceProvenance,
  NextSourceRoute,
  NextSourceSpan,
  NextSourceStyleEvidence,
} from './nextSourceContracts'

// ── FUMA-077 — portability workflow ─────────────────────────────────────────

export {
  GitHubAppNextSourceIngestor,
  ingestLocalNextSource,
  normalizeNextSourceFolderRoot,
} from './nextSourceIngestion'
export type {
  NextSourceGitHubAppTokenPort,
  NextSourceGitHubTokenRequest,
  NextSourceGitHubFetchPort,
  NextSourceIngestResult,
  NextSourceLocalInput,
  NextSourceTokenLease,
} from './nextSourceIngestion'
export {
  buildNextSourceGoogleFontSystemFix,
} from './nextSourceFontAdaptation'
export {
  MemoryNextSourceDraftRepository,
  NextSourceAdaptationService,
  nextSourceCanPublish,
} from './nextSourceAdaptation'
export type {
  NextSourceAdaptationAuthorityPort,
  NextSourceDraftRepository,
  NextSourceOwnerConfirmationPort,
} from './nextSourceAdaptation'
export {
  buildNextSourceExport,
  exportNextSourceToGitHub,
} from './nextSourceExport'
export type {
  NextSourceExportArtifact,
  NextSourceGitHubExportPort,
} from './nextSourceExport'
export {
  NextSourceDraftRevisionSchema,
  NextSourceExportAdapterSchema,
  NextSourceExportManifestSchema,
  NextSourceExportRequestSchema,
  NextSourceFixAuthoritySchema,
  NextSourceFixReceiptSchema,
  NextSourceGoogleFontSystemFixPlanSchema,
  NextSourceGoogleFontSystemMappingSchema,
  NextSourceGitHubExportReceiptSchema,
  NextSourceGitHubExportRequestSchema,
  NextSourceGitHubSelectionSchema,
  NextSourceIngestReceiptSchema,
  NextSourcePatchSchema,
  NextSourceRollbackReceiptSchema,
} from './nextSourcePortabilityContracts'
export type {
  NextSourceDraftRevision,
  NextSourceExportAdapter,
  NextSourceExportManifest,
  NextSourceExportRequest,
  NextSourceFixAuthority,
  NextSourceFixReceipt,
  NextSourceGoogleFontSystemFixPlan,
  NextSourceGoogleFontSystemMapping,
  NextSourceGitHubExportReceipt,
  NextSourceGitHubExportRequest,
  NextSourceGitHubSelection,
  NextSourceIngestReceipt,
  NextSourcePatch,
  NextSourceRollbackReceipt,
} from './nextSourcePortabilityContracts'

// ── Shared types ──────────────────────────────────────────────────────────────

export type {
  // Phase 1
  NewStyleRule,
  // Phase 2
  FileMap,
  FileRole,
  PagePlan,
  ConflictResolution,
  PageConflict,
  RuleConflict,
  TokenConflict,
  CrossSheetClassConflict,
  ImportPlan,
  ImportResult,
  StylesheetImportMode,
  ImportStylesheet,
  // @font-face import
  ImportFontFamily,
  // colour tokens + scripts
  ImportColorToken,
  ImportFontToken,
  ImportScriptDependency,
  ImportScript,
} from './types'

// ── Error classes (callers need instanceof checks) ────────────────────────────

export {
  EmptyImportError,
  OversizeImportError,
  ZipBombError,
  TooManyFilesError,
  PathTraversalError,
} from './types'
