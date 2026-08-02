import { describe, expect, it } from 'bun:test'
import type { TransferManifest } from '../../../server/fuma/transfers/contracts'
import {
  AesGcmAiByokMetadataCipher,
  MemoryAiByokTransferRepository,
  aiCreditToolContext,
  createAiByokTransferStep,
  credentialAad,
  credentialAuditFact,
  importAiByokMetadataKey,
  reservationAuditFact,
  settlementAuditFact,
} from '../../../server/fuma/aiCredits'
import {
  aiCreditScope,
  createAiCreditFixture,
  grantCommand,
  reserveCommand,
} from './aiCreditsTestFixture'

const destinationScope = Object.freeze({
  ...aiCreditScope,
  organizationId: 'organization-b',
  workspaceId: 'workspace-b',
  ownerKey: 'owner-b',
  ownerGeneration: 2,
})
const manifest: TransferManifest = Object.freeze({
  schemaVersion: 1,
  transferId: 'transfer-a',
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
  capturedAt: '2026-07-28T12:00:00.000Z',
})
const saga = Object.freeze({ transferId: manifest.transferId, lockId: 'lock-a', fence: 7 })

describe('FUMA-064 AI credit and BYOK security', () => {
  it('requires non-extractable AES-GCM custody and authenticates owner-generation AAD', async () => {
    const cipher = await importAiByokMetadataKey(new Uint8Array(32).fill(7), 'kms-key-a')
    const plaintext = { providerId: 'provider-a', existingCredentialId: 'native-opaque-a', displayLabel: 'Primary' }
    const envelope = await cipher.encrypt(plaintext, credentialAad('byok-a', 1))
    expect(JSON.stringify(envelope)).not.toMatch(/native-opaque-a|Primary/)
    await expect(cipher.decrypt(envelope, credentialAad('byok-a', 1))).resolves.toEqual(plaintext)
    await expect(cipher.decrypt(envelope, credentialAad('byok-a', 2))).rejects.toThrow('authentication failed')

    const extractable = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
    expect(() => new AesGcmAiByokMetadataCipher('bad-key', extractable)).toThrow('non-extractable')
  })

  it('stores only encrypted credential metadata and keeps customer/audit/tool projections secret-free', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    const view = await fixture.service.attachByok({
      credentialId: 'byok-a', scope: aiCreditScope, providerId: 'provider-a',
      existingCredentialId: 'native-opaque-super-secret', displayLabel: 'Customer primary', idempotencyKey: 'byok-a',
    })
    expect(await fixture.service.attachByok({
      credentialId: 'byok-a', scope: aiCreditScope, providerId: 'provider-a',
      existingCredentialId: 'native-opaque-super-secret', displayLabel: 'Customer primary', idempotencyKey: 'byok-a',
    })).toEqual(view)
    const stored = (await fixture.repository.snapshot('account-a'))!.credentials[0]!
    expect(stored.envelope).toMatchObject({ algorithm: 'AES-GCM-256', keyId: 'fixture-kms-key' })
    expect(JSON.stringify(stored)).not.toMatch(/native-opaque-super-secret|Customer primary/)

    const reservation = await fixture.service.reserve(await reserveCommand(fixture, {
      mode: 'byok', byokCredentialId: 'byok-a', reservationId: 'byok-turn', idempotencyKey: 'byok-turn',
    }))
    const settlement = await fixture.service.settle({
      reservationId: reservation.reservationId, inputTokens: 100, outputTokens: 100,
      idempotencyKey: 'settle-byok-turn', expectedReservationVersion: 1,
    })
    const serialized = JSON.stringify({
      account: await fixture.service.view('account-a'),
      reservation: reservationAuditFact(reservation),
      settlement: settlementAuditFact(settlement),
      credential: credentialAuditFact(stored),
      tool: aiCreditToolContext(reservation),
    })
    expect(serialized).not.toMatch(/native-opaque|ciphertext|fingerprint|fixture-kms-key|ownerKey|envelope/i)
  })

  it('denies cross-ancestry and wrong-provider BYOK substitution', async () => {
    const fixture = createAiCreditFixture()
    await fixture.service.grant(grantCommand())
    await fixture.service.attachByok({
      credentialId: 'byok-a', scope: aiCreditScope, providerId: 'provider-a',
      existingCredentialId: 'native-a', displayLabel: 'Primary', idempotencyKey: 'byok-a',
    })
    await expect(fixture.service.reserve(await reserveCommand(fixture, {
      scope: { ...aiCreditScope, ownerGeneration: 2 },
      mode: 'byok',
      byokCredentialId: 'byok-a',
    }))).rejects.toMatchObject({ code: 'scope' })
    await expect(fixture.service.reserve(await reserveCommand(fixture, {
      providerId: 'provider-b',
      mode: 'byok',
      byokCredentialId: 'byok-a',
    }))).rejects.toMatchObject({ code: 'credential' })
  })

  for (const choice of ['rekey', 'detach'] as const) {
    it(`${choice}s BYOK metadata under a fenced transfer and compensation restores exact source custody`, async () => {
      const fixture = createAiCreditFixture()
      await fixture.service.grant(grantCommand())
      await fixture.service.attachByok({
        credentialId: 'byok-a', scope: aiCreditScope, providerId: 'provider-a',
        existingCredentialId: 'native-a', displayLabel: 'Primary', idempotencyKey: 'byok-a',
      })
      const source = await fixture.repository.credential('byok-a')
      const transferRepository = new MemoryAiByokTransferRepository(fixture.repository)
      const step = createAiByokTransferStep(transferRepository)
      const rekeyedEnvelope = choice === 'rekey'
        ? await fixture.cipher.encrypt(
          { providerId: 'provider-a', existingCredentialId: 'native-a', displayLabel: 'Rekeyed' },
          credentialAad('byok-a', destinationScope.ownerGeneration),
        )
        : null
      await transferRepository.recordChoice({
        transferId: manifest.transferId,
        credentialId: 'byok-a',
        choice,
        destinationScope,
        rekeyedEnvelope,
        recordedAt: '2026-07-28T12:01:00.000Z',
      })
      const applied = await step.apply({ manifest, saga, receipt: null })
      expect(await step.verify({ manifest, saga, receipt: applied })).toEqual({ status: 'verified', receipt: applied })
      expect(await fixture.repository.credential('byok-a')).toMatchObject({
        scope: destinationScope,
        state: choice === 'rekey' ? 'active' : 'detached',
        version: 2,
      })
      expect(await step.apply({ manifest, saga, receipt: applied })).toEqual(applied)
      expect(await step.compensate({ manifest, saga, receipt: applied })).toMatchObject({ status: 'compensated' })
      expect(await fixture.repository.credential('byok-a')).toEqual(source)
    })
  }
})
