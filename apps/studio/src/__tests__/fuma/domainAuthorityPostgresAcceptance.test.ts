import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { domainContractAuthorityV2Migration } from '../../../server/fuma/db/migrations/000062_domain_contract_authority_v2'
import { customerCredentialAuthority, type DomainScope } from '../../../server/fuma/domains/contracts'
import { AesGcmDomainSecretCipher } from '../../../server/fuma/domains/credentialCipher'
import { FakeDomainCredentialProvider } from '../../../server/fuma/domains/fakes'
import { NoopDomainCommercialAuthority } from '../../../server/fuma/domains/memory'
import { PostgresDomainRepository } from '../../../server/fuma/domains/postgres'
import { importDomainCredentialKeyring } from '../../../server/fuma/domains/runtime'
import { DomainService } from '../../../server/fuma/domains/service'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const T0 = '2026-08-04T00:00:00.000Z'
const scope: DomainScope = Object.freeze({
  platformId: 'fuma',
  organizationId: 'org-domain-postgres',
  workspaceId: 'workspace-domain-postgres',
  siteId: 'site-domain-postgres',
  ownerKey: 'owner-domain-postgres',
  generation: 1,
  state: 'active',
  transferFence: null,
  profileId: 'website',
})

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-059 optional live PostgreSQL domain authority', () => {
  it.skipIf(postgresUrl === undefined)(
    'persists fenced state, append-only credential history, retry receipts, and exact owner isolation',
    async () => {
      if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_domains_${process.pid}_${Date.now()}`
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
      const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
      try {
        await db.unsafe(domainContractAuthorityV2Migration.sql)
        const keys = await importDomainCredentialKeyring({
          activeKeyId: 'domain-key-v1',
          keys: [{ keyId: 'domain-key-v1', bytes: new Uint8Array(32).fill(9) }],
        })
        const provider = new FakeDomainCredentialProvider()
        let now = new Date(T0)
        const repository = new PostgresDomainRepository(db)
        const service = new DomainService({
          repository,
          cipher: new AesGcmDomainSecretCipher(keys),
          commercial: new NoopDomainCommercialAuthority(),
          provider,
          now: () => now,
        })
        const authority = customerCredentialAuthority(scope)
        await Promise.all([1, 2].map(() => service.storeCredential({
          credentialId: 'credential-postgres',
          authority,
          plaintext: new TextEncoder().encode('initial-domain-secret'),
          createdAt: T0,
        })))
        await service.create(scope, {
          domainId: 'domain-postgres',
          hostname: 'www.example.co.ke',
          kind: 'customer-dns',
          credentialId: 'credential-postgres',
          requestedAt: T0,
        })
        await service.transition(scope, {
          operationId: 'transition-postgres',
          domainId: 'domain-postgres',
          expectedVersion: 1,
          expectedFence: 1,
          desired: 'validating',
          observed: 'dns-pending',
          certificate: 'provisioning',
          actorId: 'actor-postgres',
          reasonCode: 'validation-requested',
          occurredAt: '2026-08-04T00:01:00.000Z',
        })
        expect(await new PostgresDomainRepository(db).exact(scope, 'domain-postgres')).toMatchObject({
          desired: 'validating',
          observed: 'dns-pending',
          certificate: 'provisioning',
          version: 2,
          operationFence: 2,
        })
        expect(await service.list({ ...scope, organizationId: 'org-foreign' })).toEqual([])

        const rotation = {
          credentialId: 'credential-postgres',
          authority,
          expectedVersion: 1,
          expectedFence: 1,
          replacementPlaintext: new TextEncoder().encode('rotated-domain-secret'),
          rotatedAt: '2026-08-04T00:02:00.000Z',
        }
        const contenders = await Promise.allSettled([
          service.rotateCredential(rotation),
          service.rotateCredential(rotation),
        ])
        expect(contenders.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
        expect(contenders.filter(({ status }) => status === 'rejected')).toHaveLength(1)

        const rotatedSecret = new TextEncoder().encode('rotated-domain-secret')
        provider.authorize({
          authority,
          hostname: 'www.example.co.ke',
          action: 'read-provider-status',
          secret: rotatedSecret,
          failAttempts: 1,
        })
        const operation = {
          operationId: 'provider-operation-postgres',
          idempotencyKey: 'domain:postgres:status',
          ...scope,
          domainId: 'domain-postgres',
          credentialId: 'credential-postgres',
          action: 'read-provider-status' as const,
          expectedDomainVersion: 2,
          expectedDomainFence: 2,
          expectedCredentialVersion: 2,
          expectedCredentialFence: 2,
          requestedAt: T0,
        }
        await expect(service.operate(scope, operation)).rejects.toMatchObject({ code: 'provider' })
        now = new Date('2026-08-04T00:03:00.000Z')
        await expect(service.operate(scope, operation)).resolves.toMatchObject({ status: 'authorized' })
        await expect(service.operate(scope, operation)).resolves.toMatchObject({ status: 'authorized' })
        expect(provider.calls).toHaveLength(2)

        await service.revokeCredential({
          credentialId: 'credential-postgres',
          authority,
          expectedVersion: 2,
          expectedFence: 2,
          revokedAt: '2026-08-04T00:04:00.000Z',
        })
        expect(await service.exact(scope, 'domain-postgres')).toMatchObject({ credential: null })

        const versions = await db.unsafe<{ count: number | string }>('select count(*)::int count from fuma_domain_credential_versions_v2')
        const transitions = await db.unsafe<{ count: number | string }>('select count(*)::int count from fuma_domain_transitions_v2')
        const receipt = await db.unsafe<{ state: string; attempt: number }>("select state,attempt from fuma_domain_provider_operations_v2 where idempotency_key='domain:postgres:status'")
        expect(Number(versions.rows[0]?.count)).toBe(3)
        expect(Number(transitions.rows[0]?.count)).toBe(1)
        expect(receipt.rows).toEqual([{ state: 'succeeded', attempt: 2 }])
        await expect(db.unsafe("update fuma_domain_transitions_v2 set reason_code='tampered'"))
          .rejects.toThrow('domain evidence is immutable')
        await expect(db.unsafe("delete from fuma_domain_credential_versions_v2 where credential_version=1"))
          .rejects.toThrow('domain evidence is immutable')
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
      }
    },
    30_000,
  )
})
