import { beforeEach, describe, expect, it } from 'bun:test'
import { buildAdapterShim, type MediaWorkerRequester } from '../../../server/plugins/host/media'

let workerValue: unknown

const requestWorker: MediaWorkerRequester = async (_pluginId, message) => ({
  kind: 'media-adapter-call-result',
  correlationId: message.correlationId,
  ok: true,
  value: workerValue,
})

function adapter() {
  return buildAdapterShim({
    pluginId: 'acme.media',
    adapterId: 'acme.media.store',
    label: 'Acme media',
    roles: ['original'],
    servingMode: 'public-url',
    hasGetReadUrl: true,
    hasReadStream: false,
  }, requestWorker)
}

describe('plugin media adapter host boundary', () => {
  beforeEach(() => {
    workerValue = undefined
  })

  it('rejects plugin upload plans that try to use the host-only LOCAL transport', async () => {
    workerValue = {
      storagePath: 'uploads/pwn.png',
      steps: [{
        method: 'LOCAL',
        url: 'file:///tmp/pwn.png',
        headers: {},
      }],
      expiresAt: Date.now() + 60_000,
    }

    await expect(adapter().beginWrite({
      mimeType: 'image/png',
      suggestedStoragePath: 'uploads/pwn.png',
      contentHash: '0'.repeat(64),
      sizeBytes: 1,
      role: 'original',
    })).rejects.toThrow(/malformed upload plan/i)
  })

  it('rejects malformed plugin upload plans instead of casting worker output', async () => {
    workerValue = {
      storagePath: 'uploads/pwn.png',
      steps: [{
        method: 'PUT',
        url: 'https://storage.example/upload',
        headers: [],
      }],
      expiresAt: Date.now() + 60_000,
    }

    await expect(adapter().beginWrite({
      mimeType: 'image/png',
      suggestedStoragePath: 'uploads/pwn.png',
      contentHash: '0'.repeat(64),
      sizeBytes: 1,
      role: 'original',
    })).rejects.toThrow(/malformed upload plan/i)
  })
})
