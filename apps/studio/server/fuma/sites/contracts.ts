import {
  CapabilityOverridesSchema,
  type CapabilityOverrides,
} from '@core/fuma'
import { Type, type Static } from '@core/utils/typeboxHelpers'

const ID_OPTIONS = { minLength: 1, maxLength: 255 } as const
const TIMESTAMP_OPTIONS = {
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
} as const

export const SiteOrganizationIdSchema = Type.String(ID_OPTIONS)
export type SiteOrganizationId = Static<typeof SiteOrganizationIdSchema>

export const SiteWorkspaceIdSchema = Type.String(ID_OPTIONS)
export type SiteWorkspaceId = Static<typeof SiteWorkspaceIdSchema>

export const SiteIdSchema = Type.String(ID_OPTIONS)
export type SiteId = Static<typeof SiteIdSchema>

export const SiteSlugSchema = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
})
export type SiteSlug = Static<typeof SiteSlugSchema>

export const SiteStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('archived'),
])
export type SiteStatus = Static<typeof SiteStatusSchema>

export const SiteProfileIdSchema = Type.String(ID_OPTIONS)
export type SiteProfileId = Static<typeof SiteProfileIdSchema>

export const SiteCapabilityOverridesSchema = CapabilityOverridesSchema
export type SiteCapabilityOverrides = CapabilityOverrides

export const SiteProfileAssignmentSchema = Type.Object({
  profileId: SiteProfileIdSchema,
  capabilityOverrides: SiteCapabilityOverridesSchema,
}, { additionalProperties: false })
export type SiteProfileAssignment = Static<typeof SiteProfileAssignmentSchema>

export const SiteCreateInputSchema = Type.Object({
  id: SiteIdSchema,
  organizationId: SiteOrganizationIdSchema,
  workspaceId: SiteWorkspaceIdSchema,
  slug: SiteSlugSchema,
  name: Type.String({ minLength: 1, maxLength: 255 }),
  profileId: SiteProfileIdSchema,
  capabilityOverrides: SiteCapabilityOverridesSchema,
}, { additionalProperties: false })
export type SiteCreateInput = Static<typeof SiteCreateInputSchema>

const siteMutationScope = {
  organizationId: SiteOrganizationIdSchema,
  workspaceId: SiteWorkspaceIdSchema,
  siteId: SiteIdSchema,
}

export const SiteUpdateInputSchema = Type.Union([
  Type.Object({
    ...siteMutationScope,
    slug: SiteSlugSchema,
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    capabilityOverrides: Type.Optional(SiteCapabilityOverridesSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...siteMutationScope,
    slug: Type.Optional(SiteSlugSchema),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    capabilityOverrides: Type.Optional(SiteCapabilityOverridesSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...siteMutationScope,
    slug: Type.Optional(SiteSlugSchema),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    capabilityOverrides: SiteCapabilityOverridesSchema,
  }, { additionalProperties: false }),
])
export type SiteUpdateInput = Static<typeof SiteUpdateInputSchema>

export const SiteArchiveInputSchema = Type.Object(siteMutationScope, {
  additionalProperties: false,
})
export type SiteArchiveInput = Static<typeof SiteArchiveInputSchema>

export const SiteRestoreInputSchema = Type.Object(siteMutationScope, {
  additionalProperties: false,
})
export type SiteRestoreInput = Static<typeof SiteRestoreInputSchema>

export const SiteRecordSchema = Type.Object({
  id: SiteIdSchema,
  organizationId: SiteOrganizationIdSchema,
  workspaceId: SiteWorkspaceIdSchema,
  slug: SiteSlugSchema,
  name: Type.String({ minLength: 1, maxLength: 255 }),
  status: SiteStatusSchema,
  profileId: SiteProfileIdSchema,
  capabilityOverrides: SiteCapabilityOverridesSchema,
  createdAt: Type.String(TIMESTAMP_OPTIONS),
  updatedAt: Type.String(TIMESTAMP_OPTIONS),
}, { additionalProperties: false })
export type SiteRecord = Static<typeof SiteRecordSchema>

export const SiteProfilePolicyErrorCodeSchema = Type.Union([
  Type.Literal('invalid-slug'),
  Type.Literal('reserved-slug'),
  Type.Literal('immutable-profile-assignment'),
])
export type SiteProfilePolicyErrorCode = Static<typeof SiteProfilePolicyErrorCodeSchema>

export function normalizeSiteSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
