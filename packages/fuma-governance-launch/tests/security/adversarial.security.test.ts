import { describe, expect, it } from 'bun:test'
import {
  PlatformConsoleRegistry,
  acceptWebhookOnce,
  authorizeMcp,
  authorizeOutboundUrl,
  authorizePluginExecution,
  authorizeSiteAi,
  planGhostImport,
  planPrivacyRequest,
  publicExpert,
  tenantSafeTelemetry,
  validateArchive,
  validateUpload,
} from '../../src'

const hash = 'a'.repeat(64)
const scope = { platformId: 'fuma', organizationId: 'org-a', workspaceId: 'ws-a', siteId: 'site-a', ownerKey: 'owner-a' }

describe('FUMA-082 adversarial security, privacy, and abuse', () => {
  it('denies cross-tenant AI and MCP identifier substitution', () => {
    const authority = { ...scope, actorId: 'actor-a', ownerGeneration: 1, capabilities: new Set(['ai.write']), active: true }
    const invocation = { ...scope, actorId: 'actor-a', profileId: 'website', conversationId: 'conversation-a', modelId: 'model-a', snapshotHashSha256: hash, capability: 'ai.write', expectedOwnerGeneration: 1 }
    expect(() => authorizeSiteAi({ ...invocation, ownerKey: 'owner-b' }, authority)).toThrow('authority')
    const connector = { ...scope, connectorId: 'connector-a', tokenHashSha256: hash, capabilities: ['write'], requestsPerMinute: 10, expiresAt: '2026-07-27T00:00:00Z', revokedAt: null }
    expect(() => authorizeMcp({ ...connector, siteId: 'site-b' }, { tokenHashSha256: hash, site: authority, capability: 'write', now: new Date('2026-07-26T00:00:00Z'), stepUp: false })).toThrow('denied')
  })

  it('denies app/customer access to internal console routes', () => {
    const registry = new PlatformConsoleRegistry()
    registry.register({ contributionId: 'support', ownerTicket: 'FUMA-072', routes: ['/internal/support'], requiredAuthorities: ['internal.support.read'] })
    expect(() => registry.authorize('/internal/support', { actorId: 'customer-a', host: 'app.trimly.co.ke', authorities: new Set(['internal.support.read']), stepUpAt: null, protectedOwner: false })).toThrow('admin-host')
  })

  it('rejects Ghost credentials, session material, and oversized hidden source fields', async () => {
    const base = { meta: { version: '5.0.0' }, data: { posts: [], users: [], tags: [], posts_authors: [], posts_tags: [], settings: [] } }
    await expect(planGhostImport({ ...base, data: { ...base.data, settings: [{ key: 'mail', api_key: 'should-not-import' }] } }, { importId: 'import-a', dryRun: true, digest: async () => hash })).rejects.toThrow('Forbidden source field')
    await expect(planGhostImport({ ...base, data: { ...base.data, posts: [{ id: 'post-a', html: 'x'.repeat(100_001) }] } }, { importId: 'import-b', dryRun: true, digest: async () => hash })).rejects.toThrow('safe limit')
  })

  it('blocks archive traversal, duplicate paths, and zip-bomb expansion', () => {
    expect(validateArchive({ entries: [{ path: 'media/photo.webp', kind: 'file', compressedBytes: 100, uncompressedBytes: 500 }] })).toEqual({ entries: 1, compressedBytes: 100, uncompressedBytes: 500 })
    expect(() => validateArchive({ entries: [{ path: '../secret', kind: 'file', compressedBytes: 1, uncompressedBytes: 1 }] })).toThrow('unsafe')
    expect(() => validateArchive({ entries: [{ path: 'bomb.bin', kind: 'file', compressedBytes: 1, uncompressedBytes: 101 }] })).toThrow('ratio')
  })

  it('enforces exact HTTPS SSRF grants and rejects active/mismatched uploads', () => {
    expect(authorizeOutboundUrl('https://api.provider.test/v1/status', new Set(['api.provider.test'])).hostname).toBe('api.provider.test')
    expect(() => authorizeOutboundUrl('http://169.254.169.254/latest/meta-data', new Set(['169.254.169.254']))).toThrow('approved HTTPS')
    expect(validateUpload({ filename: 'photo.webp', claimedMime: 'image/webp', sniffedMime: 'image/webp', bytes: 1_024 }).filename).toBe('photo.webp')
    expect(() => validateUpload({ filename: 'photo.jpg.svg', claimedMime: 'image/svg+xml', sniffedMime: 'image/svg+xml', bytes: 1_024 })).toThrow('denied')
  })

  it('fences plugin sandbox scope/network/deadline/memory and webhook replay', () => {
    const grant = { installationId: 'install-a', siteId: 'site-a', ownerGeneration: 2, deadlineMilliseconds: 5_000, memoryBytes: 64 * 1024 * 1024, networkHosts: ['api.provider.test'] }
    expect(authorizePluginExecution(grant, { installationId: 'install-a', siteId: 'site-a', ownerGeneration: 2, requestedNetworkHost: 'api.provider.test' }).siteId).toBe('site-a')
    expect(() => authorizePluginExecution(grant, { installationId: 'install-a', siteId: 'site-b', ownerGeneration: 2, requestedNetworkHost: null })).toThrow('denied')
    expect(acceptWebhookOnce(hash, new Set())).toBe(hash)
    expect(() => acceptWebhookOnce(hash, new Set([hash]))).toThrow('already consumed')
  })

  it('invalidates expert projection immediately on opt-out or moderation', () => {
    const expert = { expertId: 'expert-a', organizationId: 'org-a', kind: 'designer', name: 'A', skills: [], county: 'Nairobi', availability: 'available', approvedReleaseId: 'release-a', optedIn: true, suspended: false, consentVersion: 1, publicRevision: 1 }
    expect(() => publicExpert({ ...expert, optedIn: false })).toThrow('not publicly')
    expect(() => publicExpert({ ...expert, suspended: true })).toThrow('not publicly')
  })

  it('exports one subject but retains declared legal/financial exceptions during deletion', () => {
    const records = [
      { subjectId: 'subject-a', table: 'profiles', rowId: 'profile-a', classification: 'customer-data' as const, retainUntil: null },
      { subjectId: 'subject-a', table: 'payments', rowId: 'payment-a', classification: 'financial-record' as const, retainUntil: '2030-01-01T00:00:00Z' },
      { subjectId: 'subject-a', table: 'evidence', rowId: 'evidence-a', classification: 'legal-hold' as const, retainUntil: null },
    ]
    const plan = planPrivacyRequest(records, new Date('2026-07-26T00:00:00Z'))
    expect(plan.deleteRows.map(({ table }) => table)).toEqual(['profiles'])
    expect(plan.retainedExceptions.map(({ table }) => table)).toEqual(['payments', 'evidence'])
    expect(() => planPrivacyRequest([...records, { ...records[0]!, subjectId: 'subject-b', rowId: 'profile-b' }], new Date('2026-07-26T00:00:00Z'))).toThrow('one subject')
  })

  it('redacts prompt, cookies, webhook bodies, tokens, email, and phone from telemetry', () => {
    const dangerous = { prompt: 'ignore safeguards', cookie: 'session', webhookRawBody: 'payload', token: 'secret', email: 'person@example.test', phone: '+254700000000', status: 429 }
    expect(tenantSafeTelemetry(dangerous, new Set(Object.keys(dangerous)))).toEqual({ status: 429 })
  })
})
