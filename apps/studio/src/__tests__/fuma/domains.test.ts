import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  CERTIFICATE_STATES,
  DOMAIN_DESIRED_STATES,
  DOMAIN_OBSERVED_STATES,
  DomainCredentialAuthoritySchema,
  DomainRecordSchema,
  customerCredentialAuthority,
  normalizeDomainHostname,
  platformCredentialAuthority,
  type DomainScope,
} from '../../../server/fuma/domains/contracts'
import { AesGcmDomainSecretCipher } from '../../../server/fuma/domains/credentialCipher'
import { DomainCommercialIntegration } from '../../../server/fuma/domains/commercial'
import {
  FakeDomainClock,
  FakeDomainCredentialKeyAuthority,
  FakeDomainCredentialProvider,
  deterministicDomainIvSource,
} from '../../../server/fuma/domains/fakes'
import { DomainError, DomainService, assertDomainState } from '../../../server/fuma/domains/service'
import { MemoryDomainRepository, NoopDomainCommercialAuthority } from '../../../server/fuma/domains/memory'

const HASH = 'a'.repeat(64)
const T0 = '2026-07-28T00:00:00.000Z'
const scope = (suffix = 'a'): DomainScope => Object.freeze({
  platformId: 'fuma', organizationId: `org-${suffix}`, workspaceId: `workspace-${suffix}`,
  siteId: `site-${suffix}`, ownerKey: `owner-${suffix}`, generation: 1,
  state: 'active' as const, transferFence: null, profileId: 'website',
})

async function harness() {
  const keys = await FakeDomainCredentialKeyAuthority.create()
  const cipher = new AesGcmDomainSecretCipher(keys, { randomBytes: deterministicDomainIvSource() })
  const repository = new MemoryDomainRepository()
  const provider = new FakeDomainCredentialProvider()
  const clock = new FakeDomainClock(T0)
  const service = new DomainService({ repository, cipher, provider, commercial: new NoopDomainCommercialAuthority(), now: clock.now })
  return { cipher, repository, provider, clock, service }
}

async function storeCustomerCredential(service: DomainService, domainScope: DomainScope, credentialId = 'credential-customer') {
  const secret = new TextEncoder().encode('customer-fixture-secret')
  await service.storeCredential({ credentialId, authority: customerCredentialAuthority(domainScope), plaintext: secret, createdAt: T0 })
  return secret
}

async function storePlatformCredential(service: DomainService, credentialId = 'credential-platform') {
  const secret = new TextEncoder().encode('platform-fixture-secret')
  await service.storeCredential({ credentialId, authority: platformCredentialAuthority('fuma'), plaintext: secret, createdAt: T0 })
  return secret
}

describe('FUMA-059 strict domain contracts', () => {
  it('normalizes Unicode hostnames to one stable ASCII identity', () => {
    expect(normalizeDomainHostname(' BÜCHER.example. ')).toEqual({
      hostname: 'xn--bcher-kva.example', unicodeHostname: 'bücher.example',
    })
    expect(normalizeDomainHostname('xn--bcher-kva.example')).toEqual({
      hostname: 'xn--bcher-kva.example', unicodeHostname: 'bücher.example',
    })
  })

  it.each([
    'https://example.com', 'user@example.com', '*.example.com', 'example.com:443',
    'example.com/path', '127.0.0.1', 'single-label', 'example..com', '\u0000.example.com',
  ])('rejects malformed host identity %s', (hostname) => {
    expect(() => normalizeDomainHostname(hostname)).toThrow()
  })

  it('publishes closed state vocabularies and rejects extra persistence fields', () => {
    expect(DOMAIN_DESIRED_STATES).toEqual(['detached', 'validating', 'active', 'suspended', 'deleted'])
    expect(DOMAIN_OBSERVED_STATES).toEqual(['unknown', 'dns-pending', 'dns-valid', 'tls-pending', 'active', 'degraded', 'detached', 'deleted'])
    expect(CERTIFICATE_STATES).toEqual(['none', 'provisioning', 'active', 'expiring', 'expired', 'failed', 'revoked'])
    const record = {
      ...scope(), domainId: 'domain-1', hostname: 'example.com', unicodeHostname: 'example.com',
      kind: 'customer-dns', desired: 'detached', observed: 'unknown', certificate: 'none',
      credentialId: null, version: 1, operationFence: 1, createdAt: T0, updatedAt: T0,
    }
    expect(Value.Check(DomainRecordSchema, record)).toBe(true)
    expect(Value.Check(DomainRecordSchema, { ...record, tenantSecret: 'forbidden' })).toBe(false)
  })

  it('keeps platform credentials tenantless and future customer automation fully scoped', () => {
    const platform = platformCredentialAuthority('fuma')
    const customer = customerCredentialAuthority(scope())
    expect(platform).toEqual({
      scope: 'fuma-platform', platformId: 'fuma', organizationId: null, workspaceId: null,
      siteId: null, ownerKey: null, ownerGeneration: null, profileId: null,
    })
    expect(customer).toMatchObject({
      scope: 'customer-automation', organizationId: 'org-a', workspaceId: 'workspace-a',
      siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 1, profileId: 'website',
    })
    expect(Value.Check(DomainCredentialAuthoritySchema, { ...platform, organizationId: 'org-a' })).toBe(false)
    expect(Value.Check(DomainCredentialAuthoritySchema, { ...customer, profileId: 'INVALID PROFILE' })).toBe(false)
  })

  it('enforces cross-state invariants independently of TypeBox shape', () => {
    const base = {
      ...scope(), domainId: 'domain-1', hostname: 'example.com', unicodeHostname: 'example.com',
      kind: 'customer-dns' as const, desired: 'detached' as const, observed: 'unknown' as const,
      certificate: 'none' as const, credentialId: null, version: 1, operationFence: 1,
      createdAt: T0, updatedAt: T0,
    }
    expect(() => assertDomainState({ ...base, desired: 'active', observed: 'active', certificate: 'none' })).toThrow(DomainError)
    expect(() => assertDomainState({ ...base, certificate: 'active' })).toThrow(DomainError)
    expect(() => assertDomainState({ ...base, desired: 'deleted', observed: 'deleted', certificate: 'active' })).toThrow(DomainError)
    expect(() => assertDomainState(base)).not.toThrow()
  })
})

describe('FUMA-059 state and credential integration', () => {
  it('records a fenced immutable desired/observed/certificate transition ledger', async () => {
    const { repository, service } = await harness()
    const domainScope = scope()
    await service.create(domainScope, { domainId: 'domain-1', hostname: 'example.com', kind: 'customer-dns', credentialId: null, requestedAt: T0 })
    const validating = await service.transition(domainScope, {
      operationId: 'transition-1', domainId: 'domain-1', expectedVersion: 1, expectedFence: 1,
      desired: 'validating', observed: 'dns-pending', certificate: 'none', actorId: 'actor-1',
      reasonCode: 'validation-requested', occurredAt: '2026-07-28T00:01:00.000Z',
    })
    expect(validating).toMatchObject({ desired: 'validating', observed: 'dns-pending', certificate: 'none', version: 2 })
    const replay = await service.transition(domainScope, {
      operationId: 'transition-1', domainId: 'domain-1', expectedVersion: 1, expectedFence: 1,
      desired: 'validating', observed: 'dns-pending', certificate: 'none', actorId: 'actor-1',
      reasonCode: 'validation-requested', occurredAt: '2026-07-28T00:01:00.000Z',
    })
    expect(replay).toEqual(validating)
    expect(repository.transitions).toHaveLength(1)
    expect(repository.transitions[0]).toMatchObject({ fromDesired: 'detached', toDesired: 'validating', fromFence: 1, toFence: 2 })
    expect(repository.transitions[0]?.evidenceSha256).toHaveLength(64)
  })

  it('advances DNS, certificate, routing, and suspension ledgers but denies illegal shortcuts', async () => {
    const { service } = await harness()
    const domainScope = scope('ledger')
    await service.create(domainScope, {
      domainId: 'domain-ledger', hostname: 'ledger.example', kind: 'customer-dns', credentialId: null, requestedAt: T0,
    })
    await expect(service.transition(domainScope, {
      operationId: 'illegal-shortcut', domainId: 'domain-ledger', expectedVersion: 1, expectedFence: 1,
      desired: 'active', observed: 'active', certificate: 'active', actorId: 'actor-1',
      reasonCode: 'illegal-shortcut', occurredAt: '2026-07-28T00:01:00.000Z',
    })).rejects.toMatchObject({ code: 'transition' })
    await expect(service.transition(domainScope, {
      operationId: 'begin-validation', domainId: 'domain-ledger', expectedVersion: 1, expectedFence: 1,
      desired: 'validating', observed: 'dns-pending', certificate: 'provisioning', actorId: 'actor-1',
      reasonCode: 'validation-requested', occurredAt: '2026-07-28T00:02:00.000Z',
    })).resolves.toMatchObject({ desired: 'validating', observed: 'dns-pending', certificate: 'provisioning', version: 2 })
    await expect(service.transition(domainScope, {
      operationId: 'ownership-valid', domainId: 'domain-ledger', expectedVersion: 2, expectedFence: 2,
      desired: 'active', observed: 'dns-valid', certificate: 'active', actorId: 'actor-1',
      reasonCode: 'ownership-valid', occurredAt: '2026-07-28T00:03:00.000Z',
    })).resolves.toMatchObject({ desired: 'active', observed: 'dns-valid', certificate: 'active', version: 3 })
    await expect(service.transition(domainScope, {
      operationId: 'routing-active', domainId: 'domain-ledger', expectedVersion: 3, expectedFence: 3,
      desired: 'active', observed: 'active', certificate: 'active', actorId: 'actor-1',
      reasonCode: 'routing-active', occurredAt: '2026-07-28T00:04:00.000Z',
    })).resolves.toMatchObject({ desired: 'active', observed: 'active', certificate: 'active', version: 4 })
    await expect(service.transition(domainScope, {
      operationId: 'suspend-domain', domainId: 'domain-ledger', expectedVersion: 4, expectedFence: 4,
      desired: 'suspended', observed: 'degraded', certificate: 'expiring', actorId: 'actor-1',
      reasonCode: 'suspended', occurredAt: '2026-07-28T00:05:00.000Z',
    })).resolves.toMatchObject({ desired: 'suspended', observed: 'degraded', certificate: 'expiring', version: 5 })
  })

  it('operates platform and future customer credentials only on matching records', async () => {
    const { provider, service } = await harness()
    const platformSecret = await storePlatformCredential(service)
    const customerScope = scope('customer')
    const customerSecret = await storeCustomerCredential(service, customerScope)
    await service.create(scope('platform'), {
      domainId: 'platform-domain', hostname: 'managed.example', kind: 'fuma-registered',
      credentialId: 'credential-platform', requestedAt: T0,
    })
    await service.create(customerScope, {
      domainId: 'customer-domain', hostname: 'customer.example', kind: 'customer-dns',
      credentialId: 'credential-customer', requestedAt: T0,
    })
    provider.authorize({ authority: platformCredentialAuthority('fuma'), hostname: 'managed.example', action: 'read-provider-status', secret: platformSecret })
    provider.authorize({ authority: customerCredentialAuthority(customerScope), hostname: 'customer.example', action: 'read-provider-status', secret: customerSecret })

    await expect(service.operate(scope('platform'), {
      operationId: 'operation-platform', idempotencyKey: 'domain:platform:status', ...scope('platform'),
      domainId: 'platform-domain', credentialId: 'credential-platform', action: 'read-provider-status',
      expectedDomainVersion: 1, expectedDomainFence: 1, expectedCredentialVersion: 1,
      expectedCredentialFence: 1, requestedAt: T0,
    })).resolves.toMatchObject({ status: 'authorized' })
    await expect(service.operate(customerScope, {
      operationId: 'operation-customer', idempotencyKey: 'domain:customer:status', ...customerScope,
      domainId: 'customer-domain', credentialId: 'credential-customer', action: 'read-provider-status',
      expectedDomainVersion: 1, expectedDomainFence: 1, expectedCredentialVersion: 1,
      expectedCredentialFence: 1, requestedAt: T0,
    })).resolves.toMatchObject({ status: 'authorized' })
    expect(provider.calls.map(({ credentialScope }) => credentialScope)).toEqual(['fuma-platform', 'customer-automation'])

    await expect(service.operate(scope('platform'), {
      operationId: 'operation-crossed', idempotencyKey: 'domain:crossed:status', ...scope('platform'),
      domainId: 'platform-domain', credentialId: 'credential-customer', action: 'read-provider-status',
      expectedDomainVersion: 1, expectedDomainFence: 1, expectedCredentialVersion: 1,
      expectedCredentialFence: 1, requestedAt: T0,
    })).rejects.toMatchObject({ code: 'stale' })
  })

  it('bridges entitlement, finite quota reservation, settlement, and hostname metering', async () => {
    const calls: Array<readonly [string, unknown]> = []
    const commercial = new DomainCommercialIntegration({
      entitlements: { async evaluate(organizationId: string) { calls.push(['evaluate', organizationId]); return { source: 'platform-internal', quotas: { customDomains: 2 } } as never } },
      quotas: {
        async admit(input: unknown) { calls.push(['admit', input]); return {} as never },
        async settleReservation(input: unknown) { calls.push(['settle', input]); return { duplicate: false } },
        async releaseReservation(input: string) { calls.push(['release', input]); return { duplicate: false } },
      },
      metering: { async adjust(input: unknown) { calls.push(['meter', input]); return {} as never } },
    })
    const command = { domainId: 'domain-commercial', hostname: 'example.com', kind: 'customer-dns' as const, credentialId: null, requestedAt: T0 }
    await commercial.admitCreate(scope(), command)
    await commercial.commitCreate(scope(), command)
    expect(calls.find(([name]) => name === 'admit')?.[1]).toMatchObject({ quotaClass: 'customDomains', units: 1, operation: 'domain' })
    expect(calls.find(([name]) => name === 'meter')?.[1]).toMatchObject({ meter: 'custom_hostnames', logicalUnits: 1, physicalUnits: 1, internalWorkload: true })
    expect(JSON.stringify(calls)).not.toContain(HASH)
  })
})
