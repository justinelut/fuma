import { Type, Value, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import {
  ComponentPackReleaseSchema,
  DeclarativeComponentSchema,
  GeneratedClientDraftSchema,
  GeneratedClientValidationSchema,
  OwnerArtifactConfirmationSchema,
  PermissionDisclosureSchema,
} from '../../../../../tooling/component-packs/contracts'

const Strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' })
const Coordinate = Type.String({ minLength: 7, maxLength: 320, pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)+/[a-z0-9][a-z0-9-]*@[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' })
const Timestamp = Type.String({ format: 'date-time' })
const Hash = Type.String({ pattern: '^[a-f0-9]{64}$' })
const Positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

export const ComponentCatalogScopeSchema = Type.Object({
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  ownerGeneration: Positive,
  profileId: Type.Union([Type.Literal('website'), Type.Literal('publication')]),
}, Strict)
export type ComponentCatalogScope = Readonly<Static<typeof ComponentCatalogScopeSchema>>

export const ComponentCatalogReleaseSchema = Type.Object({
  scope: ComponentCatalogScopeSchema,
  coordinate: Coordinate,
  previousCoordinate: Type.Union([Coordinate, Type.Null()]),
  release: ComponentPackReleaseSchema,
  origin: Type.Union([Type.Literal('private'), Type.Literal('restricted-client')]),
  state: Type.Union([Type.Literal('active'), Type.Literal('superseded')]),
  actorId: Id,
  createdAt: Timestamp,
}, Strict)
export type ComponentCatalogRelease = Readonly<Static<typeof ComponentCatalogReleaseSchema>>

export const ComponentSourceDraftRecordSchema = Type.Object({
  scope: ComponentCatalogScopeSchema,
  actorId: Id,
  draft: GeneratedClientDraftSchema,
  validation: GeneratedClientValidationSchema,
  disclosure: PermissionDisclosureSchema,
  sourceAuditHashSha256: Hash,
  state: Type.Union([Type.Literal('validated'), Type.Literal('confirmed')]),
  createdAt: Timestamp,
  confirmedAt: Type.Union([Timestamp, Type.Null()]),
}, Strict)
export type ComponentSourceDraftRecord = Readonly<Static<typeof ComponentSourceDraftRecordSchema>>

export const ComponentInstallationSchema = Type.Object({
  scope: ComponentCatalogScopeSchema,
  installationId: Id,
  packageKey: Type.String({ minLength: 5, maxLength: 260, pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)+/[a-z0-9][a-z0-9-]*$' }),
  coordinate: Coordinate,
  integritySha256: Hash,
  source: Type.Union([Type.Literal('private'), Type.Literal('reviewed')]),
  artifactInstallationId: Type.Union([Id, Type.Null()]),
  artifactId: Type.Union([Id, Type.Null()]),
  reviewSubmissionId: Type.Union([Id, Type.Null()]),
  rollbackCoordinates: Type.Array(Coordinate, { maxItems: 100, uniqueItems: true }),
  version: Positive,
  installedAt: Timestamp,
  updatedAt: Timestamp,
}, Strict)
export type ComponentInstallation = Readonly<Static<typeof ComponentInstallationSchema>>

export const ComponentUsageKindSchema = Type.Union([
  Type.Literal('page-node'),
  Type.Literal('visual-component'),
  Type.Literal('template'),
  Type.Literal('retained-release'),
])
export const ComponentUsageSchema = Type.Object({
  scope: ComponentCatalogScopeSchema,
  usageId: Id,
  coordinate: Coordinate,
  kind: ComponentUsageKindSchema,
  resourceId: Id,
  nodeId: Type.Union([Id, Type.Null()]),
  variantId: Type.Union([Id, Type.Null()]),
  props: Type.Record(Type.String({ maxLength: 128 }), Type.Unknown()),
  createdAt: Timestamp,
}, Strict)
export type ComponentUsage = Readonly<Static<typeof ComponentUsageSchema>>

export const ComponentUpgradeReceiptSchema = Type.Object({
  scope: ComponentCatalogScopeSchema,
  receiptId: Id,
  installationId: Id,
  fromCoordinate: Coordinate,
  toCoordinate: Coordinate,
  diffHashSha256: Hash,
  rollbackCoordinate: Coordinate,
  affectedUsageIds: Type.Array(Id, { maxItems: 100_000, uniqueItems: true }),
  ownerConfirmed: Type.Boolean(),
  actorId: Id,
  createdAt: Timestamp,
}, Strict)
export type ComponentUpgradeReceipt = Readonly<Static<typeof ComponentUpgradeReceiptSchema>>

export const ComponentCatalogAuditActionSchema = Type.Union([
  Type.Literal('component.private.created'), Type.Literal('component.private.versioned'),
  Type.Literal('component.source.validated'), Type.Literal('component.source.confirmed'),
  Type.Literal('component.installed'), Type.Literal('component.inserted'),
  Type.Literal('component.upgraded'), Type.Literal('component.uninstalled'),
  Type.Literal('component.publish.checked'),
])
export const ComponentCatalogAuditFactSchema = Type.Object({
  auditId: Id,
  scope: ComponentCatalogScopeSchema,
  actorId: Id,
  action: ComponentCatalogAuditActionSchema,
  coordinate: Type.Union([Coordinate, Type.Null()]),
  operationId: Id,
  outcome: Type.Union([Type.Literal('success'), Type.Literal('denied'), Type.Literal('failure')]),
  reasonCode: Type.Union([Id, Type.Null()]),
  occurredAt: Timestamp,
}, Strict)
export type ComponentCatalogAuditFact = Readonly<Static<typeof ComponentCatalogAuditFactSchema>>

export const CreateDeclarativeComponentCommandSchema = Type.Object({
  release: ComponentPackReleaseSchema,
  previousCoordinate: Type.Union([Coordinate, Type.Null()]),
}, Strict)
export const CreateComponentVariantCommandSchema = Type.Object({
  coordinate: Coordinate,
  targetVersion: Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' }),
  componentId: Id,
  variant: DeclarativeComponentSchema.properties.variants.items,
}, Strict)
export const ValidateComponentSourceCommandSchema = Type.Object({ draft: GeneratedClientDraftSchema }, Strict)
export const ConfirmComponentSourceCommandSchema = Type.Object({
  draftId: Id,
  confirmation: OwnerArtifactConfirmationSchema,
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
}, Strict)
export const SearchComponentsCommandSchema = Type.Object({
  query: Type.String({ maxLength: 160 }),
  source: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('starter'), Type.Literal('private'), Type.Literal('installed'), Type.Literal('reviewed')])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}, Strict)
export const GetComponentCommandSchema = Type.Object({ coordinate: Coordinate }, Strict)
export const InstallComponentCommandSchema = Type.Object({
  submissionId: Id,
  artifactId: Id,
  installationId: Id,
  grantedPermissions: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 128, uniqueItems: true }),
}, Strict)
export const InsertComponentCommandSchema = Type.Object({
  coordinate: Coordinate,
  componentId: Id,
  usageId: Id,
  kind: Type.Union([Type.Literal('page-node'), Type.Literal('visual-component'), Type.Literal('template')]),
  resourceId: Id,
  parentNodeId: Id,
  variantId: Type.Union([Id, Type.Null()]),
  props: Type.Record(Type.String({ maxLength: 128 }), Type.Unknown()),
}, Strict)
export const UpgradeComponentCommandSchema = Type.Object({
  installationId: Id,
  submissionId: Id,
  artifactId: Id,
  targetInstallationId: Id,
  grantedPermissions: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 128, uniqueItems: true }),
  ownerConfirmed: Type.Boolean(),
}, Strict)
export const ListComponentUsageCommandSchema = Type.Object({ coordinate: Coordinate }, Strict)
export const UninstallComponentCommandSchema = Type.Object({ installationId: Id }, Strict)
export const PreviewComponentCommandSchema = Type.Object({ coordinate: Coordinate, componentId: Id, variantId: Type.Union([Id, Type.Null()]) }, Strict)
export const ComponentPublishCheckCommandSchema = Type.Object({}, Strict)

export const ComponentCatalogItemSchema = Type.Object({
  coordinate: Coordinate,
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  description: Type.String({ maxLength: 2_000 }),
  source: Type.Union([Type.Literal('starter'), Type.Literal('private'), Type.Literal('restricted-client'), Type.Literal('reviewed')]),
  trustTier: Type.String({ minLength: 1, maxLength: 64 }),
  componentIds: Type.Array(Id, { minItems: 1, maxItems: 1_000, uniqueItems: true }),
  permissions: Type.Array(Type.String({ maxLength: 160 }), { maxItems: 128, uniqueItems: true }),
  installed: Type.Boolean(),
  exactVersion: Type.String({ minLength: 5, maxLength: 64 }),
  integritySha256: Hash,
}, Strict)
export type ComponentCatalogItem = Readonly<Static<typeof ComponentCatalogItemSchema>>

export type ComponentCatalogAction =
  | 'create' | 'edit' | 'variant' | 'preview' | 'validate-source' | 'confirm-source'
  | 'search' | 'get' | 'install' | 'insert' | 'upgrade' | 'usage' | 'uninstall' | 'publish-check'

export class ComponentCatalogError extends Error {
  override readonly name = 'ComponentCatalogError'
  readonly code: 'invalid-contract' | 'scope' | 'not-found' | 'conflict' | 'validation' | 'confirmation' | 'review' | 'usage' | 'revoked'
  constructor(code: ComponentCatalogError['code'], message: string) { super(message); this.code = code }
}

export function parseComponentCatalog<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) {
    const issue = Value.Errors(schema, value).First()
    throw new ComponentCatalogError('invalid-contract', `${label} failed strict TypeBox validation${issue ? ` at ${issue.path || '/'}: ${issue.message}` : ''}.`)
  }
  return structuredClone(parsed.value)
}

export function sameComponentScope(left: ComponentCatalogScope, right: ComponentCatalogScope): boolean {
  return left.platformId === right.platformId && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId && left.siteId === right.siteId
    && left.ownerKey === right.ownerKey && left.ownerGeneration === right.ownerGeneration
    && left.profileId === right.profileId
}
