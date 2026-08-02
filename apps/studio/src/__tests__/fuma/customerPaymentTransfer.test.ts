import { describe, expect, it } from 'bun:test'
import type { TransferManifest } from '../../../server/fuma/transfers/contracts'
import {
  MemoryCustomerCredentialTransferRepository,
  createCustomerMerchantCredentialTransferStep,
} from '../../../server/fuma/customerPayments/transferStep'

const source = Object.freeze({
  platformId: 'platform-a', organizationId: 'organization-source', workspaceId: 'workspace-source',
  siteId: 'site-a', ownerKey: 'owner-source', ownerGeneration: 4,
})
const destination = Object.freeze({
  platformId: 'platform-a', organizationId: 'organization-destination', workspaceId: 'workspace-destination',
  siteId: 'site-a', ownerKey: 'owner-destination', ownerGeneration: 9,
})
const manifest: TransferManifest = Object.freeze({
  schemaVersion: 1,
  transferId: 'transfer-a',
  source: { platformId: source.platformId, organizationId: source.organizationId, workspaceId: source.workspaceId, siteId: source.siteId },
  destination: { platformId: destination.platformId, organizationId: destination.organizationId, workspaceId: destination.workspaceId, siteId: destination.siteId },
  siteProfileId: 'publication',
  siteCapabilityOverrides: { grant: [], revoke: [] },
  siteCapabilityIds: [],
  snapshotChecksum: 'a'.repeat(64),
  resources: ['site-record'],
  collaborators: [],
  capturedAt: '2026-07-28T10:00:00.000Z',
})
const saga = Object.freeze({ transferId: manifest.transferId, lockId: 'lock-a', fence: 11 })

describe('FUMA-058 customer credential transfer recovery', () => {
  for (const choice of ['rekey', 'detach'] as const) {
    it(`requires explicit ${choice}, verifies durable state, replays, and compensates`, async () => {
      const repository = new MemoryCustomerCredentialTransferRepository()
      const phases: string[] = []
      const step = createCustomerMerchantCredentialTransferStep(repository, {
        async assertCurrent(input) {
          expect(input.source).toEqual(source)
          expect(input.destination).toEqual(destination)
          expect(input.saga).toEqual(saga)
          phases.push(input.phase)
        },
      })
      await repository.recordChoice({
        transferId: manifest.transferId, source, destination, choice,
        recordedAt: '2026-07-28T10:01:00.000Z',
      })
      repository.seedCredential(manifest.transferId, 'credential-transfer', 3)

      const applied = await step.apply({ manifest, saga, receipt: null })
      expect(applied).toMatchObject({
        code: 'customer-merchant-credentials-applied',
        details: { choice, credentialId: 'credential-transfer', credentialVersion: 3, fence: 11 },
      })
      expect(await step.apply({ manifest, saga, receipt: applied })).toEqual(applied)
      expect(await step.verify({ manifest, saga, receipt: applied })).toEqual({
        status: 'verified', receipt: applied,
      })
      expect((await repository.inspect(manifest.transferId))?.credentialState)
        .toBe(choice === 'rekey' ? 'rekey-required' : 'detached')

      const compensated = await step.compensate({ manifest, saga, receipt: applied })
      expect(compensated.status).toBe('compensated')
      expect((await repository.inspect(manifest.transferId))?.credentialState).toBe('active')
      expect(phases).toEqual(['apply', 'apply', 'verify', 'compensate'])
    })
  }

  it('fails closed without choice, with receipt drift, stale fences, or owner authority failure', async () => {
    const repository = new MemoryCustomerCredentialTransferRepository()
    const step = createCustomerMerchantCredentialTransferStep(repository, { async assertCurrent() {} })
    await expect(step.apply({ manifest, saga, receipt: null })).rejects.toMatchObject({ code: 'conflict' })

    await repository.recordChoice({
      transferId: manifest.transferId, source, destination, choice: 'rekey',
      recordedAt: '2026-07-28T10:01:00.000Z',
    })
    repository.seedCredential(manifest.transferId, 'credential-transfer', 1)
    const applied = await step.apply({ manifest, saga, receipt: null })
    await expect(step.verify({
      manifest,
      saga,
      receipt: { code: 'drifted', details: {} },
    })).rejects.toMatchObject({ code: 'verification' })
    await expect(step.apply({
      manifest,
      saga: { ...saga, fence: 12 },
      receipt: applied,
    })).rejects.toMatchObject({ code: 'conflict' })

    const denied = createCustomerMerchantCredentialTransferStep(repository, {
      async assertCurrent() { throw new Error('owner generation changed') },
    })
    await expect(denied.verify({ manifest, saga, receipt: applied }))
      .rejects.toThrow('owner generation changed')
  })
})
