import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  EMAIL_SETTING_KEYS,
  EMAIL_SETTINGS_LEVELS,
  EmailSettingsChangeCommandSchema,
  EmailSettingsVersionSchema,
  EmailVariableBindingSchema,
  EmailVariableCatalogSchema,
  EmailVariableDefinitionSchema,
  EmailVariableResolutionSchema,
  EmailVariableTypeSchemas,
  EmailVariableValueSchema,
  ResolvedEmailSettingsV2Schema,
  parseEmailSettingsContract,
  type EmailSettingKey,
  type EmailSettingOverride,
  type EmailSettingsChangeCommand,
  type EmailSettingsLevel,
  type EmailSettingsTarget,
  type EmailSettingsVersion,
  type EmailVariableBinding,
  type EmailVariableCatalog,
  type EmailVariableDefinition,
  type EmailVariableMode,
  type EmailVariableResolution,
  type EmailVariableValue,
  type ResolvedEmailSettingsV2,
} from '@core/fuma/publication/emailSettingsContracts'
import type { PublicationRepositoryScope } from './scope'

export interface EmailSettingsVersionRepository {
  current(scope: PublicationRepositoryScope, target: EmailSettingsTarget): Promise<EmailSettingsVersion | null>
  listCurrent(scope: PublicationRepositoryScope, newsletterId: string | null): Promise<readonly EmailSettingsVersion[]>
  append(scope: PublicationRepositoryScope, version: EmailSettingsVersion, expectedVersionId: string | null): Promise<boolean>
}

export interface EmailSettingsVersionIdAuthority {
  id(kind: 'email-settings-version'): string
}

export class EmailSettingsError extends Error {
  readonly code: 'conflict' | 'incomplete' | 'invalid-hierarchy' | 'scope-denied' | 'unknown-variable' | 'missing-variable' | 'secret-variable' | 'unauthorized-variable' | 'variable-type'
  constructor(
    code: EmailSettingsError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'EmailSettingsError'
    this.code = code
  }
}

const DEFINITIONS: readonly EmailVariableDefinition[] = Object.freeze([
  definition('platform.displayName', 'platform', 'string', 'public', true, ['preview', 'test', 'send']),
  definition('organization.displayName', 'organization', 'string', 'public', true, ['preview', 'test', 'send']),
  definition('workspace.displayName', 'workspace', 'string', 'public', true, ['preview', 'test', 'send']),
  definition('site.displayName', 'site', 'string', 'public', true, ['preview', 'test', 'send']),
  definition('site.url', 'site', 'https-url', 'public', true, ['preview', 'test', 'send']),
  definition('newsletter.name', 'newsletter', 'string', 'public', true, ['preview', 'test', 'send']),
  definition('member.displayName', 'member', 'string', 'personal', false, ['preview', 'test', 'send']),
  definition('member.email', 'member', 'email', 'personal', true, ['test', 'send']),
  definition('campaign.subject', 'campaign', 'string', 'public', true, ['preview', 'test', 'send']),
  definition('unsubscribe.url', 'unsubscribe', 'https-url', 'personal', true, ['test', 'send']),
  definition('platform.ociPrivateKey', 'platform', 'secret', 'secret', true, []),
])
const DEFINITION_BY_NAME = new Map<string, EmailVariableDefinition>(DEFINITIONS.map((item) => [item.name, item]))

export class HierarchicalEmailSettingsService {
  readonly repository: EmailSettingsVersionRepository
  readonly ids: EmailSettingsVersionIdAuthority
  readonly now: () => Date
  constructor(
    repository: EmailSettingsVersionRepository,
    ids: EmailSettingsVersionIdAuthority,
    now: () => Date = () => new Date(),
  ) {
    this.repository = repository
    this.ids = ids
    this.now = now
  }

  async change(scope: PublicationRepositoryScope, actorId: string, input: EmailSettingsChangeCommand): Promise<EmailSettingsVersion> {
    const command = parseEmailSettingsContract('Email settings change command', EmailSettingsChangeCommandSchema, input)
    assertTarget(scope, command.target, command.target.level === 'newsletter' ? command.target.levelId : null)
    const current = await this.repository.current(scope, command.target)
    if ((current?.versionId ?? null) !== command.expectedVersionId) throw new EmailSettingsError('conflict', 'Email settings changed concurrently.')
    const overrides = applyMutation(current?.overrides ?? [], command.mutation)
    const version = parseEmailSettingsContract('Email settings version', EmailSettingsVersionSchema, {
      versionId: this.ids.id('email-settings-version'),
      level: command.target.level,
      levelId: command.target.levelId,
      ordinal: (current?.ordinal ?? 0) + 1,
      parentVersionId: current?.versionId ?? null,
      overrides,
      mutation: command.mutation,
      actorId,
      createdAt: this.now().toISOString(),
    })
    if (!await this.repository.append(scope, version, command.expectedVersionId)) throw new EmailSettingsError('conflict', 'Email settings changed concurrently.')
    return version
  }

  async resolve(scope: PublicationRepositoryScope, newsletterId: string | null): Promise<ResolvedEmailSettingsV2> {
    return resolveEmailSettingsVersions(scope, newsletterId, await this.repository.listCurrent(scope, newsletterId))
  }
}

export function resolveEmailSettingsVersions(
  scope: PublicationRepositoryScope,
  newsletterId: string | null,
  versions: readonly EmailSettingsVersion[],
): ResolvedEmailSettingsV2 {
  const byLevel = new Map<EmailSettingsLevel, EmailSettingsVersion>()
  for (const versionInput of versions) {
    const version = parseEmailSettingsContract('Email settings version', EmailSettingsVersionSchema, versionInput)
    assertTarget(scope, version, newsletterId)
    if (byLevel.has(version.level)) throw new EmailSettingsError('invalid-hierarchy', 'Email settings hierarchy contains a duplicate level.')
    byLevel.set(version.level, version)
  }
  const ordered = EMAIL_SETTINGS_LEVELS.flatMap((level) => {
    const version = byLevel.get(level)
    return version ? [version] : []
  })
  const values = new Map<EmailSettingKey, EmailSettingOverride['value']>()
  const provenance = new Map<EmailSettingKey, Omit<ResolvedEmailSettingsV2['provenance'][EmailSettingKey], 'inherited'>>()
  for (const version of ordered) {
    for (const override of version.overrides) {
      values.set(override.key, override.value)
      provenance.set(override.key, { level: version.level, levelId: version.levelId, versionId: version.versionId, ordinal: version.ordinal })
    }
  }
  for (const key of EMAIL_SETTING_KEYS) if (!values.has(key)) throw new EmailSettingsError('incomplete', 'Required email settings are incomplete.')
  const targetLevel: EmailSettingsLevel = newsletterId === null ? 'site' : 'newsletter'
  const targetIndex = EMAIL_SETTINGS_LEVELS.indexOf(targetLevel)
  const resultValues = Object.fromEntries(EMAIL_SETTING_KEYS.map((key) => [key, values.get(key)]))
  const resultProvenance = Object.fromEntries(EMAIL_SETTING_KEYS.map((key) => {
    const source = provenance.get(key)!
    return [key, { ...source, inherited: EMAIL_SETTINGS_LEVELS.indexOf(source.level) < targetIndex }]
  }))
  return parseEmailSettingsContract('Resolved email settings', ResolvedEmailSettingsV2Schema, {
    values: resultValues,
    provenance: resultProvenance,
    provider: 'oci-email-delivery',
    layerVersions: ordered,
  })
}

export function emailVariableCatalog(mode: EmailVariableMode): EmailVariableCatalog {
  const visible = DEFINITIONS.filter((item) => item.classification !== 'secret' && item.allowedModes.includes(mode))
  return parseEmailSettingsContract('Email variable catalog', EmailVariableCatalogSchema, {
    variables: visible,
    deniedSecretCount: DEFINITIONS.length - DEFINITIONS.filter((item) => item.classification !== 'secret').length,
  })
}

export function resolveAuthorizedEmailVariables(input: Readonly<{
  scope: PublicationRepositoryScope
  newsletterId: string | null
  mode: EmailVariableMode
  names: readonly string[]
  values: readonly unknown[]
}>): EmailVariableResolution {
  if (input.names.length > 64 || new Set(input.names).size !== input.names.length) throw new EmailSettingsError('unknown-variable', 'Email variable request is invalid.')
  const context = new Map<string, EmailVariableValue>()
  for (const raw of input.values) {
    const parsed = safeParseValue(EmailVariableValueSchema, raw)
    if (!parsed.ok) throw new EmailSettingsError('unknown-variable', 'Email variable context is invalid.')
    const definition = DEFINITION_BY_NAME.get(parsed.value.name)
    if (!definition) throw new EmailSettingsError('unknown-variable', 'Email variable is not recognized.')
    if (definition.classification === 'secret') throw new EmailSettingsError('secret-variable', 'Secret email variables are unavailable.')
    if (context.has(parsed.value.name)) throw new EmailSettingsError('unknown-variable', 'Email variable context is invalid.')
    assertVariableBinding(input.scope, input.newsletterId, parsed.value.binding)
    context.set(parsed.value.name, parsed.value)
  }
  const resolved: Array<{ name: EmailVariableValue['name']; value: string }> = []
  for (const name of input.names) {
    const definition = DEFINITION_BY_NAME.get(name)
    if (!definition) throw new EmailSettingsError('unknown-variable', 'Email variable is not recognized.')
    if (definition.classification === 'secret') throw new EmailSettingsError('secret-variable', 'Secret email variables are unavailable.')
    if (!definition.allowedModes.includes(input.mode)) throw new EmailSettingsError('unauthorized-variable', 'Email variable is not authorized in this context.')
    const entry = context.get(name)
    if (!entry) throw new EmailSettingsError('missing-variable', 'A required email variable is missing.')
    if (!safeParseValue(EmailVariableTypeSchemas[definition.type], entry.value).ok) throw new EmailSettingsError('variable-type', 'Email variable has an invalid type.')
    resolved.push({ name: entry.name, value: entry.value })
  }
  return parseEmailSettingsContract('Email variable resolution', EmailVariableResolutionSchema, { mode: input.mode, values: resolved })
}

export function redactEmailVariableValues(values: readonly unknown[]): readonly Readonly<{ name: string; value: string }>[] {
  return Object.freeze(values.map((raw) => {
    const parsed = safeParseValue(EmailVariableValueSchema, raw)
    if (!parsed.ok) return Object.freeze({ name: '[INVALID]', value: '[REDACTED]' })
    const definition = DEFINITION_BY_NAME.get(parsed.value.name)
    return Object.freeze({
      name: definition?.classification === 'secret' ? '[REDACTED]' : parsed.value.name,
      value: definition?.classification === 'public' ? parsed.value.value : '[REDACTED]',
    })
  }))
}

export function emailVariableBinding(scope: PublicationRepositoryScope, newsletterId: string | null): EmailVariableBinding {
  return parseEmailSettingsContract('Email variable binding', EmailVariableBindingSchema, {
    platformId: scope.platformId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    siteId: scope.siteId,
    ownerKey: scope.ownerKey,
    ownerGeneration: scope.generation,
    profileId: scope.profileId,
    newsletterId,
  })
}

function applyMutation(current: readonly EmailSettingOverride[], mutation: EmailSettingsChangeCommand['mutation']): readonly EmailSettingOverride[] {
  const values = new Map<EmailSettingKey, EmailSettingOverride>()
  for (const override of current) {
    if (values.has(override.key)) throw new EmailSettingsError('invalid-hierarchy', 'Email setting overrides contain a duplicate key.')
    values.set(override.key, override)
  }
  if (mutation.kind === 'set') {
    const incoming = new Set<EmailSettingKey>()
    for (const override of mutation.overrides) {
      if (incoming.has(override.key)) throw new EmailSettingsError('invalid-hierarchy', 'Email setting mutation contains a duplicate key.')
      incoming.add(override.key)
      values.set(override.key, override)
    }
  } else {
    for (const key of mutation.keys) values.delete(key)
  }
  return Object.freeze(EMAIL_SETTING_KEYS.flatMap((key) => {
    const value = values.get(key)
    return value ? [value] : []
  }))
}

function assertTarget(scope: PublicationRepositoryScope, target: EmailSettingsTarget, newsletterId: string | null): void {
  const expected: Readonly<Record<EmailSettingsLevel, string | null>> = {
    platform: scope.platformId,
    organization: scope.organizationId,
    workspace: scope.workspaceId,
    site: scope.siteId,
    newsletter: newsletterId,
  }
  if (expected[target.level] === null || expected[target.level] !== target.levelId) throw new EmailSettingsError('scope-denied', 'Email settings scope denied.')
}

function assertVariableBinding(scope: PublicationRepositoryScope, newsletterId: string | null, bindingInput: EmailVariableBinding): void {
  const binding = parseEmailSettingsContract('Email variable binding', EmailVariableBindingSchema, bindingInput)
  if (binding.platformId !== scope.platformId || binding.organizationId !== scope.organizationId || binding.workspaceId !== scope.workspaceId || binding.siteId !== scope.siteId || binding.ownerKey !== scope.ownerKey || binding.ownerGeneration !== scope.generation || binding.profileId !== scope.profileId || binding.newsletterId !== newsletterId) {
    throw new EmailSettingsError('scope-denied', 'Email variable scope denied.')
  }
}

function definition(
  name: EmailVariableDefinition['name'],
  namespace: EmailVariableDefinition['namespace'],
  type: EmailVariableDefinition['type'],
  classification: EmailVariableDefinition['classification'],
  required: boolean,
  allowedModes: readonly EmailVariableMode[],
): EmailVariableDefinition {
  return parseEmailSettingsContract('Email variable definition', EmailVariableDefinitionSchema, { name, namespace, type, classification, required, allowedModes })
}
