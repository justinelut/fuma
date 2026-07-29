import { describe, expect, it } from 'bun:test'
import { AesGcmDomainSecretCipher } from '../../../server/fuma/domains/credentialCipher'
import { customerCredentialAuthority, type DomainScope } from '../../../server/fuma/domains/contracts'
import { deterministicDomainIvSource, FakeDomainClock, FakeDomainCredentialKeyAuthority, FakeDomainCredentialProvider } from '../../../server/fuma/domains/fakes'
import { DomainService } from '../../../server/fuma/domains/service'
import { MemoryDomainRepository, NoopDomainCommercialAuthority } from '../../../server/fuma/domains/memory'

const T0 = '2026-07-28T00:00:00.000Z'
const scope: DomainScope = Object.freeze({
  platformId: 'fuma', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a',
  ownerKey: 'owner-a', generation: 1, state: 'active', transferFence: null, profileId: 'website',
})

async function setup() {
  const repository = new MemoryDomainRepository()
  const provider = new FakeDomainCredentialProvider()
  const clock = new FakeDomainClock(T0)
  const service = new DomainService({
    repository,
    cipher: new AesGcmDomainSecretCipher(await FakeDomainCredentialKeyAuthority.create(), {
      randomBytes: deterministicDomainIvSource(80),
    }),
    commercial: new NoopDomainCommercialAuthority(), provider, now: clock.now,
  })
  const secret = new TextEncoder().encode('retry-fixture-secret')
  await service.storeCredential({ credentialId: 'credential-1', authority: customerCredentialAuthority(scope), plaintext: secret, createdAt: T0 })
  await service.create(scope, { domainId: 'domain-1', hostname: 'retry.example', kind: 'customer-dns', credentialId: 'credential-1', requestedAt: T0 })
  return { clock, provider, repository, secret, service }
}

function operation(operationId = 'operation-1') {
  return {
    operationId, idempotencyKey: 'domain:retry:status', ...scope, domainId: 'domain-1',
    credentialId: 'credential-1', action: 'read-provider-status' as const,
    expectedDomainVersion: 1, expectedDomainFence: 1, expectedCredentialVersion: 1,
    expectedCredentialFence: 1, requestedAt: T0,
  }
}

describe('FUMA-059 retry and fault state', () => {
  it('records retryable provider failure and converges under the same immutable command', async () => {
    const { clock, provider, repository, secret, service } = await setup()
    provider.authorize({
      authority: customerCredentialAuthority(scope), hostname: 'retry.example',
      action: 'read-provider-status', secret, failAttempts: 1,
    })
    await expect(service.operate(scope, operation())).rejects.toMatchObject({ code: 'provider' })
    expect(repository.operations.get('domain:retry:status')).toMatchObject({ state: 'retryable', attempt: 1 })
    clock.advance(1_000)
    await expect(service.operate(scope, operation())).resolves.toMatchObject({ status: 'authorized' })
    expect(repository.operations.get('domain:retry:status')).toMatchObject({ state: 'succeeded', attempt: 2 })
    await expect(service.operate(scope, operation())).resolves.toMatchObject({ status: 'authorized' })
    expect(provider.calls).toHaveLength(2)
  })

  it('denies changed retry evidence under one idempotency key', async () => {
    const { provider, secret, service } = await setup()
    provider.authorize({ authority: customerCredentialAuthority(scope), hostname: 'retry.example', action: 'read-provider-status', secret })
    await service.operate(scope, operation())
    await expect(service.operate(scope, { ...operation('operation-changed'), requestedAt: '2026-07-28T00:01:00.000Z' }))
      .rejects.toMatchObject({ code: 'stale' })
  })

  it('allows one concurrent credential rotation and rejects the stale contender', async () => {
    const { repository, service } = await setup()
    const command = {
      credentialId: 'credential-1', authority: customerCredentialAuthority(scope), expectedVersion: 1,
      expectedFence: 1, replacementPlaintext: new TextEncoder().encode('rotated-secret'),
      rotatedAt: '2026-07-28T00:05:00.000Z',
    }
    const results = await Promise.allSettled([service.rotateCredential(command), service.rotateCredential(command)])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(repository.credentialHistory).toHaveLength(2)
    expect(repository.credentialHistory[1]).toMatchObject({ version: 2, fence: 2, rotatedAt: command.rotatedAt })
  })

  it('makes revocation terminal and binds replay to exact version, fence, and time', async () => {
    const { service } = await setup()
    const command = {
      credentialId: 'credential-1', authority: customerCredentialAuthority(scope), expectedVersion: 1,
      expectedFence: 1, revokedAt: '2026-07-28T00:06:00.000Z',
    }
    await expect(service.revokeCredential(command)).resolves.toMatchObject({ state: 'revoked', version: 2, fence: 2 })
    await expect(service.revokeCredential(command)).resolves.toMatchObject({ state: 'revoked', version: 2, fence: 2 })
    await expect(service.revokeCredential({ ...command, revokedAt: '2026-07-28T00:07:00.000Z' })).rejects.toMatchObject({ code: 'stale' })
    await expect(service.rotateCredential({
      credentialId: 'credential-1', authority: customerCredentialAuthority(scope), expectedVersion: 2,
      expectedFence: 2, replacementPlaintext: new TextEncoder().encode('forbidden'), rotatedAt: '2026-07-28T00:08:00.000Z',
    })).rejects.toMatchObject({ code: 'revoked' })
  })

  it('allows one concurrent state transition under the same optimistic fence', async () => {
    const { repository, service } = await setup()
    const base = {
      domainId: 'domain-1', expectedVersion: 1, expectedFence: 1, desired: 'validating' as const,
      observed: 'dns-pending' as const, certificate: 'none' as const, actorId: 'actor-1',
      reasonCode: 'validation-requested', occurredAt: '2026-07-28T00:09:00.000Z',
    }
    const results = await Promise.allSettled([
      service.transition(scope, { ...base, operationId: 'transition-a' }),
      service.transition(scope, { ...base, operationId: 'transition-b' }),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(repository.transitions).toHaveLength(1)
  })
})
