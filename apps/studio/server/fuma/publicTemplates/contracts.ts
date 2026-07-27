import {
  PublicIdSchema,
  PublicTemplateAccessibilitySchema,
  PublicTemplateImageSchema,
  PublicTemplateSchema,
  PublicTemplateTombstoneSchema,
  type PublicTemplate,
  type PublicTemplateTombstone,
} from '@fuma/public-contracts'
import { Type, Value, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const TimestampSchema = PublicTemplateSchema.properties.approvedAt
const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' })
const LogicalPathSchema = Type.String({ minLength: 2, maxLength: 2_048, pattern: '^/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$' })
const RequiredTagsSchema = Type.Array(Type.String({ minLength: 1, maxLength: 48, pattern: '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$' }), { minItems: 1, maxItems: 24, uniqueItems: true })

export const TemplateApprovalMetadataSchema = Type.Object({
  id: PublicTemplateSchema.properties.id,
  slug: PublicTemplateSchema.properties.slug,
  name: PublicTemplateSchema.properties.name,
  summary: PublicTemplateSchema.properties.summary,
  profiles: PublicTemplateSchema.properties.profiles,
  capabilities: RequiredTagsSchema,
  industries: RequiredTagsSchema,
  styles: RequiredTagsSchema,
  accessibility: PublicTemplateAccessibilitySchema,
  image: Type.Object({
    url: PublicTemplateImageSchema.properties.url,
    alt: PublicTemplateImageSchema.properties.alt,
    width: PublicTemplateImageSchema.properties.width,
    height: PublicTemplateImageSchema.properties.height,
    byteSize: PublicTemplateImageSchema.properties.byteSize,
    logicalPath: LogicalPathSchema,
  }, { additionalProperties: false }),
}, { additionalProperties: false })
export type TemplateApprovalMetadata = Static<typeof TemplateApprovalMetadataSchema>


export const TemplateReleaseAuthoritySchema = Type.Object({
  platformId: PublicIdSchema,
  ownerKey: PublicIdSchema,
  organizationId: PublicIdSchema,
  workspaceId: PublicIdSchema,
  siteId: PublicIdSchema,
  releaseId: PublicIdSchema,
}, { additionalProperties: false })
export type TemplateReleaseAuthority = Static<typeof TemplateReleaseAuthoritySchema>
export const TemplateReleaseArtifactSchema = Type.Object({
  logicalPath: LogicalPathSchema,
  contentHashSha256: HashSchema,
  sizeBytes: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  mimeType: Type.String({ minLength: 3, maxLength: 255 }),
}, { additionalProperties: false })
export type TemplateReleaseArtifact = Static<typeof TemplateReleaseArtifactSchema>

export const ApprovableTemplateReleaseSchema = Type.Object({
  releaseId: PublicIdSchema,
  manifestHashSha256: HashSchema,
  status: Type.Union([Type.Literal('ready'), Type.Literal('active')]),
  retained: Type.Literal(true),
  artifacts: Type.Array(TemplateReleaseArtifactSchema, { minItems: 1, maxItems: 10_000 }),
}, { additionalProperties: false })
export type ApprovableTemplateRelease = Static<typeof ApprovableTemplateReleaseSchema>

export const ApproveTemplateCommandSchema = Type.Object({
  metadata: TemplateApprovalMetadataSchema,
  releaseAuthority: TemplateReleaseAuthoritySchema,
  expectedManifestHashSha256: HashSchema,
  expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  approvedAt: TimestampSchema,
}, { additionalProperties: false })
export type ApproveTemplateCommand = Static<typeof ApproveTemplateCommandSchema>

export const WithdrawTemplateCommandSchema = Type.Object({
  templateId: PublicIdSchema,
  expectedVersion: Type.Integer({ minimum: 1 }),
  withdrawnAt: TimestampSchema,
}, { additionalProperties: false })
export type WithdrawTemplateCommand = Static<typeof WithdrawTemplateCommandSchema>

export const StoredPublicTemplateReleaseSchema = Type.Object({
  template: PublicTemplateSchema,
  releaseAuthority: TemplateReleaseAuthoritySchema,
  manifestHashSha256: HashSchema,
  state: Type.Union([Type.Literal('approved'), Type.Literal('withdrawn')]),
  version: Type.Integer({ minimum: 1 }),
  withdrawnAt: Type.Union([TimestampSchema, Type.Null()]),
}, { additionalProperties: false })
export type StoredPublicTemplateRelease = Static<typeof StoredPublicTemplateReleaseSchema>

export const TemplateInstallResolutionSchema = Type.Object({
  templateId: PublicIdSchema,
  releaseAuthority: TemplateReleaseAuthoritySchema,
  manifestHashSha256: HashSchema,
  profiles: PublicTemplateSchema.properties.profiles,
  authorityVersion: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
export type TemplateInstallResolution = Static<typeof TemplateInstallResolutionSchema>

export type TemplateCatalogErrorCode = 'invalid-contract' | 'release-unavailable' | 'release-stale' | 'conflict' | 'withdrawn' | 'not-found'
export class TemplateCatalogError extends Error {
  readonly code: TemplateCatalogErrorCode
  constructor(code: TemplateCatalogErrorCode, message: string) {
    super(message)
    this.name = 'TemplateCatalogError'
    this.code = code
  }
}

export function strictTemplateValue<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!Value.Check(schema, value)) {
    const error = Value.Errors(schema, value).First()
    throw new TemplateCatalogError('invalid-contract', `${label} failed validation${error ? ` at ${error.path || '/'}` : ''}.`)
  }
  return structuredClone(value) as Static<T>
}

export function templateTombstone(record: StoredPublicTemplateRelease): PublicTemplateTombstone {
  return strictTemplateValue(PublicTemplateTombstoneSchema, {
    id: record.template.id,
    slug: record.template.slug,
    withdrawnAt: record.withdrawnAt,
  }, 'Template tombstone')
}

export function frozenTemplate(value: unknown): PublicTemplate {
  return Object.freeze(strictTemplateValue(PublicTemplateSchema, value, 'Public template'))
}
