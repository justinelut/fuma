import { Type, type Static } from '@core/utils/typeboxHelpers'

const ID_OPTIONS = { minLength: 1, maxLength: 255 } as const
const NAME_OPTIONS = { minLength: 1, maxLength: 255 } as const
const ManagedClientIdSchema = Type.String(ID_OPTIONS)
const ManagedClientNameSchema = Type.String(NAME_OPTIONS)

export const ManagedClientCatalogEntrySchema = Type.Object({
  organizationId: ManagedClientIdSchema,
  workspaceId: ManagedClientIdSchema,
  intendedOrganizationId: ManagedClientIdSchema,
  intendedOrganizationName: ManagedClientNameSchema,
}, { additionalProperties: false })
export type ManagedClientCatalogEntry = Static<typeof ManagedClientCatalogEntrySchema>

export const ManagedClientSiteViewSchema = Type.Object({
  selection: Type.Object({
    organizationId: ManagedClientIdSchema,
    workspaceId: ManagedClientIdSchema,
    siteId: ManagedClientIdSchema,
  }, { additionalProperties: false }),
  name: ManagedClientNameSchema,
  status: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
  profileId: ManagedClientIdSchema,
  target: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
}, { additionalProperties: false })
export type ManagedClientSiteView = Static<typeof ManagedClientSiteViewSchema>

export const ManagedClientWorkspaceViewSchema = Type.Object({
  organizationId: ManagedClientIdSchema,
  organizationName: ManagedClientNameSchema,
  workspaceId: ManagedClientIdSchema,
  workspaceName: ManagedClientNameSchema,
  workspaceStatus: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
  intendedOrganizationId: ManagedClientIdSchema,
  intendedOrganizationName: ManagedClientNameSchema,
  sites: Type.Array(ManagedClientSiteViewSchema),
}, { additionalProperties: false })
export type ManagedClientWorkspaceView = Static<typeof ManagedClientWorkspaceViewSchema>

export const ManagedClientsViewSchema = Type.Object({
  entries: Type.Array(ManagedClientWorkspaceViewSchema),
}, { additionalProperties: false })
export type ManagedClientsView = Static<typeof ManagedClientsViewSchema>
