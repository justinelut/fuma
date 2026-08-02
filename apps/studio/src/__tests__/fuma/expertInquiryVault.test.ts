import { ObjectStorageExpertInquiryVault } from '../../../server/fuma/expertDiscovery'
import type { PutObjectInput, TenantObjectStorage } from '../../../server/fuma/objectStorage'

describe('FUMA-073 encrypted inquiry custody', () => {
  it('stores only an authenticated ciphertext envelope under the exact tenant scope', async () => {
    const raw = new Uint8Array(32).fill(7)
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt'])
    let stored: PutObjectInput | null = null
    let deleted: Readonly<{ scope: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>; key: string }> | null = null
    const storage = {
      async put(input: PutObjectInput) { stored = input; return { key: input.key, sizeBytes: input.bytes.byteLength, mimeType: input.mimeType, checksumSha256: input.checksumSha256, createdAt: '2026-07-30T15:00:00.000Z' } },
      async delete(scope: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>, key: string) { deleted = { scope, key } },
    } as TenantObjectStorage
    const vault = new ObjectStorageExpertInquiryVault({ storage, keys: { async active() { return { keyId: 'inquiry-key-1', key } } }, random: (bytes) => { bytes.fill(3); return bytes } })
    const scope = { platformId: 'platform', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 2 }
    const message = 'Please help with our accessible publication launch.'
    const receipt = await vault.store({ scope, inquiryId: 'inquiry-a', expertId: 'expert-a', sourceProfile: 'publication', message, createdAt: '2026-07-30T15:00:00.000Z', expiresAt: '2026-08-06T15:00:00.000Z' })
    expect(receipt).toEqual({ objectKey: 'experts/inquiries/inquiry-a.json', messageBytes: new TextEncoder().encode(message).byteLength })
    const input = stored as unknown as PutObjectInput; expect(input.scope).toEqual({ organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a' }); expect(new TextDecoder().decode(input.bytes)).not.toContain(message)
    const envelope = JSON.parse(new TextDecoder().decode(input.bytes)) as { iv: string; ciphertext: string }
    const aad = new TextEncoder().encode(JSON.stringify({ version: 1, ...scope, inquiryId: 'inquiry-a', expertId: 'expert-a', sourceProfile: 'publication' }))
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64url'), additionalData: aad, tagLength: 128 }, key, Buffer.from(envelope.ciphertext, 'base64url'))
    expect(new TextDecoder().decode(plaintext)).toBe(message)
    await vault.remove({ scope, objectKey: receipt.objectKey })
    expect(deleted).toEqual({ scope: { organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a' }, key: 'experts/inquiries/inquiry-a.json' })
  })
})
