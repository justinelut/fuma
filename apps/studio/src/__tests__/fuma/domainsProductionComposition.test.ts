import { describe, expect, it } from 'bun:test'
import type { DbClient } from '../../../server/db/client'
import { customerCredentialAuthority, type DomainScope } from '../../../server/fuma/domains/contracts'
import { AesGcmDomainSecretCipher } from '../../../server/fuma/domains/credentialCipher'
import { FakeDomainCredentialProvider } from '../../../server/fuma/domains/fakes'
import {
  createHostedDomainRuntime,
  importDomainCredentialKeyring,
  readHostedDomainCredentialKeyring,
} from '../../../server/fuma/domains/runtime'

const scope: DomainScope = Object.freeze({
  platformId: 'fuma',
  organizationId: 'org-domain-runtime',
  workspaceId: 'workspace-domain-runtime',
  siteId: 'site-domain-runtime',
  ownerKey: 'owner-domain-runtime',
  generation: 1,
  state: 'active',
  transferFence: null,
  profileId: 'website',
})

function encoded(fill: number): string {
  return Buffer.from(new Uint8Array(32).fill(fill)).toString('base64url')
}

function inertPostgres(): DbClient {
  const unavailable = async () => { throw new Error('Database calls are not expected during composition.') }
  return Object.assign(unavailable, {
    unsafe: unavailable,
    transaction: unavailable,
    dialect: 'postgres' as const,
  }) as DbClient
}

describe('FUMA-059 production domain composition', () => {
  it('reads an explicit rotation-safe keyring without a default key or malformed fallback', () => {
    const keyring = readHostedDomainCredentialKeyring({
      FUMA_DOMAIN_CREDENTIAL_ACTIVE_KEY_ID: 'domain-key-v2',
      FUMA_DOMAIN_CREDENTIAL_KEYRING: JSON.stringify({
        'domain-key-v1': encoded(1),
        'domain-key-v2': encoded(2),
      }),
    })
    expect(keyring.activeKeyId).toBe('domain-key-v2')
    expect(keyring.keys.map(({ keyId }) => keyId)).toEqual(['domain-key-v1', 'domain-key-v2'])
    expect(() => readHostedDomainCredentialKeyring({})).toThrow()
    expect(() => readHostedDomainCredentialKeyring({
      FUMA_DOMAIN_CREDENTIAL_ACTIVE_KEY_ID: 'missing',
      FUMA_DOMAIN_CREDENTIAL_KEYRING: JSON.stringify({ current: encoded(3) }),
    })).toThrow()
  })

  it('retains historical decryption while selecting only the active non-extractable key for encryption', async () => {
    const first = await importDomainCredentialKeyring({
      activeKeyId: 'domain-key-v1',
      keys: [
        { keyId: 'domain-key-v1', bytes: new Uint8Array(32).fill(1) },
        { keyId: 'domain-key-v2', bytes: new Uint8Array(32).fill(2) },
      ],
    })
    const authority = customerCredentialAuthority(scope)
    const firstCipher = new AesGcmDomainSecretCipher(first, { randomBytes: () => new Uint8Array(12).fill(4) })
    const encrypted = await firstCipher.encrypt(authority, new TextEncoder().encode('retained-domain-secret'))
    expect(encrypted.keyId).toBe('domain-key-v1')

    const rotated = await importDomainCredentialKeyring({
      activeKeyId: 'domain-key-v2',
      keys: [
        { keyId: 'domain-key-v1', bytes: new Uint8Array(32).fill(1) },
        { keyId: 'domain-key-v2', bytes: new Uint8Array(32).fill(2) },
      ],
    })
    expect((await rotated.current()).keyId).toBe('domain-key-v2')
    await expect(crypto.subtle.exportKey('raw', (await rotated.current()).key)).rejects.toBeDefined()
    const decrypted = await new AesGcmDomainSecretCipher(rotated).decrypt(authority, {
      credentialId: 'credential-retained',
      authority,
      ...encrypted,
      algorithm: 'AES-256-GCM',
      fingerprintSha256: new Bun.CryptoHasher('sha256').update('retained-domain-secret').digest('hex'),
      state: 'active',
      version: 1,
      fence: 1,
      createdAt: '2026-08-04T00:00:00.000Z',
      rotatedAt: null,
      revokedAt: null,
      rotatedFrom: null,
    })
    expect(new TextDecoder().decode(decrypted)).toBe('retained-domain-secret')
    decrypted.fill(0)
  })

  it('builds the PostgreSQL/cipher/commercial/service graph without routes, jobs, or provider calls', async () => {
    const provider = new FakeDomainCredentialProvider()
    const runtime = await createHostedDomainRuntime({
      db: inertPostgres(),
      keyring: {
        activeKeyId: 'domain-key-v1',
        keys: [{ keyId: 'domain-key-v1', bytes: new Uint8Array(32).fill(7) }],
      },
      provider,
      entitlements: { async evaluate() { return { source: 'platform-internal', quotas: { customDomains: 1 } } as never } },
      quotas: {
        async admit() { return {} as never },
        async settleReservation() { return { duplicate: false } },
        async releaseReservation() { return { duplicate: false } },
      },
      metering: { async adjust() { return {} as never } },
    })
    expect(runtime.repository.constructor.name).toBe('PostgresDomainRepository')
    expect(runtime.service.constructor.name).toBe('DomainService')
    expect(runtime.cipher.constructor.name).toBe('AesGcmDomainSecretCipher')
    expect(Object.keys(runtime).toSorted()).toEqual(['cipher', 'commercial', 'keys', 'repository', 'service'])
    expect(provider.calls).toEqual([])
  })
})
