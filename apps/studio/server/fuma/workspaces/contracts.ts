import { Type, type Static } from '@core/utils/typeboxHelpers'

const ID_OPTIONS = { minLength: 1, maxLength: 255 } as const
const TIMESTAMP_OPTIONS = {
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$',
} as const

export const WorkspaceIdSchema = Type.String(ID_OPTIONS)
export type WorkspaceId = Static<typeof WorkspaceIdSchema>

export const WorkspaceOrganizationIdSchema = Type.String(ID_OPTIONS)
export type WorkspaceOrganizationId = Static<typeof WorkspaceOrganizationIdSchema>

export const WorkspaceUserIdSchema = Type.String(ID_OPTIONS)
export type WorkspaceUserId = Static<typeof WorkspaceUserIdSchema>

export const WorkspaceSlugSchema = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
})
export type WorkspaceSlug = Static<typeof WorkspaceSlugSchema>

export const WorkspaceStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('archived'),
])
export type WorkspaceStatus = Static<typeof WorkspaceStatusSchema>

export const WorkspaceMembershipAccessSchema = Type.Union([
  Type.Literal('inherit'),
  Type.Literal('grant'),
  Type.Literal('deny'),
])
export type WorkspaceMembershipAccess = Static<typeof WorkspaceMembershipAccessSchema>

export const WorkspaceRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('editor'),
  Type.Literal('viewer'),
])
export type WorkspaceRole = Static<typeof WorkspaceRoleSchema>

export const WorkspaceCreateInputSchema = Type.Object({
  id: WorkspaceIdSchema,
  organizationId: WorkspaceOrganizationIdSchema,
  slug: WorkspaceSlugSchema,
  name: Type.String({ minLength: 1, maxLength: 255 }),
  isDefault: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })
export type WorkspaceCreateInput = Static<typeof WorkspaceCreateInputSchema>

const workspaceUpdateBase = {
  organizationId: WorkspaceOrganizationIdSchema,
  workspaceId: WorkspaceIdSchema,
}

export const WorkspaceUpdateInputSchema = Type.Union([
  Type.Object({
    ...workspaceUpdateBase,
    slug: WorkspaceSlugSchema,
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    isDefault: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),
  Type.Object({
    ...workspaceUpdateBase,
    slug: Type.Optional(WorkspaceSlugSchema),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    isDefault: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }),
  Type.Object({
    ...workspaceUpdateBase,
    slug: Type.Optional(WorkspaceSlugSchema),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    isDefault: Type.Boolean(),
  }, { additionalProperties: false }),
])
export type WorkspaceUpdateInput = Static<typeof WorkspaceUpdateInputSchema>

export const WorkspaceArchiveInputSchema = Type.Object({
  organizationId: WorkspaceOrganizationIdSchema,
  workspaceId: WorkspaceIdSchema,
}, { additionalProperties: false })
export type WorkspaceArchiveInput = Static<typeof WorkspaceArchiveInputSchema>

export const WorkspaceRestoreInputSchema = Type.Object({
  organizationId: WorkspaceOrganizationIdSchema,
  workspaceId: WorkspaceIdSchema,
}, { additionalProperties: false })
export type WorkspaceRestoreInput = Static<typeof WorkspaceRestoreInputSchema>

const workspaceMembershipOverrideBase = {
  organizationId: WorkspaceOrganizationIdSchema,
  workspaceId: WorkspaceIdSchema,
  userId: WorkspaceUserIdSchema,
}

export const WorkspaceMembershipOverrideInputSchema = Type.Union([
  Type.Object({
    ...workspaceMembershipOverrideBase,
    access: Type.Literal('inherit'),
    role: Type.Optional(Type.Null()),
  }, { additionalProperties: false }),
  Type.Object({
    ...workspaceMembershipOverrideBase,
    access: Type.Literal('grant'),
    role: WorkspaceRoleSchema,
  }, { additionalProperties: false }),
  Type.Object({
    ...workspaceMembershipOverrideBase,
    access: Type.Literal('deny'),
    role: Type.Optional(Type.Null()),
  }, { additionalProperties: false }),
])
export type WorkspaceMembershipOverrideInput = Static<typeof WorkspaceMembershipOverrideInputSchema>

export const WorkspaceRecordSchema = Type.Object({
  id: WorkspaceIdSchema,
  organizationId: WorkspaceOrganizationIdSchema,
  slug: WorkspaceSlugSchema,
  name: Type.String({ minLength: 1, maxLength: 255 }),
  status: WorkspaceStatusSchema,
  isDefault: Type.Boolean(),
  createdAt: Type.String(TIMESTAMP_OPTIONS),
  updatedAt: Type.String(TIMESTAMP_OPTIONS),
}, { additionalProperties: false })
export type WorkspaceRecord = Static<typeof WorkspaceRecordSchema>

export const WorkspaceMembershipOverrideRecordSchema = Type.Union([
  Type.Object({
    workspaceId: WorkspaceIdSchema,
    userId: WorkspaceUserIdSchema,
    access: Type.Literal('inherit'),
    role: Type.Null(),
    createdAt: Type.String(TIMESTAMP_OPTIONS),
    updatedAt: Type.String(TIMESTAMP_OPTIONS),
  }, { additionalProperties: false }),
  Type.Object({
    workspaceId: WorkspaceIdSchema,
    userId: WorkspaceUserIdSchema,
    access: Type.Literal('grant'),
    role: WorkspaceRoleSchema,
    createdAt: Type.String(TIMESTAMP_OPTIONS),
    updatedAt: Type.String(TIMESTAMP_OPTIONS),
  }, { additionalProperties: false }),
  Type.Object({
    workspaceId: WorkspaceIdSchema,
    userId: WorkspaceUserIdSchema,
    access: Type.Literal('deny'),
    role: Type.Null(),
    createdAt: Type.String(TIMESTAMP_OPTIONS),
    updatedAt: Type.String(TIMESTAMP_OPTIONS),
  }, { additionalProperties: false }),
])
export type WorkspaceMembershipOverrideRecord = Static<
  typeof WorkspaceMembershipOverrideRecordSchema
>

export function normalizeWorkspaceSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
