import {
  DesignConversionManifestSchema,
  GhostImportManifestSchema,
  LawyerReconciliationSchema,
  parseStrict,
  type DesignConversionManifest,
  type GhostImportManifest,
  type LawyerReconciliation,
} from './contracts'

export class ImportPolicyError extends Error {
  constructor(readonly code: 'invalid-source' | 'secret-detected' | 'relation-invalid' | 'payment-unverified' | 'flattened-design', message: string) {
    super(message)
    this.name = 'ImportPolicyError'
  }
}

export type DigestPort = (value: string | Uint8Array) => Promise<string>

export type GhostExport = Readonly<{
  meta: Readonly<{ version: string }>
  data: Readonly<{
    posts: readonly Readonly<Record<string, unknown>>[]
    users: readonly Readonly<Record<string, unknown>>[]
    tags: readonly Readonly<Record<string, unknown>>[]
    posts_authors: readonly Readonly<Record<string, unknown>>[]
    posts_tags: readonly Readonly<Record<string, unknown>>[]
    settings: readonly Readonly<Record<string, unknown>>[]
    members?: readonly Readonly<Record<string, unknown>>[]
    newsletters?: readonly Readonly<Record<string, unknown>>[]
  }>
}>

const FORBIDDEN_KEYS = /^(?:password|password_hash|session|sessions|token|secret|api_key|private_key)$/i

function sanitizedValue(value: unknown, path: string, depth = 0): unknown {
  if (depth > 20) throw new ImportPolicyError('invalid-source', `Source nesting exceeds the safe limit at ${path}.`)
  if (typeof value === 'string') {
    if (value.length > 100_000) throw new ImportPolicyError('invalid-source', `Source string exceeds the safe limit at ${path}.`)
    return value
  }
  if (Array.isArray(value)) return value.map((nested, index) => sanitizedValue(nested, `${path}[${index}]`, depth + 1))
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (FORBIDDEN_KEYS.test(key)) throw new ImportPolicyError('secret-detected', `Forbidden source field at ${path}.${key}.`)
      output[key] = sanitizedValue((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1)
    }
    return output
  }
  return value
}

function sanitizedObject(value: Readonly<Record<string, unknown>>, path: string): Readonly<Record<string, unknown>> {
  return sanitizedValue(value, path) as Readonly<Record<string, unknown>>
}

function stableJson(value: unknown): string {
  return JSON.stringify(sanitizedValue(value, '$'))
}

export async function planGhostImport(source: GhostExport, input: { importId: string; dryRun: boolean; digest: DigestPort }): Promise<{ manifest: GhostImportManifest; rows: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>> }> {
  if (!/^5\.[0-9]+(?:\.[0-9]+)?$/.test(source.meta.version)) throw new ImportPolicyError('invalid-source', 'Only Ghost 5 exports are accepted.')
  const rows = {
    posts: source.data.posts.map((row, index) => sanitizedObject(row, `posts[${index}]`)),
    authors: source.data.users.map((row, index) => sanitizedObject(row, `users[${index}]`)),
    tags: source.data.tags.map((row, index) => sanitizedObject(row, `tags[${index}]`)),
    postAuthors: source.data.posts_authors.map((row, index) => sanitizedObject(row, `posts_authors[${index}]`)),
    postTags: source.data.posts_tags.map((row, index) => sanitizedObject(row, `posts_tags[${index}]`)),
    settings: source.data.settings.map((row, index) => sanitizedObject(row, `settings[${index}]`)),
    members: (source.data.members ?? []).map((row, index) => sanitizedObject(row, `members[${index}]`)),
    newsletters: (source.data.newsletters ?? []).map((row, index) => sanitizedObject(row, `newsletters[${index}]`)),
  } as const
  const postIds = new Set(rows.posts.map((row) => row.id).filter((id): id is string => typeof id === 'string'))
  const authorIds = new Set(rows.authors.map((row) => row.id).filter((id): id is string => typeof id === 'string'))
  const tagIds = new Set(rows.tags.map((row) => row.id).filter((id): id is string => typeof id === 'string'))
  if (postIds.size !== rows.posts.length || authorIds.size !== rows.authors.length || tagIds.size !== rows.tags.length || rows.postAuthors.some((row) => typeof row.post_id !== 'string' || typeof row.author_id !== 'string' || !postIds.has(row.post_id) || !authorIds.has(row.author_id)) || rows.postTags.some((row) => typeof row.post_id !== 'string' || typeof row.tag_id !== 'string' || !postIds.has(row.post_id) || !tagIds.has(row.tag_id))) throw new ImportPolicyError('relation-invalid', 'Ghost object identities or relation references are incomplete.')
  const canonical = stableJson(rows)
  const relations = stableJson({ postAuthors: rows.postAuthors, postTags: rows.postTags })
  const mediaUrls = rows.posts.flatMap((post) => typeof post.html === 'string' ? [...post.html.matchAll(/https?:\/\/[^"'\s)]+/g)].map(([url]) => url) : [])
  const manifest = parseStrict(GhostImportManifestSchema, {
    importId: input.importId,
    sourceVersion: source.meta.version,
    sourceHashSha256: await input.digest(canonical),
    counts: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length])),
    relationHashSha256: await input.digest(relations),
    mediaHashSha256: await input.digest(stableJson([...new Set(mediaUrls)].sort())),
    dryRun: input.dryRun,
    resumableCursor: null,
    excludedKinds: ['passwords', 'sessions', 'provider-secrets'],
  }, 'ghost.import.manifest')
  return { manifest, rows: Object.freeze(rows) }
}

export type GhostImportReceipt = Readonly<{ importId: string; manifestHashSha256: string; insertedIds: readonly string[]; mediaObjectKeys: readonly string[]; state: 'applied' | 'rolled-back' }>

export function rollbackGhostImport(receipt: GhostImportReceipt, expectedManifestHash: string): GhostImportReceipt {
  if (receipt.manifestHashSha256 !== expectedManifestHash) throw new ImportPolicyError('invalid-source', 'Rollback manifest identity changed.')
  if (receipt.state === 'rolled-back') return receipt
  if (receipt.state !== 'applied') throw new ImportPolicyError('invalid-source', 'Only an applied import can roll back.')
  return Object.freeze({ ...receipt, state: 'rolled-back' as const })
}

export type LawyerInventory = Readonly<{
  routes: readonly string[]
  memberIds: readonly string[]
  membershipRules: readonly Readonly<{ memberId: string; tier: string; sourcePaymentId: string | null }>[]
  storageBytes: number
  monthlyTraffic: number
  emailProvider: string
  supportCommitments: readonly string[]
  contentRows: readonly Readonly<Record<string, unknown>>[]
}>

export async function reconcileLawyer(input: { inventory: LawyerInventory; verifiedProviderPayments: ReadonlyMap<string, string>; digest: DigestPort }): Promise<{ report: LawyerReconciliation; quarantinedRows: readonly number[]; mappedExcerpts: readonly Readonly<{ rowIndex: number; value: unknown }>[] }> {
  const routes = new Set(input.inventory.routes)
  const members = new Set(input.inventory.memberIds)
  if (input.inventory.routes.length === 0 || routes.size !== input.inventory.routes.length || input.inventory.routes.some((route) => !route.startsWith('/') || route.includes('?') || route.includes('#')) || members.size !== input.inventory.memberIds.length || input.inventory.membershipRules.some(({ memberId }) => !members.has(memberId)) || !Number.isSafeInteger(input.inventory.storageBytes) || input.inventory.storageBytes < 0 || !Number.isSafeInteger(input.inventory.monthlyTraffic) || input.inventory.monthlyTraffic < 0) throw new ImportPolicyError('invalid-source', 'Lawyer route, member, relation, storage, and traffic inventory must be complete and canonical.')
  const quarantinedRows: number[] = []
  const mappedExcerpts: Readonly<{ rowIndex: number; value: unknown }>[] = []
  input.inventory.contentRows.forEach((row, index) => {
    if (typeof row.custom_excerpt === 'string' && row.custom_excerpt.trim().startsWith('{')) {
      try { mappedExcerpts.push(Object.freeze({ rowIndex: index, value: sanitizedValue(JSON.parse(row.custom_excerpt), `lawyer.contentRows[${index}].custom_excerpt`) })) } catch { quarantinedRows.push(index) }
    }
    sanitizedObject(row, `lawyer.contentRows[${index}]`)
  })
  const paymentRows = input.inventory.membershipRules.filter(({ sourcePaymentId }) => sourcePaymentId !== null).map(({ memberId, sourcePaymentId }) => {
    const providerReference = sourcePaymentId ? input.verifiedProviderPayments.get(sourcePaymentId) : undefined
    return { sourceId: memberId, state: providerReference ? 'provider-verified' as const : 'exception' as const, providerReferenceHashSha256: providerReference ? null : null }
  })
  const inventoryHashSha256 = await input.digest(JSON.stringify(input.inventory))
  const normalizedRows = await Promise.all(paymentRows.map(async (row, index) => {
    const sourcePaymentId = input.inventory.membershipRules.filter(({ sourcePaymentId }) => sourcePaymentId !== null)[index]?.sourcePaymentId
    const providerReference = sourcePaymentId ? input.verifiedProviderPayments.get(sourcePaymentId) : undefined
    return { ...row, providerReferenceHashSha256: providerReference ? await input.digest(providerReference) : null }
  }))
  const report = parseStrict(LawyerReconciliationSchema, {
    inventoryHashSha256,
    routeCount: input.inventory.routes.length,
    memberCount: input.inventory.memberIds.length,
    paymentRows: normalizedRows,
    emailMigration: 'oci-email-delivery',
    requiresStaffReauth: true,
    requiresMemberReauth: true,
  }, 'lawyer.reconciliation')
  return { report, quarantinedRows: Object.freeze(quarantinedRows), mappedExcerpts: Object.freeze(mappedExcerpts) }
}

export function assertLawyerDesignConversion(value: unknown, inventory: LawyerInventory): DesignConversionManifest {
  const manifest = parseStrict(DesignConversionManifestSchema, value, 'lawyer.design-conversion')
  const routes = new Set(manifest.routeBindings.map(({ route }) => route))
  const inventoryRoutes = new Set(inventory.routes)
  if (routes.size !== manifest.routeBindings.length || routes.size !== inventoryRoutes.size || inventory.routes.some((route) => !routes.has(route)) || manifest.routeBindings.some(({ route, templateId, loopIds }) => !inventoryRoutes.has(route) || !manifest.templateIds.includes(templateId) || loopIds.length === 0 || new Set(loopIds).size !== loopIds.length) || manifest.flattenedCopies !== 0) throw new ImportPolicyError('flattened-design', 'Every Lawyer route must bind exactly one reusable template, unique loops, and access state.')
  return manifest
}

export async function compareGhostSourceParity(jsonSource: GhostExport, adminApiSource: GhostExport, input: { digest: DigestPort }): Promise<Readonly<{ jsonHashSha256: string; adminApiHashSha256: string; countsMatch: true }>> {
  const jsonPlan = await planGhostImport(jsonSource, { importId: 'parity-json', dryRun: true, digest: input.digest })
  const apiPlan = await planGhostImport(adminApiSource, { importId: 'parity-api', dryRun: true, digest: input.digest })
  const jsonCounts = JSON.stringify(jsonPlan.manifest.counts)
  const apiCounts = JSON.stringify(apiPlan.manifest.counts)
  if (jsonCounts !== apiCounts || jsonPlan.manifest.relationHashSha256 !== apiPlan.manifest.relationHashSha256 || jsonPlan.manifest.mediaHashSha256 !== apiPlan.manifest.mediaHashSha256 || jsonPlan.manifest.sourceHashSha256 !== apiPlan.manifest.sourceHashSha256) throw new ImportPolicyError('invalid-source', 'Ghost JSON and Admin API sources do not describe the same canonical import.')
  return Object.freeze({ jsonHashSha256: jsonPlan.manifest.sourceHashSha256, adminApiHashSha256: apiPlan.manifest.sourceHashSha256, countsMatch: true as const })
}
