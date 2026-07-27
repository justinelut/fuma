import { Type, type Static } from '@sinclair/typebox'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

const RegistryIdSchema = Type.String({
  minLength: 1,
  pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
})

const OrderedContributionSchema = {
  id: RegistryIdSchema,
  order: Type.Integer({ minimum: 0 }),
}

export const CapabilityIdSchema = RegistryIdSchema
export type CapabilityId = Contract<Static<typeof CapabilityIdSchema>>

export const PermissionIdSchema = RegistryIdSchema
export type PermissionId = Static<typeof PermissionIdSchema>

export const NavigationContributionSchema = Type.Object({
  ...OrderedContributionSchema,
  label: Type.String({ minLength: 1 }),
  path: Type.String({ pattern: '^/' }),
  permission: Type.Optional(PermissionIdSchema),
}, { additionalProperties: false })
export type NavigationContribution = Static<typeof NavigationContributionSchema>

export const NavigationSectionSchema = Type.Object({
  id: RegistryIdSchema,
  label: Type.String({ minLength: 1 }),
  defaultCollapsed: Type.Boolean(),
  navigationIds: Type.Array(RegistryIdSchema, { minItems: 1, uniqueItems: true }),
}, { additionalProperties: false })
export type NavigationSection = Static<typeof NavigationSectionSchema>

export const OnboardingStepContributionSchema = Type.Object({
  ...OrderedContributionSchema,
  title: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
}, { additionalProperties: false })
export type OnboardingStepContribution = Static<typeof OnboardingStepContributionSchema>

export const StarterTemplateContributionSchema = Type.Object({
  ...OrderedContributionSchema,
  label: Type.String({ minLength: 1 }),
  templateId: RegistryIdSchema,
}, { additionalProperties: false })
export type StarterTemplateContribution = Static<typeof StarterTemplateContributionSchema>

export const PermissionDefinitionSchema = Type.Object({
  id: PermissionIdSchema,
  label: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
}, { additionalProperties: false })
export type PermissionDefinition = Static<typeof PermissionDefinitionSchema>

export const RouteContributionSchema = Type.Object({
  id: RegistryIdSchema,
  method: Type.Union([
    Type.Literal('DELETE'),
    Type.Literal('GET'),
    Type.Literal('PATCH'),
    Type.Literal('POST'),
    Type.Literal('PUT'),
  ]),
  path: Type.String({ pattern: '^/(?:[^/]+(?:/[^/]+)*)?/?$' }),
  permission: PermissionIdSchema,
}, { additionalProperties: false })
export type RouteContribution = Static<typeof RouteContributionSchema>

export const JobContributionSchema = Type.Object({
  id: RegistryIdSchema,
  handlerId: RegistryIdSchema,
  permission: PermissionIdSchema,
}, { additionalProperties: false })
export type JobContribution = Static<typeof JobContributionSchema>

export const TransferContributionSchema = Type.Object({
  id: RegistryIdSchema,
  stepId: RegistryIdSchema,
  permission: PermissionIdSchema,
}, { additionalProperties: false })
export type TransferContribution = Static<typeof TransferContributionSchema>

export const CapabilityDefinitionSchema = Type.Object({
  id: CapabilityIdSchema,
  dependsOn: Type.Optional(Type.Array(CapabilityIdSchema)),
  conflictsWith: Type.Optional(Type.Array(CapabilityIdSchema)),
  navigation: Type.Optional(Type.Array(NavigationContributionSchema)),
  onboarding: Type.Optional(Type.Array(OnboardingStepContributionSchema)),
  starterTemplates: Type.Optional(Type.Array(StarterTemplateContributionSchema)),
  permissions: Type.Optional(Type.Array(PermissionDefinitionSchema)),
  routes: Type.Optional(Type.Array(RouteContributionSchema)),
  jobs: Type.Optional(Type.Array(JobContributionSchema)),
  transfer: Type.Optional(Type.Array(TransferContributionSchema)),
}, { additionalProperties: false })
export type CapabilityDefinition = Static<typeof CapabilityDefinitionSchema>

export const ProductProfileSchema = Type.Object({
  id: RegistryIdSchema,
  label: Type.String({ minLength: 1 }),
  subtitle: Type.Optional(Type.String({ minLength: 1 })),
  capabilityPreset: Type.Array(CapabilityIdSchema, { minItems: 1 }),
  navigationPreset: Type.Array(RegistryIdSchema),
  navigationSections: Type.Optional(Type.Array(NavigationSectionSchema)),
  onboardingPreset: Type.Array(RegistryIdSchema),
  starterTemplatePreset: Type.Array(RegistryIdSchema),
}, { additionalProperties: false })
export type ProductProfile = Static<typeof ProductProfileSchema>

export const CapabilityOverridesSchema = Type.Object({
  grant: Type.Array(CapabilityIdSchema),
  revoke: Type.Array(CapabilityIdSchema),
}, { additionalProperties: false })
export type CapabilityOverrides = Static<typeof CapabilityOverridesSchema>

export const FumaRegistryDefinitionSchema = Type.Object({
  capabilities: Type.Array(CapabilityDefinitionSchema),
  profiles: Type.Array(ProductProfileSchema),
}, { additionalProperties: false })
export type FumaRegistryDefinition = Static<typeof FumaRegistryDefinitionSchema>

export const ComposedProductProfileSchema = Type.Object({
  profile: ProductProfileSchema,
  capabilities: Type.Array(CapabilityDefinitionSchema),
  navigation: Type.Array(NavigationContributionSchema),
  onboarding: Type.Array(OnboardingStepContributionSchema),
  starterTemplates: Type.Array(StarterTemplateContributionSchema),
  permissions: Type.Array(PermissionDefinitionSchema),
  routes: Type.Array(RouteContributionSchema),
  jobs: Type.Array(JobContributionSchema),
  transfer: Type.Array(TransferContributionSchema),
}, { additionalProperties: false })
export type ComposedProductProfile = Static<typeof ComposedProductProfileSchema>

export const FumaRegistryErrorCodeSchema = Type.Union([
  Type.Literal('dependency-collision'),
  Type.Literal('duplicate-id'),
  Type.Literal('invalid-capability-override'),
  Type.Literal('invalid-definition'),
  Type.Literal('route-collision'),
  Type.Literal('unknown-profile'),
])
export type FumaRegistryErrorCode = Static<typeof FumaRegistryErrorCodeSchema>
