import {
  Type,
  Value,
  safeParseValue,
  type Static,
} from '@core/utils/typeboxHelpers'
import {
  AuditActionSchema,
  AuditMetadataKeySchema,
  FUMA_AUDIT_ACTIONS,
} from './contracts'

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

type Contract<T> = DeepReadonly<T>

export const AuditEventCategorySchema = Type.Union([
  Type.Literal('auth'),
  Type.Literal('access'),
  Type.Literal('support'),
  Type.Literal('moderation'),
  Type.Literal('breakglass'),
  Type.Literal('permission'),
  Type.Literal('context'),
  Type.Literal('job'),
  Type.Literal('organization'),
  Type.Literal('workspace'),
  Type.Literal('site'),
  Type.Literal('publication'),
  Type.Literal('transfer'),
])
export type AuditEventCategory = Static<typeof AuditEventCategorySchema>

export const AuditEventSensitivitySchema = Type.Union([
  Type.Literal('tenant'),
  Type.Literal('privileged'),
  Type.Literal('security'),
])
export type AuditEventSensitivity = Static<typeof AuditEventSensitivitySchema>

export const AuditEventCatalogEntrySchema = Type.Object({
  action: AuditActionSchema,
  category: AuditEventCategorySchema,
  sensitivity: AuditEventSensitivitySchema,
  requiredMetadataKeys: Type.Array(AuditMetadataKeySchema, {
    maxItems: 16,
  }),
}, { additionalProperties: false })
export type AuditEventCatalogEntry = Contract<
  Static<typeof AuditEventCatalogEntrySchema>
>

export const AuditEventCatalogSchema = Type.Array(AuditEventCatalogEntrySchema, {
  minItems: 1,
  maxItems: FUMA_AUDIT_ACTIONS.length,
})
export type AuditEventCatalog = Contract<Static<typeof AuditEventCatalogSchema>>

export const AuditCatalogErrorCodeSchema = Type.Union([
  Type.Literal('invalid-catalog'),
  Type.Literal('duplicate-action'),
  Type.Literal('normalized-action-collision'),
  Type.Literal('action-category-mismatch'),
  Type.Literal('duplicate-required-metadata-key'),
  Type.Literal('missing-action'),
  Type.Literal('unknown-action'),
])
export type AuditCatalogErrorCode = Static<typeof AuditCatalogErrorCodeSchema>

export class AuditCatalogError extends Error {
  readonly code: AuditCatalogErrorCode
  readonly path: string

  constructor(code: AuditCatalogErrorCode, message: string, path: string) {
    super(message)
    this.name = 'AuditCatalogError'
    this.code = code
    this.path = path
  }
}

/** Punctuation and case cannot be used to bypass collision or redaction rules. */
export function normalizeAuditMetadataKey(key: string): string {
  return key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) immutable(nested)
    Object.freeze(value)
  }
  return value
}

export function createAuditEventCatalog(value: unknown): AuditEventCatalog {
  const parsed = safeParseValue(AuditEventCatalogSchema, value)
  if (!parsed.ok) {
    const error = Value.Errors(AuditEventCatalogSchema, value).First()
    throw new AuditCatalogError(
      'invalid-catalog',
      `Audit event catalog is malformed${error ? `: ${error.path || '/'} ${error.message}` : ''}.`,
      'catalog',
    )
  }

  const actions = new Set<string>()
  const normalizedActions = new Map<string, string>()
  for (const [index, entry] of parsed.value.entries()) {
    const path = `catalog.${index}`
    if (actions.has(entry.action)) {
      throw new AuditCatalogError(
        'duplicate-action',
        `Audit action "${entry.action}" is declared more than once.`,
        `${path}.action`,
      )
    }
    actions.add(entry.action)

    const normalizedAction = normalizeAuditMetadataKey(entry.action)
    const collidingAction = normalizedActions.get(normalizedAction)
    if (collidingAction) {
      throw new AuditCatalogError(
        'normalized-action-collision',
        `Audit actions "${collidingAction}" and "${entry.action}" normalize to the same identifier.`,
        `${path}.action`,
      )
    }
    normalizedActions.set(normalizedAction, entry.action)

    if (!entry.action.startsWith(`${entry.category}.`)) {
      throw new AuditCatalogError(
        'action-category-mismatch',
        `Audit action "${entry.action}" does not belong to category "${entry.category}".`,
        `${path}.category`,
      )
    }

    const normalizedMetadataKeys = new Set<string>()
    for (const [keyIndex, key] of entry.requiredMetadataKeys.entries()) {
      const normalizedKey = normalizeAuditMetadataKey(key)
      if (normalizedMetadataKeys.has(normalizedKey)) {
        throw new AuditCatalogError(
          'duplicate-required-metadata-key',
          `Required metadata key "${key}" collides after normalization.`,
          `${path}.requiredMetadataKeys.${keyIndex}`,
        )
      }
      normalizedMetadataKeys.add(normalizedKey)
    }
  }

  return immutable(structuredClone(parsed.value))
}

const BASE_AUDIT_EVENT_CATALOG = [
  { action: 'auth.login.succeeded', category: 'auth', sensitivity: 'security', requiredMetadataKeys: ['authMethod'] },
  { action: 'auth.login.failed', category: 'auth', sensitivity: 'security', requiredMetadataKeys: ['authMethod', 'failureCode'] },
  { action: 'auth.logout.succeeded', category: 'auth', sensitivity: 'security', requiredMetadataKeys: [] },
  { action: 'auth.mfa.challenge-failed', category: 'auth', sensitivity: 'security', requiredMetadataKeys: ['factorType', 'failureCode'] },
  { action: 'auth.session.revoked', category: 'auth', sensitivity: 'security', requiredMetadataKeys: ['subjectUserId'] },
  { action: 'access.impersonation.started', category: 'access', sensitivity: 'security', requiredMetadataKeys: ['subjectUserId'] },
  { action: 'access.impersonation.ended', category: 'access', sensitivity: 'security', requiredMetadataKeys: ['subjectUserId'] },
  { action: 'support.action.authorized', category: 'support', sensitivity: 'security', requiredMetadataKeys: ['supportSessionId', 'operationId', 'capability'] },
  { action: 'moderation.evidence.recorded', category: 'moderation', sensitivity: 'security', requiredMetadataKeys: ['caseId', 'evidenceId', 'event', 'subjectId', 'reasonCode'] },
  { action: 'breakglass.recovery.requested', category: 'breakglass', sensitivity: 'security', requiredMetadataKeys: ['breakGlassRequestId', 'targetOwnerId', 'evidenceHashSha256'] },
  { action: 'breakglass.recovery.approved', category: 'breakglass', sensitivity: 'security', requiredMetadataKeys: ['breakGlassRequestId', 'approvalId', 'evidenceHashSha256'] },
  { action: 'breakglass.recovery.executed', category: 'breakglass', sensitivity: 'security', requiredMetadataKeys: ['breakGlassRequestId', 'executionId', 'approverIds'] },
  { action: 'access.denied', category: 'access', sensitivity: 'security', requiredMetadataKeys: ['permissionId'] },
  { action: 'permission.role.assigned', category: 'permission', sensitivity: 'privileged', requiredMetadataKeys: ['subjectUserId', 'roleId'] },
  { action: 'permission.role.removed', category: 'permission', sensitivity: 'privileged', requiredMetadataKeys: ['subjectUserId', 'roleId'] },
  { action: 'permission.override.changed', category: 'permission', sensitivity: 'privileged', requiredMetadataKeys: ['subjectUserId', 'permissionId', 'decision'] },
  { action: 'context.request.resolved', category: 'context', sensitivity: 'security', requiredMetadataKeys: ['profileId'] },
  { action: 'context.request.denied', category: 'context', sensitivity: 'security', requiredMetadataKeys: ['denialCode'] },
  { action: 'job.enqueued', category: 'job', sensitivity: 'tenant', requiredMetadataKeys: ['jobKind'] },
  { action: 'job.started', category: 'job', sensitivity: 'tenant', requiredMetadataKeys: ['jobKind', 'attempt'] },
  { action: 'job.succeeded', category: 'job', sensitivity: 'tenant', requiredMetadataKeys: ['jobKind', 'attempt'] },
  { action: 'job.failed', category: 'job', sensitivity: 'security', requiredMetadataKeys: ['jobKind', 'attempt', 'failureCode'] },
  { action: 'job.cancelled', category: 'job', sensitivity: 'tenant', requiredMetadataKeys: ['jobKind'] },
  { action: 'job.dead-lettered', category: 'job', sensitivity: 'security', requiredMetadataKeys: ['jobKind', 'attempt', 'failureCode'] },
  { action: 'organization.created', category: 'organization', sensitivity: 'privileged', requiredMetadataKeys: ['organizationSlug'] },
  { action: 'organization.updated', category: 'organization', sensitivity: 'privileged', requiredMetadataKeys: ['changedFields'] },
  { action: 'organization.suspended', category: 'organization', sensitivity: 'security', requiredMetadataKeys: ['reasonCode'] },
  { action: 'organization.restored', category: 'organization', sensitivity: 'security', requiredMetadataKeys: [] },
  { action: 'organization.member.invited', category: 'organization', sensitivity: 'privileged', requiredMetadataKeys: ['subjectUserId', 'roleId'] },
  { action: 'organization.member.role-changed', category: 'organization', sensitivity: 'privileged', requiredMetadataKeys: ['subjectUserId', 'roleId'] },
  { action: 'workspace.created', category: 'workspace', sensitivity: 'tenant', requiredMetadataKeys: ['workspaceSlug'] },
  { action: 'workspace.updated', category: 'workspace', sensitivity: 'tenant', requiredMetadataKeys: ['changedFields'] },
  { action: 'workspace.archived', category: 'workspace', sensitivity: 'privileged', requiredMetadataKeys: [] },
  { action: 'workspace.restored', category: 'workspace', sensitivity: 'privileged', requiredMetadataKeys: [] },
  { action: 'workspace.membership.override-changed', category: 'workspace', sensitivity: 'privileged', requiredMetadataKeys: ['subjectUserId', 'access'] },
  { action: 'site.created', category: 'site', sensitivity: 'tenant', requiredMetadataKeys: ['siteSlug', 'profileId'] },
  { action: 'site.updated', category: 'site', sensitivity: 'tenant', requiredMetadataKeys: ['changedFields'] },
  { action: 'site.archived', category: 'site', sensitivity: 'privileged', requiredMetadataKeys: [] },
  { action: 'site.restored', category: 'site', sensitivity: 'privileged', requiredMetadataKeys: [] },
  { action: 'site.capabilities.changed', category: 'site', sensitivity: 'privileged', requiredMetadataKeys: ['grantedCapabilityIds', 'revokedCapabilityIds'] },
  { action: 'publication.workflow.role-changed', category: 'publication', sensitivity: 'privileged', requiredMetadataKeys: ['subjectUserId', 'roleId', 'decision'] },
  { action: 'publication.workflow.assignment-changed', category: 'publication', sensitivity: 'tenant', requiredMetadataKeys: ['contentId', 'subjectUserId'] },
  { action: 'publication.workflow.review-requested', category: 'publication', sensitivity: 'tenant', requiredMetadataKeys: ['contentId', 'reviewId', 'subjectUserId'] },
  { action: 'publication.workflow.decision-recorded', category: 'publication', sensitivity: 'privileged', requiredMetadataKeys: ['contentId', 'reviewId', 'decision'] },
  { action: 'transfer.proposed', category: 'transfer', sensitivity: 'privileged', requiredMetadataKeys: ['transferId', 'destinationOrganizationId'] },
  { action: 'transfer.confirmed', category: 'transfer', sensitivity: 'privileged', requiredMetadataKeys: ['transferId', 'confirmationSide'] },
  { action: 'transfer.started', category: 'transfer', sensitivity: 'privileged', requiredMetadataKeys: ['transferId'] },
  { action: 'transfer.step.completed', category: 'transfer', sensitivity: 'privileged', requiredMetadataKeys: ['transferId', 'stepId'] },
  { action: 'transfer.failed', category: 'transfer', sensitivity: 'security', requiredMetadataKeys: ['transferId', 'failureCode'] },
  { action: 'transfer.resumed', category: 'transfer', sensitivity: 'privileged', requiredMetadataKeys: ['transferId'] },
  { action: 'transfer.compensated', category: 'transfer', sensitivity: 'security', requiredMetadataKeys: ['transferId', 'stepId'] },
  { action: 'transfer.completed', category: 'transfer', sensitivity: 'privileged', requiredMetadataKeys: ['transferId', 'destinationOrganizationId'] },
  { action: 'transfer.cancelled', category: 'transfer', sensitivity: 'privileged', requiredMetadataKeys: ['transferId', 'reasonCode'] },
] as const

export const FUMA_AUDIT_EVENT_CATALOG = createAuditEventCatalog(
  BASE_AUDIT_EVENT_CATALOG,
)

const catalogActions = new Set(FUMA_AUDIT_EVENT_CATALOG.map(({ action }) => action))
for (const action of FUMA_AUDIT_ACTIONS) {
  if (!catalogActions.has(action)) {
    throw new AuditCatalogError(
      'missing-action',
      `Audit action "${action}" has no catalog definition.`,
      'catalog',
    )
  }
}

const CATALOG_BY_ACTION = new Map(
  FUMA_AUDIT_EVENT_CATALOG.map((entry) => [entry.action, entry] as const),
)

export function getAuditEventCatalogEntry(action: string): AuditEventCatalogEntry {
  if (!Value.Check(AuditActionSchema, action)) {
    throw new AuditCatalogError(
      'unknown-action',
      `Unknown audit action "${action}".`,
      'action',
    )
  }
  const entry = CATALOG_BY_ACTION.get(action)
  if (!entry) {
    throw new AuditCatalogError(
      'unknown-action',
      `Unknown audit action "${action}".`,
      'action',
    )
  }
  return entry
}
