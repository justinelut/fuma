import {
  executeStructuredGhostImport,
  planStructuredGhostImport,
  rollbackStructuredGhostImport,
  type GhostImportExecutionPort,
  type GhostImportReceiptV2,
  type StructuredGhostDigestPort,
  type StructuredGhostImportPlan,
} from '../../../../../packages/fuma-governance-launch/src/ghostImport'
import type {
  StaffMemberImportReauthentication,
} from '../memberIdentity/contracts'
import type { StaffMemberImportReauthenticationAuthority } from '../memberIdentity/importService'
import { samePublicationScope, type PublicationRepositoryScope } from '../publication/scope'
import {
  LawyerImportError,
  LawyerSnapshotSchema,
  parseLawyerContract,
  type LawyerCommitments,
  type LawyerPaymentClaim,
  type LawyerPaymentClassification,
  type LawyerRouteRecord,
  type LawyerSnapshot,
  type LawyerVerifiedPaymentEvidence,
} from './contracts'

const RESERVED_EXCERPT_PAGES = new Set([
  '_folio', '_quote-of-the-week', '_print-edition', '_morning-brief-report',
  '_morning-brief-job', '_socials', '_theme', '_contact-info',
])
const SECTION_SCHEMAS: Readonly<Record<string, string>> = Object.freeze({
  'section-brief': 'brief',
  'section-case-law': 'case-law',
  'section-podcast': 'podcast',
  'section-col-from-the-bench': 'column',
  'section-col-practitioner': 'column',
  'section-col-off-the-record': 'column',
  'section-col-reader': 'column',
})
const SECRET_FIELD = /^(?:password|password_hash|session|sessions|cookie|cookies|authorization|token|access_token|refresh_token|secret|api_key|private_key|client_secret|resend_api_key|smtp_pass|smtp_password|paystack_secret_key)$/i
const SENSITIVE_SETTING = /(?:password|secret|private|api[_-]?key|token|cookie|resend|mailgun|sendgrid|smtp|aws[_-]?ses|authorization)/i
const PROTOTYPE_FIELD = /^(?:__proto__|prototype|constructor)$/
const REFERENCE_IN_NOTE = /\bref(?:erence)?\s+([A-Za-z0-9._-]{16,100})\b/i

export type LawyerQuarantineRecord = Readonly<{
  sourceId: string
  field: 'custom_excerpt' | 'codeinjection_head'
  reason: 'malformed-json' | 'unsafe-json' | 'missing-config-envelope'
  sourceHashSha256: string
}>
export type LawyerEnvelopeRecord = Readonly<{
  sourceId: string
  sourceKind: 'post' | 'page'
  schema: 'byline' | 'brief' | 'case-law' | 'podcast' | 'column' | 'reserved-config'
  value: Readonly<Record<string, unknown>>
}>
export type LawyerReservedPageRecord = Readonly<{
  sourceId: string
  slug: string
  storage: 'custom_excerpt' | 'codeinjection_head'
  mappedSettingKey: string | null
  state: 'mapped' | 'quarantined'
}>
export type LawyerPaymentReportEntry = Readonly<{
  claimId: string
  memberSourceId: string
  classification: LawyerPaymentClassification
  accessDecision: 'eligible-for-fuma-payment-reconciliation' | 'do-not-grant'
  evidenceId: string | null
  providerReferenceHashSha256: string | null
  providerTransactionHashSha256: string | null
}>
export type LawyerInventoryCounts = Readonly<{
  routes: number
  pageRoutes: number
  apiRoutes: number
  feedRoutes: number
  systemRoutes: number
  posts: number
  pages: number
  authors: number
  tags: number
  relations: number
  members: number
  newsletters: number
  settings: number
  media: number
  sectionTags: number
  reservedPages: number
  publicContent: number
  memberContent: number
  paidContent: number
}>
export type LawyerImportReport = Readonly<{
  snapshotId: string
  sourceSystem: 'the-lawyer-ghost-next'
  collectedAt: string
  counts: LawyerInventoryCounts
  hashes: Readonly<{
    routesSha256: string
    contentIdsSha256: string
    relationsSha256: string
    membershipSha256: string
    newsletterSha256: string
    commitmentsSha256: string
    evidenceSha256: string
    genericManifestSha256: string
    reportSha256: string
  }>
  routes: readonly LawyerRouteRecord[]
  sectionPlacements: readonly Readonly<{ sourceId: string; tagSlugs: readonly string[] }>[]
  envelopes: readonly LawyerEnvelopeRecord[]
  reservedPages: readonly LawyerReservedPageRecord[]
  quarantine: readonly LawyerQuarantineRecord[]
  payments: readonly LawyerPaymentReportEntry[]
  orphanPaymentEvidence: readonly LawyerPaymentReportEntry[]
  reauthentication: Readonly<{
    staffSourceIds: readonly string[]
    memberSourceIds: readonly string[]
    policy: 'fresh-staff-proof-and-member-activation-required'
  }>
  mailMigration: Readonly<{
    destinationProvider: 'oci-email-delivery'
    legacyPathsExcluded: readonly string[]
    providerCredentialsImported: false
  }>
  commitments: LawyerCommitments
  evidence: LawyerSnapshot['evidence']
  excludedKinds: readonly ['passwords', 'sessions', 'cookies', 'api-keys', 'provider-secrets']
  designConversion: 'deferred-to-FUMA-077-and-FUMA-SITE-006'
}>
export type LawyerImportPlan = Readonly<{
  genericPlan: StructuredGhostImportPlan
  report: LawyerImportReport
}>

export type LawyerExecutionPorts = Readonly<{
  genericImport: GhostImportExecutionPort
  staffReauthentication: StaffMemberImportReauthenticationAuthority
}>

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LawyerImportError('invalid-snapshot', `${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function rows(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key]
  if (!Array.isArray(value)) throw new LawyerImportError('invalid-snapshot', `ghostExport.data.${key} must be an array.`)
  return value.map((entry, index) => object(entry, `ghostExport.data.${key}[${index}]`))
}

function id(row: Record<string, unknown>, label: string): string {
  if (typeof row.id !== 'string' || !row.id) throw new LawyerImportError('invalid-snapshot', `${label}.id is required.`)
  return row.id
}

function rejectSecrets(value: unknown, path = '$', depth = 0): void {
  if (depth > 24) throw new LawyerImportError('invalid-snapshot', `Snapshot nesting exceeds the safe limit at ${path}.`)
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecrets(entry, `${path}[${index}]`, depth + 1))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_FIELD.test(key)) throw new LawyerImportError('secret-detected', `Forbidden source field at ${path}.${key}.`)
      rejectSecrets(nested, `${path}.${key}`, depth + 1)
    }
  }
}

function safeJson(value: unknown, path = '$', depth = 0): void {
  if (depth > 12) throw new Error(`JSON nesting exceeds limit at ${path}.`)
  if (typeof value === 'string' && value.length > 20_000) throw new Error(`JSON string exceeds limit at ${path}.`)
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error(`JSON array exceeds limit at ${path}.`)
    value.forEach((entry, index) => safeJson(entry, `${path}[${index}]`, depth + 1))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (PROTOTYPE_FIELD.test(key) || SECRET_FIELD.test(key)) throw new Error(`Unsafe JSON field at ${path}.${key}.`)
      safeJson(nested, `${path}.${key}`, depth + 1)
    }
  }
}

async function parseEnvelope(
  raw: string,
  sourceId: string,
  field: LawyerQuarantineRecord['field'],
  digest: StructuredGhostDigestPort,
): Promise<{ value: Readonly<Record<string, unknown>> | null; quarantine: LawyerQuarantineRecord | null }> {
  try {
    const parsed = JSON.parse(raw) as unknown
    safeJson(parsed)
    return { value: Object.freeze(structuredClone(object(parsed, `${sourceId}.${field}`))), quarantine: null }
  } catch (error) {
    return {
      value: null,
      quarantine: Object.freeze({
        sourceId,
        field,
        reason: error instanceof SyntaxError ? 'malformed-json' : 'unsafe-json',
        sourceHashSha256: await digest(raw),
      }),
    }
  }
}

function configJson(codeInjection: string): string | null {
  const match = /<script\b[^>]*\bid=["']lawyer-config["'][^>]*>([\s\S]*?)<\/script>/i.exec(codeInjection)
    ?? /<script\b[^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i.exec(codeInjection)
  return match?.[1]?.trim() ?? null
}

function envelopeSchema(sectionTags: readonly string[]): LawyerEnvelopeRecord['schema'] {
  for (const tag of sectionTags) {
    const schema = SECTION_SCHEMAS[tag]
    if (schema) return schema as LawyerEnvelopeRecord['schema']
  }
  return 'byline'
}

function exactScope(metadata: LawyerVerifiedPaymentEvidence['metadata'], evidence: LawyerVerifiedPaymentEvidence): boolean {
  const scope = evidence.merchantScope
  return metadata.platformId === scope.platformId
    && metadata.organizationId === scope.organizationId
    && metadata.workspaceId === scope.workspaceId
    && metadata.siteId === scope.siteId
    && metadata.ownerKey === scope.ownerKey
    && metadata.ownerGeneration === scope.ownerGeneration
}

async function classifyPayments(
  claims: readonly LawyerPaymentClaim[],
  evidence: readonly LawyerVerifiedPaymentEvidence[],
  digest: StructuredGhostDigestPort,
): Promise<{ claims: LawyerPaymentReportEntry[]; orphans: LawyerPaymentReportEntry[] }> {
  const referenceUse = new Map<string, number>()
  const transactionUse = new Map<string, number>()
  for (const item of evidence) {
    referenceUse.set(item.transaction.reference, (referenceUse.get(item.transaction.reference) ?? 0) + 1)
    transactionUse.set(item.transaction.providerTransactionId, (transactionUse.get(item.transaction.providerTransactionId) ?? 0) + 1)
  }
  const usedEvidence = new Set<string>()
  const reports: LawyerPaymentReportEntry[] = []
  for (const claim of [...claims].sort((left, right) => left.claimId.localeCompare(right.claimId))) {
    const paystackLabels = claim.labels.filter((label) => label.startsWith('paystack-')).sort()
    const active = paystackLabels.includes('paystack-active')
    const matchingEvidence = evidence.filter((item) => item.memberSourceId === claim.memberSourceId)
    let classification: LawyerPaymentClassification = active ? 'exception-missing-provider-evidence' : 'no-paid-claim'
    let selected: LawyerVerifiedPaymentEvidence | null = null
    if (active && matchingEvidence.length > 1) classification = 'exception-ambiguous-provider-evidence'
    else if (active && matchingEvidence.length === 1) {
      selected = matchingEvidence[0]!
      usedEvidence.add(selected.evidenceId)
      const noteReference = claim.note === null ? null : REFERENCE_IN_NOTE.exec(claim.note)?.[1] ?? null
      const expectedTierLabel = `paystack-${claim.expectedTierId}`
      const expectedCadenceLabel = `paystack-${claim.expectedCadence}`
      const metadata = selected.metadata
      const transaction = selected.transaction
      if ((referenceUse.get(transaction.reference) ?? 0) > 1 || (transactionUse.get(transaction.providerTransactionId) ?? 0) > 1) {
        classification = 'exception-duplicate-provider-identity'
      } else if (!paystackLabels.includes(expectedTierLabel) || !paystackLabels.includes(expectedCadenceLabel)) {
        classification = 'exception-label-mismatch'
      } else if (noteReference === null || noteReference !== transaction.reference) {
        classification = 'exception-reference-mismatch'
      } else if (
        transaction.scope !== 'customer_merchant'
        || transaction.status !== 'success'
        || transaction.money.currency !== 'KES'
        || transaction.money.amountMinor !== claim.expectedAmountMinor
        || metadata.currency !== 'KES'
        || metadata.amountMinor !== claim.expectedAmountMinor
        || metadata.memberId !== claim.memberSourceId
        || metadata.tierId !== claim.expectedTierId
        || !exactScope(metadata, selected)
      ) classification = 'exception-provider-mismatch'
      else classification = 'verified-for-fuma-reconciliation'
    }
    reports.push(Object.freeze({
      claimId: claim.claimId,
      memberSourceId: claim.memberSourceId,
      classification,
      accessDecision: classification === 'verified-for-fuma-reconciliation' ? 'eligible-for-fuma-payment-reconciliation' : 'do-not-grant',
      evidenceId: selected?.evidenceId ?? null,
      providerReferenceHashSha256: selected ? await digest(selected.transaction.reference) : null,
      providerTransactionHashSha256: selected ? await digest(selected.transaction.providerTransactionId) : null,
    }))
  }
  const orphans: LawyerPaymentReportEntry[] = []
  for (const item of [...evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))) {
    if (usedEvidence.has(item.evidenceId)) continue
    orphans.push(Object.freeze({
      claimId: `orphan:${item.evidenceId}`,
      memberSourceId: item.memberSourceId,
      classification: 'exception-orphan-provider-evidence',
      accessDecision: 'do-not-grant',
      evidenceId: item.evidenceId,
      providerReferenceHashSha256: await digest(item.transaction.reference),
      providerTransactionHashSha256: await digest(item.transaction.providerTransactionId),
    }))
  }
  return { claims: reports, orphans }
}

function countRoutes(routes: readonly LawyerRouteRecord[]): Pick<LawyerInventoryCounts, 'pageRoutes' | 'apiRoutes' | 'feedRoutes' | 'systemRoutes'> {
  return {
    pageRoutes: routes.filter(({ kind }) => kind === 'page').length,
    apiRoutes: routes.filter(({ kind }) => kind === 'api').length,
    feedRoutes: routes.filter(({ kind }) => kind === 'feed').length,
    systemRoutes: routes.filter(({ kind }) => kind === 'system').length,
  }
}

export async function planLawyerImport(
  rawSnapshot: unknown,
  input: Readonly<{ importId: string; dryRun: boolean; digest: StructuredGhostDigestPort }>,
): Promise<LawyerImportPlan> {
  const snapshot = parseLawyerContract('Lawyer snapshot', LawyerSnapshotSchema, rawSnapshot) as LawyerSnapshot
  rejectSecrets(snapshot.ghostExport)
  const ghost = object(snapshot.ghostExport, 'ghostExport')
  const data = object(ghost.data, 'ghostExport.data')
  const posts = rows(data, 'posts')
  const tags = rows(data, 'tags')
  const tagRelations = rows(data, 'posts_tags')
  const newsletters = Array.isArray(data.newsletters) ? rows(data, 'newsletters') : []
  const settings = rows(data, 'settings').filter((setting) => typeof setting.key !== 'string' || !SENSITIVE_SETTING.test(setting.key))
  const tagSlugs = new Map(tags.map((tag) => [id(tag, 'tag'), typeof tag.slug === 'string' ? tag.slug : '']))
  const postTags = new Map<string, string[]>()
  for (const relation of tagRelations) {
    if (typeof relation.post_id !== 'string' || typeof relation.tag_id !== 'string') continue
    const slug = tagSlugs.get(relation.tag_id)
    if (slug) postTags.set(relation.post_id, [...(postTags.get(relation.post_id) ?? []), slug])
  }

  const envelopes: LawyerEnvelopeRecord[] = []
  const quarantines: LawyerQuarantineRecord[] = []
  const reservedPages: LawyerReservedPageRecord[] = []
  const syntheticSettings: Record<string, unknown>[] = []
  const transformedPosts: Record<string, unknown>[] = []
  for (const row of posts) {
    const sourceId = id(row, 'post')
    const kind = row.type === 'page' ? 'page' : 'post'
    const slug = typeof row.slug === 'string' ? row.slug : sourceId
    const sectionTags = (postTags.get(sourceId) ?? []).filter((tag) => tag.startsWith('section-')).sort()
    let transformed = { ...row }
    const excerpt = typeof row.custom_excerpt === 'string' ? row.custom_excerpt.trim() : ''
    const expectedExcerptJson = kind === 'post' && sectionTags.length > 0 || kind === 'page' && RESERVED_EXCERPT_PAGES.has(slug)
    if (excerpt.startsWith('{') || expectedExcerptJson) {
      const parsed = await parseEnvelope(excerpt, sourceId, 'custom_excerpt', input.digest)
      if (parsed.value) {
        const schema = kind === 'page' ? 'reserved-config' : envelopeSchema(sectionTags)
        envelopes.push(Object.freeze({ sourceId, sourceKind: kind, schema, value: parsed.value }))
        if (kind === 'page') syntheticSettings.push({ id: `lawyer-config:${sourceId}`, key: `lawyer.reserved.${slug}`, value: parsed.value })
      } else {
        if (parsed.quarantine) quarantines.push(parsed.quarantine)
        transformed = { ...transformed, custom_excerpt: null }
      }
    }
    if (kind === 'page' && slug.startsWith('_') && !RESERVED_EXCERPT_PAGES.has(slug)) {
      const rawConfig = typeof row.codeinjection_head === 'string' ? configJson(row.codeinjection_head) : null
      if (rawConfig === null) {
        quarantines.push(Object.freeze({ sourceId, field: 'codeinjection_head', reason: 'missing-config-envelope', sourceHashSha256: await input.digest(String(row.codeinjection_head ?? '')) }))
        reservedPages.push(Object.freeze({ sourceId, slug, storage: 'codeinjection_head', mappedSettingKey: null, state: 'quarantined' }))
      } else {
        const parsed = await parseEnvelope(rawConfig, sourceId, 'codeinjection_head', input.digest)
        if (parsed.value) {
          const key = `lawyer.reserved.${slug}`
          envelopes.push(Object.freeze({ sourceId, sourceKind: 'page', schema: 'reserved-config', value: parsed.value }))
          syntheticSettings.push({ id: `lawyer-config:${sourceId}`, key, value: parsed.value })
          reservedPages.push(Object.freeze({ sourceId, slug, storage: 'codeinjection_head', mappedSettingKey: key, state: 'mapped' }))
        } else {
          if (parsed.quarantine) quarantines.push(parsed.quarantine)
          reservedPages.push(Object.freeze({ sourceId, slug, storage: 'codeinjection_head', mappedSettingKey: null, state: 'quarantined' }))
        }
      }
    } else if (kind === 'page' && slug.startsWith('_')) {
      const mapped = envelopes.some((record) => record.sourceId === sourceId)
      reservedPages.push(Object.freeze({
        sourceId,
        slug,
        storage: 'custom_excerpt',
        mappedSettingKey: mapped ? `lawyer.reserved.${slug}` : null,
        state: mapped ? 'mapped' : 'quarantined',
      }))
    }
    transformedPosts.push(transformed)
  }

  const transformedGhost = {
    ...ghost,
    data: { ...data, posts: transformedPosts, settings: [...settings, ...syntheticSettings] },
  }
  const genericPlan = await planStructuredGhostImport(transformedGhost, {
    importId: input.importId,
    dryRun: input.dryRun,
    digest: input.digest,
    ...(snapshot.memberCsv === undefined ? {} : { memberCsv: snapshot.memberCsv }),
  })
  const actualCounts = genericPlan.manifest.counts
  const expected = snapshot.expectedCounts
  const comparable = {
    posts: actualCounts.posts,
    pages: actualCounts.pages,
    authors: actualCounts.authors,
    tags: actualCounts.tags,
    relations: actualCounts.relations,
    members: actualCounts.members,
    newsletters: actualCounts.newsletters,
    routes: snapshot.routes.length,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (comparable[key as keyof typeof comparable] !== value) throw new LawyerImportError('count-mismatch', `Lawyer ${key} count does not match the declared inventory.`)
  }
  if (new Set(snapshot.routes.map(({ route }) => route)).size !== snapshot.routes.length) {
    throw new LawyerImportError('invalid-snapshot', 'Lawyer route inventory contains duplicate routes.')
  }

  const sectionPlacements = posts
    .filter((row) => row.type !== 'page')
    .map((row) => ({ sourceId: id(row, 'post'), tagSlugs: Object.freeze((postTags.get(id(row, 'post')) ?? []).filter((tag) => tag.startsWith('section-')).sort()) }))
    .filter(({ tagSlugs: placements }) => placements.length > 0)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  const visibility = genericPlan.objects.filter(({ kind }) => kind === 'post' || kind === 'page').map(({ value }) => value.visibility)
  const paymentReports = await classifyPayments(snapshot.paymentClaims, snapshot.verifiedPaymentEvidence as readonly LawyerVerifiedPaymentEvidence[], input.digest)
  const routes = Object.freeze([...snapshot.routes].sort((left, right) => left.route.localeCompare(right.route)))
  const routeCounts = countRoutes(routes)
  const counts: LawyerInventoryCounts = Object.freeze({
    routes: routes.length,
    ...routeCounts,
    posts: actualCounts.posts,
    pages: actualCounts.pages,
    authors: actualCounts.authors,
    tags: actualCounts.tags,
    relations: actualCounts.relations,
    members: actualCounts.members,
    newsletters: actualCounts.newsletters,
    settings: actualCounts.settings,
    media: actualCounts.media,
    sectionTags: tags.filter((tag) => typeof tag.slug === 'string' && tag.slug.startsWith('section-')).length,
    reservedPages: reservedPages.length,
    publicContent: visibility.filter((item) => item === 'public').length,
    memberContent: visibility.filter((item) => item === 'members').length,
    paidContent: visibility.filter((item) => item === 'paid' || item === 'tiers').length,
  })
  const contentIds = genericPlan.objects.filter(({ kind }) => kind === 'post' || kind === 'page' || kind === 'author' || kind === 'tag').map(({ kind, sourceId }) => `${kind}:${sourceId}`).sort()
  const staffSourceIds = genericPlan.objects.filter(({ kind, requiresReauthentication }) => kind === 'author' && requiresReauthentication).map(({ sourceId }) => sourceId).sort()
  const memberSourceIds = genericPlan.objects.filter(({ kind, requiresReauthentication }) => kind === 'member' && requiresReauthentication).map(({ sourceId }) => sourceId).sort()
  const hashSeed = {
    snapshotId: snapshot.snapshotId,
    sourceSystem: snapshot.sourceSystem,
    collectedAt: snapshot.collectedAt,
    counts,
    routes,
    sectionPlacements,
    envelopes,
    reservedPages,
    quarantine: quarantines,
    payments: paymentReports.claims,
    orphanPaymentEvidence: paymentReports.orphans,
    commitments: snapshot.commitments,
    evidence: snapshot.evidence,
  }
  const hashes = {
    routesSha256: await input.digest(stableJson(routes)),
    contentIdsSha256: await input.digest(stableJson(contentIds)),
    relationsSha256: genericPlan.manifest.relationHashSha256,
    membershipSha256: await input.digest(stableJson({ members: memberSourceIds, claims: paymentReports.claims })),
    newsletterSha256: await input.digest(stableJson(newsletters.map((row) => ({ id: id(row, 'newsletter'), status: row.status ?? 'active' })).sort((left, right) => left.id.localeCompare(right.id)))),
    commitmentsSha256: await input.digest(stableJson(snapshot.commitments)),
    evidenceSha256: await input.digest(stableJson(snapshot.evidence)),
    genericManifestSha256: genericPlan.manifestHashSha256,
    reportSha256: await input.digest(stableJson(hashSeed)),
  }
  const report: LawyerImportReport = Object.freeze({
    snapshotId: snapshot.snapshotId,
    sourceSystem: snapshot.sourceSystem,
    collectedAt: snapshot.collectedAt,
    counts,
    hashes: Object.freeze(hashes),
    routes,
    sectionPlacements: Object.freeze(sectionPlacements),
    envelopes: Object.freeze(envelopes.sort((left, right) => left.sourceId.localeCompare(right.sourceId))),
    reservedPages: Object.freeze(reservedPages.sort((left, right) => left.slug.localeCompare(right.slug))),
    quarantine: Object.freeze(quarantines.sort((left, right) => `${left.sourceId}:${left.field}`.localeCompare(`${right.sourceId}:${right.field}`))),
    payments: Object.freeze(paymentReports.claims),
    orphanPaymentEvidence: Object.freeze(paymentReports.orphans),
    reauthentication: Object.freeze({ staffSourceIds: Object.freeze(staffSourceIds), memberSourceIds: Object.freeze(memberSourceIds), policy: 'fresh-staff-proof-and-member-activation-required' }),
    mailMigration: Object.freeze({ destinationProvider: 'oci-email-delivery', legacyPathsExcluded: Object.freeze([...snapshot.commitments.email.legacyDeliveryPaths].sort()), providerCredentialsImported: false }),
    commitments: snapshot.commitments,
    evidence: snapshot.evidence,
    excludedKinds: Object.freeze(['passwords', 'sessions', 'cookies', 'api-keys', 'provider-secrets'] as const),
    designConversion: 'deferred-to-FUMA-077-and-FUMA-SITE-006',
  })
  return Object.freeze({ genericPlan, report })
}

function assertFreshProof(scope: PublicationRepositoryScope, proof: StaffMemberImportReauthentication, now: Date): void {
  if (!samePublicationScope(scope, proof.scope)) throw new LawyerImportError('scope-denied', 'Staff reauthentication scope does not match the Lawyer destination.')
  const authenticatedAt = Date.parse(proof.authenticatedAt)
  const expiresAt = Date.parse(proof.expiresAt)
  if (proof.realm !== 'staff' || proof.purpose !== 'member-import' || authenticatedAt > now.getTime() || expiresAt <= now.getTime() || expiresAt - authenticatedAt > 10 * 60 * 1_000) {
    throw new LawyerImportError('reauthentication-required', 'Fresh staff reauthentication is required for the Lawyer import.')
  }
}

export async function executeLawyerImport(
  plan: LawyerImportPlan,
  scope: PublicationRepositoryScope,
  proof: StaffMemberImportReauthentication,
  ports: LawyerExecutionPorts,
  now: () => Date = () => new Date(),
): Promise<GhostImportReceiptV2> {
  assertFreshProof(scope, proof, now())
  if (!await ports.staffReauthentication.verify(proof)) throw new LawyerImportError('reauthentication-required', 'Staff reauthentication proof was not verified.')
  return executeStructuredGhostImport(plan.genericPlan, ports.genericImport)
}

export async function rollbackLawyerImport(
  plan: LawyerImportPlan,
  receipt: GhostImportReceiptV2,
  scope: PublicationRepositoryScope,
  proof: StaffMemberImportReauthentication,
  ports: LawyerExecutionPorts,
  now: () => Date = () => new Date(),
): Promise<GhostImportReceiptV2> {
  assertFreshProof(scope, proof, now())
  if (!await ports.staffReauthentication.verify(proof)) throw new LawyerImportError('reauthentication-required', 'Staff reauthentication proof was not verified.')
  return rollbackStructuredGhostImport(plan.genericPlan, receipt, ports.genericImport)
}
