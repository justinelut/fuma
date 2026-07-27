import { Type, type Static } from '@core/utils/typeboxHelpers'

export const PLATFORM_ORGANIZATION_ID = 'fuma-platform'
export const PLATFORM_ORGANIZATION_NAME = 'Fuma Platform'
export const PLATFORM_ORGANIZATION_SLUG = 'fuma-platform'
export const PLATFORM_OWNER_MEMBERSHIP_ID = 'fuma-platform-owner'
export const PLATFORM_ORGANIZATION_PROFILE_KIND = 'platform'
export const PLATFORM_ORGANIZATION_PROFILE_STATUS = 'active'
export const PLATFORM_ORGANIZATION_BOOTSTRAP_KEY = 'fuma-platform-launch-v1'
export const PLATFORM_ORGANIZATION_PLACEMENT_CLASS = 'shared'
export const PLATFORM_ORGANIZATION_PLACEMENT_KEY = 'shared:launch'

export const PLATFORM_ORGANIZATION_LAUNCH_LIMITS = Object.freeze({
  maxWorkspaces: 3,
  maxSites: 10,
  maxStaff: 25,
})

export const OrganizationRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member'),
])
export type OrganizationRole = Static<typeof OrganizationRoleSchema>

export const OrganizationPlacementClassSchema = Type.Union([
  Type.Literal('shared'),
  Type.Literal('dedicated'),
])
export type OrganizationPlacementClass = Static<typeof OrganizationPlacementClassSchema>

export const OrganizationBootstrapInputSchema = Type.Object({
  protectedOwnerEmail: Type.String({ minLength: 3, maxLength: 320 }),
}, { additionalProperties: false })
export type OrganizationBootstrapInput = Static<typeof OrganizationBootstrapInputSchema>

export const OrganizationLaunchLimitsSchema = Type.Object({
  maxWorkspaces: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  maxSites: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  maxStaff: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
}, { additionalProperties: false })
export type OrganizationLaunchLimits = Static<typeof OrganizationLaunchLimitsSchema>

export const OrganizationBootstrapResultSchema = Type.Object({
  ownerUserId: Type.String({ minLength: 1 }),
  organizationId: Type.Literal(PLATFORM_ORGANIZATION_ID),
  membershipId: Type.Literal(PLATFORM_OWNER_MEMBERSHIP_ID),
  bootstrapKey: Type.Literal(PLATFORM_ORGANIZATION_BOOTSTRAP_KEY),
  placementClass: Type.Literal(PLATFORM_ORGANIZATION_PLACEMENT_CLASS),
  placementKey: Type.Literal(PLATFORM_ORGANIZATION_PLACEMENT_KEY),
  limits: OrganizationLaunchLimitsSchema,
}, { additionalProperties: false })
export type OrganizationBootstrapResult = Static<typeof OrganizationBootstrapResultSchema>

export const OrganizationBootstrapUserSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  email: Type.String({ minLength: 1 }),
  role: Type.Union([Type.String(), Type.Null()]),
  banned: Type.Union([Type.Boolean(), Type.Null()]),
}, { additionalProperties: false })
export type OrganizationBootstrapUser = Static<typeof OrganizationBootstrapUserSchema>

export const OrganizationRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  slug: Type.String({ minLength: 1 }),
}, { additionalProperties: false })
export type OrganizationRecord = Static<typeof OrganizationRecordSchema>

export const OrganizationMembershipRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  organizationId: Type.String({ minLength: 1 }),
  userId: Type.String({ minLength: 1 }),
  role: OrganizationRoleSchema,
}, { additionalProperties: false })
export type OrganizationMembershipRecord = Static<typeof OrganizationMembershipRecordSchema>

export const OrganizationProfileRecordSchema = Type.Object({
  organizationId: Type.String({ minLength: 1 }),
  kind: Type.String({ minLength: 1 }),
  status: Type.String({ minLength: 1 }),
}, { additionalProperties: false })
export type OrganizationProfileRecord = Static<typeof OrganizationProfileRecordSchema>

export const OrganizationLimitsRecordSchema = Type.Object({
  organizationId: Type.String({ minLength: 1 }),
  maxWorkspaces: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  maxSites: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  maxStaff: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
}, { additionalProperties: false })
export type OrganizationLimitsRecord = Static<typeof OrganizationLimitsRecordSchema>

export const OrganizationPlacementRecordSchema = Type.Object({
  organizationId: Type.String({ minLength: 1 }),
  placementClass: OrganizationPlacementClassSchema,
  placementKey: Type.String({ minLength: 1 }),
}, { additionalProperties: false })
export type OrganizationPlacementRecord = Static<typeof OrganizationPlacementRecordSchema>

export const OrganizationBootstrapReceiptRecordSchema = Type.Object({
  bootstrapKey: Type.String({ minLength: 1 }),
  organizationId: Type.String({ minLength: 1 }),
  ownerUserId: Type.String({ minLength: 1 }),
}, { additionalProperties: false })
export type OrganizationBootstrapReceiptRecord = Static<typeof OrganizationBootstrapReceiptRecordSchema>

export type OrganizationBootstrapErrorCode =
  | 'invalid-input'
  | 'owner-missing'
  | 'owner-ambiguous'
  | 'platform-conflict'

export class OrganizationBootstrapError extends Error {
  readonly code: OrganizationBootstrapErrorCode

  constructor(code: OrganizationBootstrapErrorCode, message: string) {
    super(message)
    this.name = 'OrganizationBootstrapError'
    this.code = code
  }
}
