import { Type, type Static } from '@core/utils/typeboxHelpers'

const ID = Type.String({ minLength: 1, maxLength: 255 })
const PATH = Type.String({ minLength: 1, maxLength: 4096 })
const SHA256 = Type.String({ pattern: '^[a-f0-9]{64}$' })

export const NextSourceDestinationSchema = Type.Object({
  organizationId: ID,
  workspaceId: ID,
  siteId: ID,
}, { additionalProperties: false })
export type NextSourceDestination = Static<typeof NextSourceDestinationSchema>

export const NextSourceProvenanceSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('zip'),
    Type.Literal('folder'),
    Type.Literal('github'),
    Type.Literal('file-map'),
  ]),
  locator: Type.String({ minLength: 1, maxLength: 4096 }),
  revision: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
}, { additionalProperties: false })
export type NextSourceProvenance = Static<typeof NextSourceProvenanceSchema>

export const NextSourceInteractionKindSchema = Type.Union([
  Type.Literal('content'), Type.Literal('member'), Type.Literal('subscription'),
  Type.Literal('form'), Type.Literal('podcast'),
])
export type NextSourceInteractionKind = Static<typeof NextSourceInteractionKindSchema>

export const NextSourceInteractionAuthoritySchema = Type.Union([
  Type.Literal('website.data'),
  Type.Literal('publication.content'),
  Type.Literal('publication.member-access'),
  Type.Literal('publication.membership-payments'),
  Type.Literal('core.public-form'),
])
export type NextSourceInteractionAuthority = Static<typeof NextSourceInteractionAuthoritySchema>

const NextSourceInteractionBindingIdSchema = Type.String({ minLength: 1, maxLength: 8192 })
export const NextSourceInteractionBindingSchema = Type.Union([
  Type.Object({
    interactionId: NextSourceInteractionBindingIdSchema,
    kind: Type.Literal('content'),
    authority: Type.Union([Type.Literal('website.data'), Type.Literal('publication.content')]),
  }, { additionalProperties: false }),
  Type.Object({
    interactionId: NextSourceInteractionBindingIdSchema,
    kind: Type.Literal('member'),
    authority: Type.Literal('publication.member-access'),
  }, { additionalProperties: false }),
  Type.Object({
    interactionId: NextSourceInteractionBindingIdSchema,
    kind: Type.Literal('subscription'),
    authority: Type.Literal('publication.membership-payments'),
  }, { additionalProperties: false }),
  Type.Object({
    interactionId: NextSourceInteractionBindingIdSchema,
    kind: Type.Literal('form'),
    authority: Type.Literal('core.public-form'),
  }, { additionalProperties: false }),
])
export type NextSourceInteractionBinding = Static<typeof NextSourceInteractionBindingSchema>

export const NextSourceAnalysisRequestSchema = Type.Object({
  destination: NextSourceDestinationSchema,
  provenance: NextSourceProvenanceSchema,
  interactionBindings: Type.Optional(Type.Array(NextSourceInteractionBindingSchema, { maxItems: 2_000 })),
}, { additionalProperties: false })
export type NextSourceAnalysisRequest = Static<typeof NextSourceAnalysisRequestSchema>

export const NextSourceDiagnosticCategorySchema = Type.Union([
  Type.Literal('unsupported-dependency'),
  Type.Literal('unsupported-next-api'),
  Type.Literal('server-authority-required'),
  Type.Literal('dynamic-import-denied'),
  Type.Literal('dynamic-tailwind-denied'),
  Type.Literal('secret-or-environment-access'),
  Type.Literal('provider-sdk-denied'),
  Type.Literal('unbound-content-interaction'),
  Type.Literal('unbound-member-interaction'),
  Type.Literal('unbound-subscription-interaction'),
  Type.Literal('unbound-form-interaction'),
  Type.Literal('unbound-podcast-interaction'),
  Type.Literal('invalid-manifest'),
  Type.Literal('unresolved-local-import'),
  Type.Literal('route-conflict'),
])
export type NextSourceDiagnosticCategory = Static<typeof NextSourceDiagnosticCategorySchema>

export const NextSourceSpanSchema = Type.Object({
  start: Type.Integer({ minimum: 0 }),
  end: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false })
export type NextSourceSpan = Static<typeof NextSourceSpanSchema>

export const NextSourceDiagnosticSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 8192 }),
  category: NextSourceDiagnosticCategorySchema,
  severity: Type.Union([Type.Literal('blocking'), Type.Literal('warning')]),
  path: PATH,
  line: Type.Optional(Type.Integer({ minimum: 1 })),
  span: Type.Optional(NextSourceSpanSchema),
  specifier: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  message: Type.String({ minLength: 1, maxLength: 8192 }),
  deterministicFix: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  policyVersion: Type.Literal('fuma-next-16.2.9-react-19.2.5/1'),
  sourceHashSha256: SHA256,
  bindingHashSha256: SHA256,
  destination: NextSourceDestinationSchema,
  sourceRevision: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
}, { additionalProperties: false })
export type NextSourceDiagnostic = Static<typeof NextSourceDiagnosticSchema>

export const NextSourceImportSchema = Type.Object({
  specifier: Type.String({ minLength: 1, maxLength: 4096 }),
  kind: Type.Union([
    Type.Literal('static'),
    Type.Literal('dynamic'),
    Type.Literal('reexport'),
    Type.Literal('type-static'),
    Type.Literal('type-reexport'),
    Type.Literal('require'),
  ]),
  policy: Type.Union([
    Type.Literal('local'),
    Type.Literal('supported'),
    Type.Literal('remappable'),
    Type.Literal('blocked'),
  ]),
  packageName: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  installedVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  resolvedPath: Type.Optional(PATH),
  line: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
export type NextSourceImport = Static<typeof NextSourceImportSchema>

export const NextSourceModuleSchema = Type.Object({
  path: PATH,
  sizeBytes: Type.Integer({ minimum: 0 }),
  sha256: SHA256,
  imports: Type.Array(NextSourceImportSchema),
}, { additionalProperties: false })
export type NextSourceModule = Static<typeof NextSourceModuleSchema>

export const NextSourceRouteSchema = Type.Object({
  router: Type.Union([Type.Literal('app'), Type.Literal('pages')]),
  kind: Type.Union([
    Type.Literal('page'),
    Type.Literal('route-handler'),
    Type.Literal('metadata'),
    Type.Literal('system'),
  ]),
  route: Type.String({ minLength: 1, maxLength: 4096 }),
  sourcePath: PATH,
}, { additionalProperties: false })
export type NextSourceRoute = Static<typeof NextSourceRouteSchema>

export const NextSourceDependencyEvidenceSchema = Type.Object({
  section: Type.Union([
    Type.Literal('dependencies'),
    Type.Literal('optionalDependencies'),
    Type.Literal('peerDependencies'),
    Type.Literal('devDependencies'),
  ]),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  requestedVersion: Type.String({ minLength: 1, maxLength: 1024 }),
  policy: Type.Union([
    Type.Literal('supported'),
    Type.Literal('remappable'),
    Type.Literal('blocked'),
    Type.Literal('evidence-only'),
  ]),
  installedVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
}, { additionalProperties: false })
export type NextSourceDependencyEvidence = Static<typeof NextSourceDependencyEvidenceSchema>

export const NextSourcePackageEvidenceSchema = Type.Object({
  present: Type.Boolean(),
  path: Type.Optional(PATH),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  packageManager: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  dependencies: Type.Array(NextSourceDependencyEvidenceSchema),
  scriptNames: Type.Array(Type.String({ minLength: 1, maxLength: 255 })),
  lockfiles: Type.Array(PATH),
  scriptsExecuted: Type.Literal(false),
  packagesInstalled: Type.Literal(false),
}, { additionalProperties: false })
export type NextSourcePackageEvidence = Static<typeof NextSourcePackageEvidenceSchema>

export const NextSourceFileEvidenceSchema = Type.Object({
  path: PATH,
  sizeBytes: Type.Integer({ minimum: 0 }),
  sha256: SHA256,
}, { additionalProperties: false })
export type NextSourceFileEvidence = Static<typeof NextSourceFileEvidenceSchema>

export const NextSourceStyleEvidenceSchema = Type.Object({
  path: PATH,
  kind: Type.Union([Type.Literal('css'), Type.Literal('tailwind')]),
  staticClassNames: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { uniqueItems: true }),
  customProperties: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { uniqueItems: true }),
}, { additionalProperties: false })
export type NextSourceStyleEvidence = Static<typeof NextSourceStyleEvidenceSchema>

export const NextSourceAssetEvidenceSchema = Type.Object({
  path: PATH,
  kind: Type.Union([Type.Literal('image'), Type.Literal('font'), Type.Literal('audio'), Type.Literal('video'), Type.Literal('other')]),
  sizeBytes: Type.Integer({ minimum: 0 }),
  sha256: SHA256,
}, { additionalProperties: false })
export type NextSourceAssetEvidence = Static<typeof NextSourceAssetEvidenceSchema>

export const NextSourceInteractionEvidenceSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 8192 }),
  kind: NextSourceInteractionKindSchema,
  path: PATH,
  line: Type.Integer({ minimum: 1 }),
  boundAuthority: Type.Union([NextSourceInteractionAuthoritySchema, Type.Null()]),
}, { additionalProperties: false })
export type NextSourceInteractionEvidence = Static<typeof NextSourceInteractionEvidenceSchema>

export const NextSourceConfigurationEvidenceSchema = Type.Object({
  nextConfigPaths: Type.Array(PATH, { uniqueItems: true }),
  middlewarePaths: Type.Array(PATH, { uniqueItems: true }),
  tailwindConfigPaths: Type.Array(PATH, { uniqueItems: true }),
  configurationExecuted: Type.Literal(false),
}, { additionalProperties: false })
export type NextSourceConfigurationEvidence = Static<typeof NextSourceConfigurationEvidenceSchema>

export const NextSourceAnalysisReportSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  analyzerVersion: Type.Literal('fuma-next-source-analyzer/1'),
  policyVersion: Type.Literal('fuma-next-16.2.9-react-19.2.5/1'),
  destination: NextSourceDestinationSchema,
  provenance: NextSourceProvenanceSchema,
  sourceHashSha256: SHA256,
  bindingHashSha256: SHA256,
  router: Type.Union([
    Type.Literal('app'),
    Type.Literal('pages'),
    Type.Literal('mixed'),
    Type.Literal('none'),
  ]),
  files: Type.Array(NextSourceFileEvidenceSchema),
  routes: Type.Array(NextSourceRouteSchema),
  modules: Type.Array(NextSourceModuleSchema),
  packageEvidence: NextSourcePackageEvidenceSchema,
  configurationEvidence: NextSourceConfigurationEvidenceSchema,
  styles: Type.Array(NextSourceStyleEvidenceSchema),
  assets: Type.Array(NextSourceAssetEvidenceSchema),
  interactions: Type.Array(NextSourceInteractionEvidenceSchema),
  diagnostics: Type.Array(NextSourceDiagnosticSchema),
  importedCodeExecuted: Type.Literal(false),
  blocking: Type.Boolean(),
}, { additionalProperties: false })
export type NextSourceAnalysisReport = Static<typeof NextSourceAnalysisReportSchema>
