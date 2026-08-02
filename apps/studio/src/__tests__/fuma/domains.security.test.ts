import { describe, expect, it } from 'bun:test'
import { AesGcmDomainSecretCipher } from '../../../server/fuma/domains/credentialCipher'
import { customerCredentialAuthority, type DomainCredentialEnvelope, type DomainScope } from '../../../server/fuma/domains/contracts'
import { deterministicDomainIvSource, FakeDomainCredentialKeyAuthority, FakeDomainCredentialProvider } from '../../../server/fuma/domains/fakes'
import { DomainService } from '../../../server/fuma/domains/service'
import { MemoryDomainRepository, NoopDomainCommercialAuthority } from '../../../server/fuma/domains/memory'

const T0 = '2026-07-28T00:00:00.000Z'
const scope = (suffix: string): DomainScope => Object.freeze({
  platformId: 'fuma', organizationId: `org-${suffix}`, workspaceId: `workspace-${suffix}`,
  siteId: `site-${suffix}`, ownerKey: `owner-${suffix}`, generation: 1,
  state: 'active' as const, transferFence: null, profileId: 'website',
})

async function setup() {
  const cipher = new AesGcmDomainSecretCipher(await FakeDomainCredentialKeyAuthority.create(), {
    randomBytes: deterministicDomainIvSource(40),
  })
  const repository = new MemoryDomainRepository()
  const service = new DomainService({
    repository, cipher, commercial: new NoopDomainCommercialAuthority(),
    provider: new FakeDomainCredentialProvider(), now: () => new Date(T0),
  })
  return { cipher, repository, service }
}

describe('FUMA-059 credential security', () => {
  it('persists authenticated ciphertext only and returns a redacted projection', async () => {
    const { repository, service } = await setup()
    const tenantScope = scope('a')
    const plaintext = new TextEncoder().encode('never-persist-this-provider-secret')
    const redacted = await service.storeCredential({
      credentialId: 'credential-1', authority: customerCredentialAuthority(tenantScope), plaintext,
      createdAt: T0,
    })
    const persisted = [...repository.credentials.values()][0]
    expect(persisted).toBeDefined()
    expect(JSON.stringify(persisted)).not.toContain('never-persist-this-provider-secret')
    expect(persisted?.ciphertext).toMatch(/^v1\./)
    expect(JSON.stringify(redacted)).not.toContain(persisted!.ciphertext)
    expect(redacted).toMatchObject({ credentialId: 'credential-1', secret: '[REDACTED]' })
    expect(Object.keys(redacted)).not.toContain('ciphertext')
    expect(Object.keys(redacted)).not.toContain('authority')
  })

  it('denies decryption under another tenant authority even with the same key and envelope', async () => {
    const { cipher, repository, service } = await setup()
    const first = scope('a')
    const second = scope('b')
    await service.storeCredential({
      credentialId: 'credential-1', authority: customerCredentialAuthority(first),
      plaintext: new TextEncoder().encode('authority-bound-secret'), createdAt: T0,
    })
    const envelope = [...repository.credentials.values()][0] as DomainCredentialEnvelope
    await expect(cipher.decrypt(customerCredentialAuthority(second), envelope)).rejects.toMatchObject({ code: 'decrypt-denied' })
    const final = envelope.ciphertext.at(-1)
    const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}${final === 'A' ? 'B' : 'A'}` }
    await expect(cipher.decrypt(customerCredentialAuthority(first), tampered)).rejects.toMatchObject({ code: 'decrypt-denied' })
  })

  it('keeps deterministic fake key material non-extractable', async () => {
    const keys = await FakeDomainCredentialKeyAuthority.create()
    const current = await keys.current()
    expect(current.key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', current.key)).rejects.toBeDefined()
  })

  it('does not expose foreign domains through exact or list projections', async () => {
    const { service } = await setup()
    await service.create(scope('a'), {
      domainId: 'same-id', hostname: 'a.example', kind: 'customer-dns', credentialId: null, requestedAt: T0,
    })
    expect(await service.exact(scope('b'), 'same-id')).toBeNull()
    expect(await service.list(scope('b'))).toEqual([])
    expect((await service.list(scope('a'))).map(({ hostname }) => hostname)).toEqual(['a.example'])
  })

  it('rejects a duplicate credential identity carrying different secret evidence', async () => {
    const { service } = await setup()
    const authority = customerCredentialAuthority(scope('a'))
    await service.storeCredential({ credentialId: 'credential-1', authority, plaintext: new TextEncoder().encode('first-secret'), createdAt: T0 })
    await expect(service.storeCredential({ credentialId: 'credential-1', authority, plaintext: new TextEncoder().encode('different-secret'), createdAt: T0 }))
      .rejects.toMatchObject({ code: 'secret' })
  })
})
