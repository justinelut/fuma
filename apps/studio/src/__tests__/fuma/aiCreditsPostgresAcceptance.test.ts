import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import type { TransferManifest } from '../../../server/fuma/transfers/contracts'
import { aiCreditsAuthorityMigration } from '../../../server/fuma/db/migrations/000066_ai_credits_authority'
import {
  AiCreditService,
  DeterministicAiByokMetadataCipher,
  PostgresAiByokTransferRepository,
  PostgresAiCreditRepository,
  createAiByokTransferStep,
  credentialAad,
} from '../../../server/fuma/aiCredits'
import {
  FixtureAiCatalog,
  aiCreditScope,
  grantCommand,
} from './aiCreditsTestFixture'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = new Date('2026-07-28T12:00:00.000Z')

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}
function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-064 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'persists fenced credit/settlement/refund/expiry and encrypted BYOK authority',
    async () => {
      if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_ai_credits_${process.pid}_${Date.now()}`
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
      const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
      try {
        await db.unsafe(aiCreditsAuthorityMigration.sql)
        const repository = new PostgresAiCreditRepository(db)
        let now = NOW
        const cipher = new DeterministicAiByokMetadataCipher('postgres-fixture-key')
        const service = new AiCreditService({
          repository,
          catalog: new FixtureAiCatalog(),
          cipher,
          now: () => now,
        })
        await service.grant(grantCommand({ amountMicros: 2_000_000 }))
        await service.purchase(grantCommand({
          lotId: 'purchase-a', amountMicros: 3_000_000, expiresAt: null,
          evidenceId: 'purchase-a', idempotencyKey: 'purchase-a',
        }))
        const account = (await repository.snapshot('account-a'))!.account
        const base = {
          accountId: 'account-a', scope: aiCreditScope,
          audience: {
            kind: 'customer' as const, platformId: 'fuma', organizationId: 'organization-a',
            workspaceId: 'workspace-a', siteId: 'site-a', profile: 'website' as const,
          },
          providerId: 'provider-a', modelId: 'paid-model',
          estimatedInputTokens: 1_000_000, estimatedOutputTokens: 1_000_000,
          mode: 'platform' as const, byokCredentialId: null,
          expiresAt: '2026-07-28T12:30:00.000Z', expectedAccountVersion: account.version,
        }
        const raced = await Promise.allSettled([
          service.reserve({ ...base, reservationId: 'reservation-a', idempotencyKey: 'reservation-a' }),
          service.reserve({ ...base, reservationId: 'reservation-b', idempotencyKey: 'reservation-b' }),
        ])
        expect(raced.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
        const reservation = raced.find(({ status }) => status === 'fulfilled')
        if (reservation?.status !== 'fulfilled') throw new Error('Expected one reservation.')
        const settled = await service.settle({
          reservationId: reservation.value.reservationId,
          inputTokens: 500_000,
          outputTokens: 500_000,
          idempotencyKey: 'settlement-a',
          expectedReservationVersion: 1,
        })
        expect(settled.chargedMicros).toBe(1_875_000)
        expect((await service.refund({
          reservationId: reservation.value.reservationId,
          idempotencyKey: 'refund-a',
          expectedReservationVersion: 2,
        })).refundedMicros).toBe(1_875_000)

        const expiringScope = Object.freeze({
          ...aiCreditScope,
          workspaceId: 'workspace-expiring',
          siteId: 'site-expiring',
          ownerKey: 'owner-expiring',
        })
        await service.grant(grantCommand({
          lotId: 'expiring-lot', accountId: 'expiring-account', scope: expiringScope,
          amountMicros: 1_000_000,
          budgetMicros: 1_000_000, expiresAt: '2026-07-28T12:10:00.000Z',
          evidenceId: 'expiring-lot', idempotencyKey: 'expiring-lot',
        }))
        const expiringAccount = (await repository.snapshot('expiring-account'))!.account
        await service.reserve({
          ...base,
          accountId: 'expiring-account', scope: expiringScope,
          audience: { ...base.audience, workspaceId: expiringScope.workspaceId, siteId: expiringScope.siteId },
          reservationId: 'expiring-reservation',
          estimatedInputTokens: 100, estimatedOutputTokens: 100,
          expiresAt: '2026-07-28T12:05:00.000Z',
          expectedAccountVersion: expiringAccount.version,
          idempotencyKey: 'expiring-reservation',
        })
        now = new Date('2026-07-28T12:15:00.000Z')
        expect(await service.expireDue()).toEqual([
          expect.objectContaining({ reservationId: 'expiring-reservation', state: 'expired' }),
        ])
        expect(await repository.snapshot('expiring-account')).toMatchObject({
          account: { balanceMicros: 0, reservedMicros: 0 },
          lots: [expect.objectContaining({ remainingMicros: 0 })],
        })

        await service.attachByok({
          credentialId: 'byok-a', scope: aiCreditScope, providerId: 'provider-a',
          existingCredentialId: 'native-secret-opaque', displayLabel: 'Primary', idempotencyKey: 'byok-a',
        })
        const snapshot = (await repository.snapshot('account-a'))!
        expect(JSON.stringify(snapshot.credentials)).not.toMatch(/native-secret-opaque|Primary/)
        expect(await service.view('account-a')).toMatchObject({
          balanceMicros: 5_000_000,
          credentials: [expect.objectContaining({ credentialId: 'byok-a', displayLabel: 'Primary' })],
        })

        const destinationScope = {
          ...aiCreditScope,
          organizationId: 'organization-b',
          workspaceId: 'workspace-b',
          ownerKey: 'owner-b',
          ownerGeneration: 2,
        }
        const transfers = new PostgresAiByokTransferRepository(db)
        const step = createAiByokTransferStep(transfers)
        for (const choice of ['rekey', 'detach'] as const) {
          const transferId = `postgres-${choice}`
          const manifest: TransferManifest = {
            schemaVersion: 1,
            transferId,
            source: {
              platformId: aiCreditScope.platformId,
              organizationId: aiCreditScope.organizationId,
              workspaceId: aiCreditScope.workspaceId,
              siteId: aiCreditScope.siteId,
            },
            destination: {
              platformId: destinationScope.platformId,
              organizationId: destinationScope.organizationId,
              workspaceId: destinationScope.workspaceId,
              siteId: destinationScope.siteId,
            },
            siteProfileId: 'website',
            siteCapabilityOverrides: { grant: [], revoke: [] },
            siteCapabilityIds: [],
            snapshotChecksum: 'a'.repeat(64),
            resources: ['site-record'],
            collaborators: [],
            capturedAt: now.toISOString(),
          }
          const rekeyedEnvelope = choice === 'rekey'
            ? await cipher.encrypt(
              { providerId: 'provider-a', existingCredentialId: 'native-secret-opaque', displayLabel: 'Rekeyed' },
              credentialAad('byok-a', destinationScope.ownerGeneration),
            )
            : null
          await transfers.recordChoice({
            transferId,
            credentialId: 'byok-a',
            choice,
            destinationScope,
            rekeyedEnvelope,
            recordedAt: now.toISOString(),
          })
          const saga = { transferId, lockId: `lock-${choice}`, fence: choice === 'rekey' ? 8 : 9 }
          const receipt = await step.apply({ manifest, saga, receipt: null })
          expect(await step.verify({ manifest, saga, receipt })).toEqual({ status: 'verified', receipt })
          expect(await repository.credential('byok-a')).toMatchObject({
            state: choice === 'rekey' ? 'active' : 'detached',
            scope: destinationScope,
          })
          expect(await step.compensate({ manifest, saga, receipt })).toMatchObject({ status: 'compensated' })
          expect(await repository.credential('byok-a')).toMatchObject({ state: 'active', scope: aiCreditScope })
        }
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
      }
    },
    30_000,
  )
})
