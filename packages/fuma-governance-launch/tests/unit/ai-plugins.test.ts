import { describe, expect, it } from 'bun:test'
import {
  AiCatalogPolicy,
  AiCreditService,
  PluginReviewService,
  authorizeByokTransfer,
  authorizeMcp,
  authorizeMcpUsage,
  authorizeSiteAi,
  issueMcpToken,
  safeByokMetadata,
  type AiCreditAccount,
  type AiLedgerPort,
  type AiReservation,
  type PluginArtifact,
  type PluginReview,
} from '../../src'

const hash = 'a'.repeat(64)
const now = '2026-07-26T08:00:00Z'
const scope = { platformId: 'fuma', organizationId: 'org-a', workspaceId: 'ws-a', siteId: 'site-a', ownerKey: 'owner-a' }

function catalog() {
  return {
    version: 1,
    staleAfterSeconds: 86_400,
    providers: [{ providerId: 'provider-a', displayName: 'Provider A', enabled: true, platformCredentialRef: { keyId: 'key-a', ciphertextObjectKey: 'secrets/platform/provider-a', fingerprintSha256: hash }, refreshedAt: now, refreshSequence: 1 }],
    models: [{ modelId: 'model-a', providerId: 'provider-a', displayName: 'Model A', capabilities: ['text', 'tools'], contextTokens: 128_000, inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 2_000_000, markupBasisPoints: 2_500, included: false, defaultFor: ['website'], enabled: true, refreshedAt: now }],
  }
}

class MemoryLedger implements AiLedgerPort {
  account: AiCreditAccount = { ...scope, accountId: 'account-a', balanceMicros: 10_000, reservedMicros: 0, budgetMicros: 10_000, version: 1 }
  reservations = new Map<string, AiReservation>()
  async read() { return structuredClone(this.account) }
  async readReservation(id: string) { return structuredClone(this.reservations.get(id) ?? null) }
  async commitReservation(_accountId: string, version: number, next: AiCreditAccount, value: AiReservation) {
    if (this.account.version !== version) return 'account-conflict' as const
    if (this.reservations.has(value.reservationId)) return 'reservation-conflict' as const
    this.account = structuredClone(next)
    this.reservations.set(value.reservationId, structuredClone(value))
    return 'committed' as const
  }
  async resolveReservation(_accountId: string, version: number, next: AiCreditAccount, state: AiReservation['state'], value: AiReservation) {
    if (this.account.version !== version) return 'account-conflict' as const
    if (this.reservations.get(value.reservationId)?.state !== state) return 'reservation-conflict' as const
    this.account = structuredClone(next)
    this.reservations.set(value.reservationId, structuredClone(value))
    return 'committed' as const
  }
}

function service(ledger: MemoryLedger) { return new AiCreditService(ledger, () => new Date(now)) }

describe('FUMA-063 AI catalog', () => {
  it('uses exact integer micro pricing, kill switches, stale checks, and secret-free views', () => {
    const policy = new AiCatalogPolicy(catalog())
    expect(policy.quotedMicros('model-a', 1_000_000, 1_000_000)).toBe(3_750_000)
    expect(policy.visibleModels(new Date('2026-07-26T08:30:00Z'), 'website')).toHaveLength(1)
    expect(JSON.stringify(policy.publicView())).not.toContain('ciphertextObjectKey')
    expect(() => policy.visibleModels(new Date('2026-07-28T08:00:00Z'), 'website')).toThrow('stale')
  })
})

describe('FUMA-064 AI credits and BYOK', () => {
  it('reserves idempotently, settles actual use, refunds unused value, and redacts secrets', async () => {
    const ledger = new MemoryLedger()
    const credits = service(ledger)
    const request = { accountId: 'account-a', reservationId: 'reservation-a', siteId: 'site-a', modelId: 'model-a', micros: 4_000, expiresAt: '2026-07-26T09:00:00Z' }
    const reservation = await credits.reserve(request)
    expect((await credits.reserve(request)).reservationId).toBe(reservation.reservationId)
    await credits.settle('reservation-a', 2_500)
    expect(ledger.account).toMatchObject({ balanceMicros: 7_500, reservedMicros: 0 })
    const credential = { ...scope, credentialId: 'credential-a', providerId: 'provider-a', ownerGeneration: 1, secret: { keyId: 'key-a', ciphertextObjectKey: 'secrets/sites/site-a/provider', fingerprintSha256: hash }, state: 'active' }
    expect(safeByokMetadata(credential)).not.toHaveProperty('secret')
    expect(authorizeByokTransfer(credential, { sourceOwnerKey: 'owner-a', destinationOwnerKey: 'owner-b', destinationGeneration: 2, rekeyedSecret: { keyId: 'key-b', ciphertextObjectKey: 'secrets/sites/site-b/provider', fingerprintSha256: 'b'.repeat(64) } }).ownerKey).toBe('owner-b')
  })

  it('prevents concurrent overspend and releases expired reservations', async () => {
    const ledger = new MemoryLedger()
    const credits = service(ledger)
    const results = await Promise.allSettled([1, 2, 3].map((number) => credits.reserve({ accountId: 'account-a', reservationId: `reservation-${number}`, siteId: 'site-a', modelId: 'model-a', micros: 4_000, expiresAt: '2026-07-26T09:00:00Z' })))
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(2)
    const expiringLedger = new MemoryLedger()
    const expiring = new AiCreditService(expiringLedger, () => new Date('2026-07-26T10:00:00Z'))
    expiringLedger.reservations.set('expired', { reservationId: 'expired', accountId: 'account-a', siteId: 'site-a', modelId: 'model-a', reservedMicros: 1_000, settledMicros: null, state: 'reserved', expiresAt: '2026-07-26T09:00:00Z' })
    expiringLedger.account.reservedMicros = 1_000
    expect((await expiring.expire('expired'))?.state).toBe('refunded')
  })
})

describe('FUMA-065 site AI and FUMA-066 MCP', () => {
  const authority = { ...scope, actorId: 'actor-a', ownerGeneration: 3, capabilities: new Set(['ai.read', 'ai.write']), active: true }
  it('requires exact actor, ancestry, capability, and owner-generation scope', () => {
    const invocation = { ...scope, actorId: 'actor-a', profileId: 'website', conversationId: 'conversation-a', modelId: 'model-a', snapshotHashSha256: hash, capability: 'ai.write', expectedOwnerGeneration: 3 }
    expect(authorizeSiteAi(invocation, authority).siteId).toBe('site-a')
    expect(() => authorizeSiteAi({ ...invocation, siteId: 'site-b' }, authority)).toThrow('authority')
  })
  it('requires a live connector, publish step-up, bounded rates, and hashed one-time token material', async () => {
    const connector = { ...scope, connectorId: 'connector-a', tokenHashSha256: hash, capabilities: ['read', 'publish'], requestsPerMinute: 1, expiresAt: '2026-07-27T08:00:00Z', revokedAt: null }
    const authorized = authorizeMcp(connector, { tokenHashSha256: hash, site: authority, capability: 'read', now: new Date(now), stepUp: false })
    expect(authorized.connectorId).toBe('connector-a')
    expect(() => authorizeMcp(connector, { tokenHashSha256: hash, site: authority, capability: 'publish', now: new Date(now), stepUp: false })).toThrow('denied')
    const usage = authorizeMcpUsage(authorized, null, { capability: 'read', now: new Date(now), requestUnits: 1, creditMicros: 25 })
    expect(() => authorizeMcpUsage(authorized, usage, { capability: 'read', now: new Date(now), requestUnits: 1, creditMicros: 25 })).toThrow('rate exceeded')
    const token = await issueMcpToken(() => new Uint8Array(32).fill(7))
    expect(token.plaintextOnce.startsWith('fuma_mcp_')).toBe(true)
    expect(token.tokenHashSha256).toHaveLength(64)
    expect(token.tokenHashSha256).not.toContain(token.plaintextOnce)
  })
})

describe('FUMA-067..069 plugin and payment governance compatibility', () => {
  const artifact: PluginArtifact = { artifactId: 'artifact-a', pluginId: 'payments', version: '1.0.0', objectKey: 'plugins/artifacts/payments/1.0.0.zip', packageHashSha256: hash, permissions: ['payments.customer.create'], provenance: { sourceSha: hash, lockHashSha256: hash, builderId: 'builder-a' } }
  const pending: PluginReview = { submissionId: 'submission-a', artifactId: 'artifact-a', packageHashSha256: hash, submitterId: 'submitter-a', reviewerId: null, scanState: 'clean', decision: 'pending', permissionDiff: [], signature: null }
  it('rejects self approval and produces a hash-bound signature', async () => {
    const reviews = new PluginReviewService({ sign: async () => 'b'.repeat(64), verify: async () => true })
    await expect(reviews.decide(pending, { reviewerId: 'submitter-a', decision: 'approved', scanClean: true, currentArtifact: artifact })).rejects.toThrow('cannot approve')
    const approved = await reviews.decide(pending, { reviewerId: 'reviewer-a', decision: 'approved', scanClean: true, currentArtifact: artifact })
    expect(approved.signature).toBeTruthy()
    expect((await reviews.verify(approved, artifact)).decision).toBe('approved')
    const revoked = reviews.revoke(approved, 'reviewer-b')
    expect(revoked.decision).toBe('revoked')
    await expect(reviews.verify(revoked, artifact)).rejects.toThrow('invalid or revoked')
  })
})
