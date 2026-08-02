import type { TenantObjectStorage } from '../objectStorage'
import { sha256Hex } from '../objectStorage'
import type { ExpertSiteScope } from './contracts'
import type { ExpertInquiryVault } from './service'

export interface ExpertInquiryKeyAuthority { active(): Promise<Readonly<{ keyId: string; key: CryptoKey }>> }
function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> { const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength)); copy.set(bytes); return copy }
function base64(bytes: Uint8Array): string { return Buffer.from(bytes).toString('base64url') }
function aad(input: Readonly<{ scope: ExpertSiteScope; inquiryId: string; expertId: string; sourceProfile: string }>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ version: 1, ...input.scope, inquiryId: input.inquiryId, expertId: input.expertId, sourceProfile: input.sourceProfile }))
}
function assertKey(key: CryptoKey): void {
  if (key.extractable || key.algorithm.name !== 'AES-GCM' || !key.usages.includes('encrypt')) throw new TypeError('Expert inquiry custody requires a non-extractable AES-256-GCM encryption key.')
  if (!('length' in key.algorithm) || key.algorithm.length !== 256) throw new TypeError('Expert inquiry custody key must be 256 bits.')
}

export class ObjectStorageExpertInquiryVault implements ExpertInquiryVault {
  readonly #storage: TenantObjectStorage
  readonly #keys: ExpertInquiryKeyAuthority
  readonly #random: (bytes: Uint8Array) => Uint8Array
  constructor(input: Readonly<{ storage: TenantObjectStorage; keys: ExpertInquiryKeyAuthority; random?: (bytes: Uint8Array) => Uint8Array }>) {
    this.#storage = input.storage; this.#keys = input.keys; this.#random = input.random ?? ((bytes) => crypto.getRandomValues(bytes))
  }
  async store(input: Parameters<ExpertInquiryVault['store']>[0]) {
    const plaintext = owned(new TextEncoder().encode(input.message))
    const messageBytes = plaintext.byteLength
    if (messageBytes < 1 || messageBytes > 16_384) throw new TypeError('Expert inquiry message exceeds the encrypted storage bound.')
    const active = await this.#keys.active(); assertKey(active.key)
    const iv = owned(this.#random(new Uint8Array(12))); if (iv.byteLength !== 12) throw new TypeError('Expert inquiry IV must contain 96 bits.')
    let ciphertext: Uint8Array
    try {
      ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: owned(aad(input)), tagLength: 128 }, active.key, plaintext))
    } finally {
      plaintext.fill(0)
    }
    const envelope = new TextEncoder().encode(JSON.stringify({ version: 1, algorithm: 'AES-256-GCM', keyId: active.keyId, iv: base64(iv), ciphertext: base64(ciphertext), createdAt: input.createdAt, expiresAt: input.expiresAt }))
    const objectKey = `experts/inquiries/${input.inquiryId}.json`
    await this.#storage.put({ scope: { organizationId: input.scope.organizationId, workspaceId: input.scope.workspaceId, siteId: input.scope.siteId }, key: objectKey, bytes: envelope, mimeType: 'application/json', checksumSha256: sha256Hex(envelope) })
    return Object.freeze({ objectKey, messageBytes })
  }

  async remove(input: Parameters<ExpertInquiryVault['remove']>[0]): Promise<void> {
    await this.#storage.delete(
      { organizationId: input.scope.organizationId, workspaceId: input.scope.workspaceId, siteId: input.scope.siteId },
      input.objectKey,
    )
  }
}

export async function importExpertInquiryKey(raw: Uint8Array, keyId: string): Promise<ExpertInquiryKeyAuthority> {
  if (raw.byteLength !== 32 || !keyId) throw new TypeError('Expert inquiry key material and key ID are invalid.')
  const key = await crypto.subtle.importKey('raw', raw.slice(), { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  return Object.freeze({ active: async () => Object.freeze({ keyId, key }) })
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/
export function readHostedExpertInquiryKey(env: Readonly<Record<string, string | undefined>> = process.env): Readonly<{ bytes: Uint8Array; keyId: string }> {
  const encoded = env.FUMA_EXPERT_INQUIRY_KEY?.trim() ?? ''
  if (!KEY_PATTERN.test(encoded)) throw new TypeError('FUMA_EXPERT_INQUIRY_KEY must be one base64url-encoded 256-bit key.')
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64url'))
  if (bytes.byteLength !== 32 || Buffer.from(bytes).toString('base64url') !== encoded) throw new TypeError('FUMA_EXPERT_INQUIRY_KEY must be one canonical base64url-encoded 256-bit key.')
  const keyId = env.FUMA_EXPERT_INQUIRY_KEY_ID?.trim() || 'expert-inquiry-primary'
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(keyId)) throw new TypeError('FUMA_EXPERT_INQUIRY_KEY_ID is invalid.')
  return Object.freeze({ bytes, keyId })
}
