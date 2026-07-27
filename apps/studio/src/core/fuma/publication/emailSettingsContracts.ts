import { Type, type Static, type TSchema, safeParseValue } from '../../utils/typeboxHelpers'
import type { DeepReadonly } from './contracts'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const TimestampSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$' })
const EmailSchema = Type.String({ minLength: 3, maxLength: 320, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' })
const HttpsUrlSchema = Type.String({ minLength: 8, maxLength: 2048, pattern: '^https://[^\\s]+$' })
const VersionSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

export const EMAIL_SETTINGS_LEVELS = ['platform', 'organization', 'workspace', 'site', 'newsletter'] as const
export const EMAIL_SETTING_KEYS = ['senderName', 'senderEmail', 'replyToEmail', 'physicalAddress', 'brandColor', 'footerText'] as const
export const EMAIL_VARIABLE_MODES = ['preview', 'test', 'send'] as const

export const EmailSettingsLevelSchema = Type.Union(EMAIL_SETTINGS_LEVELS.map((value) => Type.Literal(value)))
export const EmailSettingKeySchema = Type.Union(EMAIL_SETTING_KEYS.map((value) => Type.Literal(value)))
export type EmailSettingsLevel = Static<typeof EmailSettingsLevelSchema>
export type EmailSettingKey = Static<typeof EmailSettingKeySchema>

export const EmailSettingOverrideSchema = Type.Union([
  Type.Object({ key: Type.Literal('senderName'), value: Type.String({ minLength: 1, maxLength: 160 }) }, { additionalProperties: false }),
  Type.Object({ key: Type.Literal('senderEmail'), value: EmailSchema }, { additionalProperties: false }),
  Type.Object({ key: Type.Literal('replyToEmail'), value: EmailSchema }, { additionalProperties: false }),
  Type.Object({ key: Type.Literal('physicalAddress'), value: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false }),
  Type.Object({ key: Type.Literal('brandColor'), value: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }) }, { additionalProperties: false }),
  Type.Object({ key: Type.Literal('footerText'), value: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
])
export type EmailSettingOverride = DeepReadonly<Static<typeof EmailSettingOverrideSchema>>

export const EmailSettingsMutationSchema = Type.Union([
  Type.Object({ kind: Type.Literal('set'), overrides: Type.Array(EmailSettingOverrideSchema, { minItems: 1, maxItems: EMAIL_SETTING_KEYS.length }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('reset'), keys: Type.Array(EmailSettingKeySchema, { minItems: 1, maxItems: EMAIL_SETTING_KEYS.length, uniqueItems: true }) }, { additionalProperties: false }),
])
export type EmailSettingsMutation = DeepReadonly<Static<typeof EmailSettingsMutationSchema>>

export const EmailSettingsTargetSchema = Type.Object({
  level: EmailSettingsLevelSchema,
  levelId: IdSchema,
}, { additionalProperties: false })
export type EmailSettingsTarget = DeepReadonly<Static<typeof EmailSettingsTargetSchema>>

export const EmailSettingsVersionSchema = Type.Object({
  versionId: IdSchema,
  level: EmailSettingsLevelSchema,
  levelId: IdSchema,
  ordinal: VersionSchema,
  parentVersionId: Type.Union([IdSchema, Type.Null()]),
  overrides: Type.Array(EmailSettingOverrideSchema, { maxItems: EMAIL_SETTING_KEYS.length }),
  mutation: EmailSettingsMutationSchema,
  actorId: IdSchema,
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type EmailSettingsVersion = DeepReadonly<Static<typeof EmailSettingsVersionSchema>>

export const EmailSettingsChangeCommandSchema = Type.Object({
  target: EmailSettingsTargetSchema,
  expectedVersionId: Type.Union([IdSchema, Type.Null()]),
  mutation: EmailSettingsMutationSchema,
}, { additionalProperties: false })
export type EmailSettingsChangeCommand = DeepReadonly<Static<typeof EmailSettingsChangeCommandSchema>>

const EmailSettingsValuesProperties = {
  senderName: Type.String({ minLength: 1, maxLength: 160 }),
  senderEmail: EmailSchema,
  replyToEmail: EmailSchema,
  physicalAddress: Type.String({ minLength: 1, maxLength: 500 }),
  brandColor: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
  footerText: Type.String({ minLength: 1, maxLength: 1000 }),
}
export const EmailSettingsValuesV2Schema = Type.Object(EmailSettingsValuesProperties, { additionalProperties: false })
export type EmailSettingsValuesV2 = DeepReadonly<Static<typeof EmailSettingsValuesV2Schema>>

const EmailSettingProvenanceSchema = Type.Object({
  level: EmailSettingsLevelSchema,
  levelId: IdSchema,
  versionId: IdSchema,
  ordinal: VersionSchema,
  inherited: Type.Boolean(),
}, { additionalProperties: false })
export const ResolvedEmailSettingsV2Schema = Type.Object({
  values: EmailSettingsValuesV2Schema,
  provenance: Type.Object({
    senderName: EmailSettingProvenanceSchema,
    senderEmail: EmailSettingProvenanceSchema,
    replyToEmail: EmailSettingProvenanceSchema,
    physicalAddress: EmailSettingProvenanceSchema,
    brandColor: EmailSettingProvenanceSchema,
    footerText: EmailSettingProvenanceSchema,
  }, { additionalProperties: false }),
  provider: Type.Literal('oci-email-delivery'),
  layerVersions: Type.Array(EmailSettingsVersionSchema, { minItems: 1, maxItems: EMAIL_SETTINGS_LEVELS.length }),
}, { additionalProperties: false })
export type ResolvedEmailSettingsV2 = DeepReadonly<Static<typeof ResolvedEmailSettingsV2Schema>>

export const EmailVariableModeSchema = Type.Union(EMAIL_VARIABLE_MODES.map((value) => Type.Literal(value)))
export const EmailVariableNameSchema = Type.Union([
  Type.Literal('platform.displayName'),
  Type.Literal('organization.displayName'),
  Type.Literal('workspace.displayName'),
  Type.Literal('site.displayName'),
  Type.Literal('site.url'),
  Type.Literal('newsletter.name'),
  Type.Literal('member.displayName'),
  Type.Literal('member.email'),
  Type.Literal('campaign.subject'),
  Type.Literal('unsubscribe.url'),
  Type.Literal('platform.ociPrivateKey'),
])
export type EmailVariableMode = Static<typeof EmailVariableModeSchema>
export type EmailVariableName = Static<typeof EmailVariableNameSchema>

export const EmailVariableDefinitionSchema = Type.Object({
  name: EmailVariableNameSchema,
  namespace: Type.Union(['platform', 'organization', 'workspace', 'site', 'newsletter', 'member', 'campaign', 'unsubscribe'].map((value) => Type.Literal(value))),
  type: Type.Union([Type.Literal('string'), Type.Literal('email'), Type.Literal('https-url'), Type.Literal('secret')]),
  classification: Type.Union([Type.Literal('public'), Type.Literal('personal'), Type.Literal('secret')]),
  required: Type.Boolean(),
  allowedModes: Type.Array(EmailVariableModeSchema, { maxItems: EMAIL_VARIABLE_MODES.length, uniqueItems: true }),
}, { additionalProperties: false })
export type EmailVariableDefinition = DeepReadonly<Static<typeof EmailVariableDefinitionSchema>>

export const EmailVariableCatalogSchema = Type.Object({
  variables: Type.Array(EmailVariableDefinitionSchema, { maxItems: 32 }),
  deniedSecretCount: Type.Integer({ minimum: 0, maximum: 32 }),
}, { additionalProperties: false })
export type EmailVariableCatalog = DeepReadonly<Static<typeof EmailVariableCatalogSchema>>

export const EmailVariableBindingSchema = Type.Object({
  platformId: IdSchema,
  organizationId: IdSchema,
  workspaceId: IdSchema,
  siteId: IdSchema,
  ownerKey: IdSchema,
  ownerGeneration: VersionSchema,
  profileId: IdSchema,
  newsletterId: Type.Union([IdSchema, Type.Null()]),
}, { additionalProperties: false })
export type EmailVariableBinding = DeepReadonly<Static<typeof EmailVariableBindingSchema>>

export const EmailVariableValueSchema = Type.Object({
  name: EmailVariableNameSchema,
  value: Type.String({ maxLength: 4096 }),
  binding: EmailVariableBindingSchema,
}, { additionalProperties: false })
export type EmailVariableValue = DeepReadonly<Static<typeof EmailVariableValueSchema>>

export const EmailVariableResolutionSchema = Type.Object({
  mode: EmailVariableModeSchema,
  values: Type.Array(Type.Object({ name: EmailVariableNameSchema, value: Type.String({ maxLength: 4096 }) }, { additionalProperties: false }), { maxItems: 64 }),
}, { additionalProperties: false })
export type EmailVariableResolution = DeepReadonly<Static<typeof EmailVariableResolutionSchema>>

export function parseEmailSettingsContract<T extends TSchema>(boundary: string, schema: T, value: unknown): DeepReadonly<Static<T>> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new EmailSettingsContractError(boundary)
  return deepFreeze(structuredClone(parsed.value)) as DeepReadonly<Static<T>>
}

export class EmailSettingsContractError extends Error {
  readonly code = 'invalid-contract' as const
  constructor(boundary: string) {
    super(`${boundary} failed validation.`)
    this.name = 'EmailSettingsContractError'
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

export const EmailVariableTypeSchemas: Readonly<Record<'string' | 'email' | 'https-url' | 'secret', TSchema>> = Object.freeze({
  string: Type.String({ minLength: 1, maxLength: 4096 }),
  email: EmailSchema,
  'https-url': HttpsUrlSchema,
  secret: Type.String({ minLength: 1, maxLength: 4096 }),
})
