import { Type, type Static } from '@sinclair/typebox'
import {
  CapabilityIdSchema,
  CapabilityOverridesSchema,
  NavigationContributionSchema,
  PermissionDecisionSchema,
  PermissionIdSchema,
} from '@core/fuma'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

const ContributionIdSchema = Type.String({
  minLength: 1,
  pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
})

const AdminPathSchema = Type.String({ pattern: '^/admin(?:/|$)' })

export const EditorAccessSchema = Type.Object({
  visible: Type.Boolean(),
  mutable: Type.Boolean(),
}, { additionalProperties: false })
export type EditorAccess = Contract<Static<typeof EditorAccessSchema>>

export const EditorSurfaceRouteContributionSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('navigation'),
    navigationId: ContributionIdSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('route'),
    path: AdminPathSchema,
  }, { additionalProperties: false }),
])
export type EditorSurfaceRouteContribution = Contract<
  Static<typeof EditorSurfaceRouteContributionSchema>
>

/**
 * A capability-owned editor surface. `surface` is intentionally open so an
 * extension can introduce a new editor area without changing this contract.
 */
export const EditorSurfaceContributionSchema = Type.Object({
  id: ContributionIdSchema,
  surface: ContributionIdSchema,
  capabilityId: CapabilityIdSchema,
  order: Type.Integer({ minimum: 0 }),
  label: Type.String({ minLength: 1 }),
  route: EditorSurfaceRouteContributionSchema,
  viewPermission: PermissionIdSchema,
  writePermission: Type.Optional(PermissionIdSchema),
}, { additionalProperties: false })
export type EditorSurfaceContribution = Contract<
  Static<typeof EditorSurfaceContributionSchema>
>

export const ResolvedEditorSurfaceRouteSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('navigation'),
    navigation: NavigationContributionSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('route'),
    path: AdminPathSchema,
  }, { additionalProperties: false }),
])
export type ResolvedEditorSurfaceRoute = Contract<
  Static<typeof ResolvedEditorSurfaceRouteSchema>
>

export const ResolvedEditorSurfaceSchema = Type.Object({
  id: ContributionIdSchema,
  surface: ContributionIdSchema,
  capabilityId: CapabilityIdSchema,
  order: Type.Integer({ minimum: 0 }),
  label: Type.String({ minLength: 1 }),
  route: ResolvedEditorSurfaceRouteSchema,
  access: EditorAccessSchema,
}, { additionalProperties: false })
export type ResolvedEditorSurface = Contract<Static<typeof ResolvedEditorSurfaceSchema>>

export const ProfileEditorResolutionInputSchema = Type.Object({
  profileId: ContributionIdSchema,
  capabilityOverrides: CapabilityOverridesSchema,
  permissionDecisions: Type.Array(PermissionDecisionSchema),
  contributions: Type.Array(EditorSurfaceContributionSchema),
}, { additionalProperties: false })
export type ProfileEditorResolutionInput = Contract<
  Static<typeof ProfileEditorResolutionInputSchema>
>

export const ProfileEditorSurfaceResolutionSchema = Type.Object({
  surfaces: Type.Array(ResolvedEditorSurfaceSchema),
  visible: Type.Array(ResolvedEditorSurfaceSchema),
  mutable: Type.Array(ResolvedEditorSurfaceSchema),
}, { additionalProperties: false })
export type ProfileEditorSurfaceResolution = Contract<
  Static<typeof ProfileEditorSurfaceResolutionSchema>
>

export const ProfileEditorErrorCodeSchema = Type.Union([
  Type.Literal('duplicate-contribution'),
  Type.Literal('duplicate-permission-decision'),
  Type.Literal('invalid-contribution'),
  Type.Literal('invalid-input'),
  Type.Literal('route-collision'),
])
export type ProfileEditorErrorCode = Static<typeof ProfileEditorErrorCodeSchema>
