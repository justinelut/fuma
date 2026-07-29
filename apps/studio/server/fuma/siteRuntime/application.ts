import { createHash } from 'node:crypto'
import type { RuntimeRouteArtifact } from '../publishing/runtimeTree/contracts'
import type { SiteRuntimeAudience, SiteRuntimeCacheIdentity } from './contracts'
import {
  SiteApplicationError,
  SiteApplicationMutationRequestSchema,
  SiteApplicationMutationResponseSchema,
  SiteApplicationSnapshotSchema,
  SiteRuntimeLegacyDocumentSchema,
  SiteRuntimeRolloutPolicySchema,
  emptyApplicationSnapshot,
  parseSiteApplicationContract,
  publicApplicationMember,
  publicAudience,
  type SiteApplicationContext,
  type SiteApplicationMember,
  type SiteApplicationMutationRequest,
  type SiteApplicationMutationResponse,
  type SiteApplicationOperation,
  type SiteApplicationSnapshot,
  type SiteRuntimeDelivery,
  type SiteRuntimeLegacyDocument,
  type SiteRuntimeRolloutPolicy,
} from './applicationContracts'

export type SiteRuntimeExactBinding = Readonly<{
  host: string
  platformId: string
  organizationId: string
  workspaceId: string
  siteId: string
  ownerKey: string
  ownerGeneration: number
  releaseId: string
  releaseHashSha256: string
}>

export type SiteRuntimeMemberProjection = Readonly<{
  audience: SiteRuntimeAudience
  member: SiteApplicationMember
  snapshot: SiteApplicationSnapshot
}>

export interface SiteRuntimeMemberProjectionPort {
  resolve(input: Readonly<{ binding: SiteRuntimeExactBinding; memberSessionToken: string | null }>): Promise<SiteRuntimeMemberProjection>
}

export class AnonymousSiteRuntimeMemberProjection implements SiteRuntimeMemberProjectionPort {
  async resolve(): Promise<SiteRuntimeMemberProjection> {
    return Object.freeze({ audience: publicAudience(), member: publicApplicationMember(), snapshot: emptyApplicationSnapshot() })
  }
}

export interface SiteRuntimeRolloutRepository {
  get(binding: SiteRuntimeExactBinding, route: string): Promise<SiteRuntimeRolloutPolicy | null>
  put(binding: SiteRuntimeExactBinding, policy: SiteRuntimeRolloutPolicy, expectedVersion: number | null): Promise<boolean>
}

export interface SiteRuntimeLegacyReader {
  read(binding: SiteRuntimeExactBinding, releaseId: string, route: string): Promise<SiteRuntimeLegacyDocument>
}

export interface SiteRuntimeMutationAdapter {
  mutate(input: Readonly<{
    binding: SiteRuntimeExactBinding
    audience: SiteRuntimeAudience
    member: Extract<SiteApplicationMember, { authenticated: true }>
    operation: SiteApplicationOperation
  }>): Promise<SiteApplicationSnapshot>
}

export type SiteRuntimeMutationReceipt = Readonly<{
  binding: SiteRuntimeExactBinding
  memberId: string
  idempotencyKey: string
  requestHashSha256: string
  response: SiteApplicationMutationResponse
  createdAt: string
}>

export interface SiteRuntimeMutationReceiptRepository {
  get(binding: SiteRuntimeExactBinding, memberId: string, idempotencyKey: string): Promise<SiteRuntimeMutationReceipt | null>
  put(receipt: SiteRuntimeMutationReceipt): Promise<boolean>
}

export class UnavailableSiteRuntimeMutationAdapter implements SiteRuntimeMutationAdapter {
  async mutate(): Promise<SiteApplicationSnapshot> {
    throw new SiteApplicationError('unsupported', 'This site has no transactional adapter for the requested operation.')
  }
}

const DEFAULT_POLICY = (route: string): SiteRuntimeRolloutPolicy => Object.freeze({
  route, target: 'react', shadow: 'off', fallback: 'deny', legacyReleaseId: null, version: 1,
})

function sameBinding(left: SiteRuntimeExactBinding, right: SiteRuntimeExactBinding): boolean {
  return left.host === right.host && left.platformId === right.platformId && left.organizationId === right.organizationId
    && left.workspaceId === right.workspaceId && left.siteId === right.siteId && left.ownerKey === right.ownerKey
    && left.ownerGeneration === right.ownerGeneration && left.releaseId === right.releaseId
    && left.releaseHashSha256 === right.releaseHashSha256
}

function sameAudience(left: SiteRuntimeAudience, right: SiteRuntimeAudience): boolean {
  return left.kind === right.kind && left.memberId === right.memberId && left.accessFingerprintSha256 === right.accessFingerprintSha256
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record).toSorted().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function artifactSemanticHash(route: RuntimeRouteArtifact): string | null {
  return route.artifactReferences.find((artifact) => artifact.role === 'semantic-html' && artifact.logicalPath === route.route.semanticHtmlPath)?.contentHashSha256 ?? null
}

function safeLegacy(document: SiteRuntimeLegacyDocument): SiteRuntimeLegacyDocument {
  const parsed = parseSiteApplicationContract(SiteRuntimeLegacyDocumentSchema, document, 'legacy compatibility document') as SiteRuntimeLegacyDocument
  if (/<(?:base|iframe|object|embed|script)\b|<meta\b[^>]*http-equiv|\son[a-z]+\s*=|javascript:/i.test(parsed.html)) {
    throw new SiteApplicationError('legacy-unavailable', 'Legacy compatibility HTML contains authority-bearing markup.')
  }
  for (const script of parsed.scripts) {
    if (createHash('sha256').update(script.source, 'utf8').digest('hex') !== script.contentHashSha256
      || /\b(?:eval|Function|import\s*\(|WebSocket|EventSource)\s*\(/.test(script.source)) {
      throw new SiteApplicationError('legacy-unavailable', 'Legacy compatibility script failed integrity or capability policy.')
    }
  }
  return parsed
}

export class SiteRuntimeApplicationAuthority {
  readonly #members: SiteRuntimeMemberProjectionPort
  readonly #rollouts: SiteRuntimeRolloutRepository
  readonly #legacy: SiteRuntimeLegacyReader
  readonly #mutations: SiteRuntimeMutationAdapter
  readonly #receipts: SiteRuntimeMutationReceiptRepository
  readonly #now: () => Date

  constructor(input: Readonly<{
    members?: SiteRuntimeMemberProjectionPort
    rollouts: SiteRuntimeRolloutRepository
    legacy: SiteRuntimeLegacyReader
    mutations?: SiteRuntimeMutationAdapter
    receipts: SiteRuntimeMutationReceiptRepository
    now?: () => Date
  }>) {
    this.#members = input.members ?? new AnonymousSiteRuntimeMemberProjection()
    this.#rollouts = input.rollouts
    this.#legacy = input.legacy
    this.#mutations = input.mutations ?? new UnavailableSiteRuntimeMutationAdapter()
    this.#receipts = input.receipts
    this.#now = input.now ?? (() => new Date())
  }

  project(binding: SiteRuntimeExactBinding, memberSessionToken: string | null): Promise<SiteRuntimeMemberProjection> {
    return this.#members.resolve({ binding, memberSessionToken })
  }

  context(identity: SiteRuntimeCacheIdentity, projection: SiteRuntimeMemberProjection): SiteApplicationContext {
    const authenticated = projection.member.authenticated
    if ((identity.audience.kind === 'member') !== authenticated
      || (authenticated && (identity.audience.memberId !== projection.member.memberId || identity.audience.memberId === null))) {
      throw new SiteApplicationError('scope', 'Member projection does not match runtime audience authority.')
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      cacheIdentity: identity,
      member: projection.member,
      snapshot: projection.snapshot,
      cachePolicy: authenticated ? 'private' as const : 'public' as const,
    })
  }

  async policy(binding: SiteRuntimeExactBinding, route: string): Promise<SiteRuntimeRolloutPolicy> {
    return parseSiteApplicationContract(
      SiteRuntimeRolloutPolicySchema,
      await this.#rollouts.get(binding, route) ?? DEFAULT_POLICY(route),
      'site runtime rollout policy',
    ) as SiteRuntimeRolloutPolicy
  }

  async delivery(binding: SiteRuntimeExactBinding, route: RuntimeRouteArtifact, resolvedPolicy?: SiteRuntimeRolloutPolicy): Promise<SiteRuntimeDelivery> {
    const policy = resolvedPolicy ?? await this.policy(binding, route.route.route)
    if (policy.route !== route.route.route || ((policy.target === 'legacy' || policy.shadow === 'compare' || policy.fallback === 'legacy') && policy.legacyReleaseId === null)) {
      throw new SiteApplicationError('legacy-unavailable', 'Route rollout policy is incomplete.')
    }
    if (policy.legacyReleaseId === null) {
      return Object.freeze({ selected: 'react', reason: 'policy', policy, shadowParity: 'not-run', legacy: null })
    }
    const legacy = safeLegacy(await this.#legacy.read(binding, policy.legacyReleaseId, policy.route))
    if (legacy.releaseId !== policy.legacyReleaseId || legacy.route !== policy.route) throw new SiteApplicationError('legacy-unavailable', 'Legacy release binding changed.')
    if (policy.target === 'legacy') return Object.freeze({ selected: 'legacy', reason: 'policy', policy, shadowParity: 'not-run', legacy })
    const parity = policy.shadow === 'compare' && artifactSemanticHash(route) === legacy.contentHashSha256 ? 'matched' as const
      : policy.shadow === 'compare' ? 'mismatched' as const : 'not-run' as const
    if (parity === 'mismatched' && policy.fallback === 'legacy') {
      return Object.freeze({ selected: 'legacy', reason: 'shadow-mismatch-fallback', policy, shadowParity: parity, legacy })
    }
    if (parity === 'mismatched') throw new SiteApplicationError('legacy-unavailable', 'Shadow render parity failed without an authorized fallback.')
    return Object.freeze({ selected: 'react', reason: parity === 'matched' ? 'shadow-match' : 'policy', policy, shadowParity: parity, legacy: policy.fallback === 'legacy' ? legacy : null })
  }

  async mutate(binding: SiteRuntimeExactBinding, raw: unknown): Promise<SiteApplicationMutationResponse> {
    const request = parseSiteApplicationContract(SiteApplicationMutationRequestSchema, raw, 'site application mutation') as SiteApplicationMutationRequest
    const expectedBinding: SiteRuntimeExactBinding = Object.freeze({
      host: request.context.cacheIdentity.host,
      platformId: request.context.cacheIdentity.platformId,
      organizationId: request.context.cacheIdentity.organizationId,
      workspaceId: request.context.cacheIdentity.workspaceId,
      siteId: request.context.cacheIdentity.siteId,
      ownerKey: request.context.cacheIdentity.ownerKey,
      ownerGeneration: request.context.cacheIdentity.ownerGeneration,
      releaseId: request.context.cacheIdentity.releaseId,
      releaseHashSha256: request.context.cacheIdentity.releaseHashSha256,
    })
    if (request.host !== binding.host || !sameBinding(binding, expectedBinding)) throw new SiteApplicationError('scope', 'Mutation is not bound to the current exact host and release.')
    const issuedAt = Date.parse(request.operation.issuedAt)
    const now = this.#now().getTime()
    if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > 5 * 60_000) throw new SiteApplicationError('stale', 'Mutation freshness window expired.')
    const projection = await this.#members.resolve({ binding, memberSessionToken: request.memberSessionToken })
    if (!projection.member.authenticated || projection.audience.kind !== 'member') throw new SiteApplicationError('unauthenticated', 'Site-member authentication is required.')
    if (!sameAudience(projection.audience, request.context.cacheIdentity.audience)
      || request.context.member.authenticated !== true
      || projection.member.memberIdentityId !== request.context.member.memberIdentityId
      || projection.member.memberId !== request.context.member.memberId
      || projection.member.sessionId !== request.context.member.sessionId) {
      throw new SiteApplicationError('scope', 'Mutation member or access authority changed.')
    }
    const requestHashSha256 = digest({ context: request.context, operation: request.operation })
    const prior = await this.#receipts.get(binding, projection.member.memberId, request.operation.idempotencyKey)
    if (prior) {
      if (prior.requestHashSha256 !== requestHashSha256) throw new SiteApplicationError('replay', 'Idempotency evidence was replayed with a different mutation.')
      return parseSiteApplicationContract(SiteApplicationMutationResponseSchema, { ...prior.response, duplicate: true }, 'stored mutation response') as SiteApplicationMutationResponse
    }
    const snapshot = parseSiteApplicationContract(SiteApplicationSnapshotSchema, await this.#mutations.mutate({
      binding, audience: projection.audience, member: projection.member, operation: request.operation,
    }), 'transactional adapter snapshot') as SiteApplicationSnapshot
    if (snapshot.version <= request.operation.expectedVersion) throw new SiteApplicationError('stale', 'Transactional adapter did not advance the expected state version.')
    const response = parseSiteApplicationContract(SiteApplicationMutationResponseSchema, {
      accepted: true, duplicate: false, mutationId: request.operation.mutationId, snapshot,
    }, 'mutation response') as SiteApplicationMutationResponse
    const receipt: SiteRuntimeMutationReceipt = Object.freeze({
      binding, memberId: projection.member.memberId, idempotencyKey: request.operation.idempotencyKey,
      requestHashSha256, response, createdAt: this.#now().toISOString(),
    })
    if (!await this.#receipts.put(receipt)) {
      const raced = await this.#receipts.get(binding, projection.member.memberId, request.operation.idempotencyKey)
      if (!raced || raced.requestHashSha256 !== requestHashSha256) throw new SiteApplicationError('replay', 'Mutation receipt conflicted after execution.')
      return parseSiteApplicationContract(SiteApplicationMutationResponseSchema, { ...raced.response, duplicate: true }, 'raced mutation response') as SiteApplicationMutationResponse
    }
    return response
  }

  async setPolicy(binding: SiteRuntimeExactBinding, raw: unknown, expectedVersion: number | null): Promise<SiteRuntimeRolloutPolicy> {
    const policy = parseSiteApplicationContract(SiteRuntimeRolloutPolicySchema, raw, 'route rollout policy') as SiteRuntimeRolloutPolicy
    if ((expectedVersion === null && policy.version !== 1) || (expectedVersion !== null && policy.version !== expectedVersion + 1)) {
      throw new SiteApplicationError('stale', 'Route rollout policy version is stale.')
    }
    if ((policy.target === 'legacy' || policy.shadow === 'compare' || policy.fallback === 'legacy') && policy.legacyReleaseId === null) {
      throw new SiteApplicationError('legacy-unavailable', 'Legacy rollout requires an exact retained release.')
    }
    if (!await this.#rollouts.put(binding, policy, expectedVersion)) throw new SiteApplicationError('stale', 'Route rollout policy changed concurrently.')
    return policy
  }
}

export class MemorySiteRuntimeRolloutRepository implements SiteRuntimeRolloutRepository {
  readonly values = new Map<string, SiteRuntimeRolloutPolicy>()
  #key(binding: SiteRuntimeExactBinding, route: string) { return `${binding.platformId}:${binding.ownerKey}:${binding.ownerGeneration}:${binding.siteId}:${route}` }
  async get(binding: SiteRuntimeExactBinding, route: string) { return this.values.get(this.#key(binding, route)) ?? null }
  async put(binding: SiteRuntimeExactBinding, policy: SiteRuntimeRolloutPolicy, expectedVersion: number | null) {
    const key = this.#key(binding, policy.route)
    const prior = this.values.get(key)
    if ((prior?.version ?? null) !== expectedVersion) return false
    this.values.set(key, structuredClone(policy))
    return true
  }
}

export class MemorySiteRuntimeMutationReceiptRepository implements SiteRuntimeMutationReceiptRepository {
  readonly values = new Map<string, SiteRuntimeMutationReceipt>()
  #key(binding: SiteRuntimeExactBinding, memberId: string, idempotencyKey: string) { return `${binding.platformId}:${binding.ownerKey}:${binding.ownerGeneration}:${binding.siteId}:${memberId}:${idempotencyKey}` }
  async get(binding: SiteRuntimeExactBinding, memberId: string, idempotencyKey: string) { return structuredClone(this.values.get(this.#key(binding, memberId, idempotencyKey)) ?? null) }
  async put(receipt: SiteRuntimeMutationReceipt) {
    const key = this.#key(receipt.binding, receipt.memberId, receipt.idempotencyKey)
    if (this.values.has(key)) return false
    this.values.set(key, structuredClone(receipt))
    return true
  }
}
