import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { domainOperationsAuthorityMigration } from '../../../server/fuma/db/migrations/000067_domain_operations_authority'
import {
  AesGcmRegistrarAuthCodeVault,
  DeterministicAuthCodeDelivery,
  DeterministicAuthCodeKeys,
  DeterministicAutomationCredentials,
  DeterministicDetachPort,
  DeterministicDnsObserver,
  DeterministicRegistrarTransferProvider,
  DomainOperationsService,
  PostgresDomainOperationsRepository,
} from '../../../server/fuma/domainOperations'
import {
  capability,
  destination,
  prevalidation,
  scope,
} from './domainOperationsTestFixture'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-062 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'persists exact DNS settings, converges registrar transfer, and records explicit domain outcome',
    async () => {
      if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_domain_operations_${process.pid}_${Date.now()}`
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
      const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
      try {
        await db.unsafe(domainOperationsAuthorityMigration.sql)
        const repository = new PostgresDomainOperationsRepository(db)
        const dns = new DeterministicDnsObserver()
        const automation = new DeterministicAutomationCredentials()
        const registrar = new DeterministicRegistrarTransferProvider()
        const delivery = new DeterministicAuthCodeDelivery()
        const detach = new DeterministicDetachPort()
        let iv = 0
        const authCodes = new AesGcmRegistrarAuthCodeVault(
          new DeterministicAuthCodeKeys(),
          () => {
            const value = new Uint8Array(12)
            value[11] = ++iv
            return value
          },
        )
        const service = new DomainOperationsService({
          repository,
          dns,
          automation,
          registrar,
          delivery,
          detach,
          authCodes,
          now: () => new Date('2026-07-28T12:00:00.000Z'),
        })

        const settings = await service.onboardCustomerDns(scope, 'domain-a', prevalidation, capability)
        expect(settings).toMatchObject({
          authoritativeDnsRetainedByCustomer: true,
          customerCloudflareAccountRequired: false,
          customerCloudflareTokenRequired: false,
        })

        const command = () => ({
          transferOperationId: 'transfer-in-a',
          domainId: 'domain-a',
          hostname: 'www.example.co.ke',
          authCode: new TextEncoder().encode('AUTH-CODE-A'),
          authCodeExpiresAt: '2026-07-29T12:00:00.000Z',
        })
        const duplicates = await Promise.all(Array.from({ length: 8 }, async () => (
          await service.startInbound(scope, command())
        )))
        expect(new Set(duplicates.map(({ transferOperationId }) => transferOperationId)))
          .toEqual(new Set(['transfer-in-a']))

        await service.resume(scope, 'transfer-in-a')
        expect(registrar.inboundSubmissions).toBe(1)
        const submitted = await repository.registrarTransfer(scope, 'transfer-in-a')
        if (!submitted?.providerReference) throw new Error('Expected provider reference.')
        registrar.complete(submitted.providerReference, 'fuma')
        expect(await service.reconcile(scope, 'transfer-in-a')).toMatchObject({
          state: 'completed',
          ownership: 'fuma',
          renewalHandoff: 'fuma-managed',
        })

        const choice = await service.siteTransferChoice(scope, {
          transferId: 'site-transfer-a',
          domainId: 'domain-a',
          source: scope,
          destination,
          outcome: 'move-with-site',
          decidedAt: '2026-07-28T12:00:00.000Z',
        })
        expect(choice).toMatchObject({
          choice: { outcome: 'move-with-site' },
          automationCredentialMoved: false,
        })

        await db.unsafe("insert into fuma_domain_operation_evidence_v2 values ('evidence-a','domain-a','acceptance',repeat('a',64),'{}'::jsonb,now())")
        await expect(db.unsafe("update fuma_domain_operation_evidence_v2 set operation_kind='tampered' where evidence_id='evidence-a'"))
          .rejects.toThrow('domain operation evidence is immutable')
        const rows = await db.unsafe<{ count: number | string }>('select count(*)::int count from fuma_registrar_transfer_authority_v2')
        expect(Number(rows.rows[0]?.count)).toBe(1)
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
      }
    },
    30_000,
  )
})
