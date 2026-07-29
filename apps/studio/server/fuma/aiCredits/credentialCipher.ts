import { parseAiCreditContract, AiByokMetadataPlaintextSchema, type AiByokEnvelope, type AiByokMetadataPlaintext } from './contracts'

export interface AiByokMetadataCipher {
  readonly keyId: string
  encrypt(value: AiByokMetadataPlaintext, aad: string): Promise<AiByokEnvelope>
  decrypt(envelope: AiByokEnvelope, aad: string): Promise<AiByokMetadataPlaintext>
}
export class AiByokCipherError extends Error { override readonly name = 'AiByokCipherError' }

const encoder = new TextEncoder()
const decoder = new TextDecoder()
function base64(bytes: Uint8Array): string { return Buffer.from(bytes).toString('base64url') }
function owned(value: Uint8Array): Uint8Array<ArrayBuffer> { const copy = new Uint8Array(value.byteLength); copy.set(value); return copy }
function bytes(value: string): Uint8Array<ArrayBuffer> { return owned(new Uint8Array(Buffer.from(value, 'base64url'))) }
async function fingerprint(value: AiByokMetadataPlaintext): Promise<string> {
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex')
}

/** The CryptoKey must be non-extractable; plaintext exists only inside attach/runtime frames. */
export class AesGcmAiByokMetadataCipher implements AiByokMetadataCipher {
  readonly keyId: string
  private readonly key: CryptoKey
  private readonly iv: () => Uint8Array
  constructor(keyId: string, key: CryptoKey, iv: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(12))) {
    this.keyId = keyId; this.key = key; this.iv = iv
    if (key.extractable || key.algorithm.name !== 'AES-GCM' || !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) {
      throw new AiByokCipherError('BYOK metadata custody requires a non-extractable AES-GCM encrypt/decrypt key.')
    }
  }
  async encrypt(raw: AiByokMetadataPlaintext, aad: string): Promise<AiByokEnvelope> {
    const value = parseAiCreditContract(AiByokMetadataPlaintextSchema, raw, 'aiCredits.byok.plaintext')
    const iv = owned(this.iv())
    if (iv.byteLength !== 12) throw new AiByokCipherError('AES-GCM IV source must return 96 bits.')
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, this.key, encoder.encode(JSON.stringify(value)))
    return Object.freeze({ keyId: this.keyId, algorithm: 'AES-GCM-256', iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)), fingerprintSha256: await fingerprint(value) })
  }
  async decrypt(envelope: AiByokEnvelope, aad: string): Promise<AiByokMetadataPlaintext> {
    if (envelope.keyId !== this.keyId) throw new AiByokCipherError('BYOK metadata requires rekeying.')
    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: encoder.encode(aad) }, this.key, bytes(envelope.ciphertext))
      const value = parseAiCreditContract(AiByokMetadataPlaintextSchema, JSON.parse(decoder.decode(plaintext)), 'aiCredits.byok.decrypted')
      if (await fingerprint(value) !== envelope.fingerprintSha256) throw new AiByokCipherError('BYOK metadata fingerprint mismatch.')
      return Object.freeze(value)
    } catch (error) {
      if (error instanceof AiByokCipherError) throw error
      throw new AiByokCipherError('BYOK metadata authentication failed.')
    }
  }
}

export async function importAiByokMetadataKey(raw: Uint8Array, keyId: string): Promise<AesGcmAiByokMetadataCipher> {
  if (raw.byteLength !== 32) throw new AiByokCipherError('BYOK metadata key must be 256 bits.')
  const key = await crypto.subtle.importKey('raw', owned(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
  return new AesGcmAiByokMetadataCipher(keyId, key)
}

export class DeterministicAiByokMetadataCipher implements AiByokMetadataCipher {
  readonly values = new Map<string, AiByokMetadataPlaintext>()
  readonly keyId: string
  constructor(keyId = 'fixture-nonextractable-key') { this.keyId = keyId }
  async encrypt(value: AiByokMetadataPlaintext, aad: string): Promise<AiByokEnvelope> {
    const canonical = JSON.stringify(parseAiCreditContract(AiByokMetadataPlaintextSchema, value, 'aiCredits.byok.fake'))
    const digest = new Bun.CryptoHasher('sha256').update(`${this.keyId}:${aad}:${canonical}`).digest('hex')
    this.values.set(digest, structuredClone(value))
    return { keyId: this.keyId, algorithm: 'AES-GCM-256', iv: 'AAAAAAAAAAAAAAAA', ciphertext: `fixture-${digest}`, fingerprintSha256: new Bun.CryptoHasher('sha256').update(canonical).digest('hex') }
  }
  async decrypt(envelope: AiByokEnvelope, aad: string): Promise<AiByokMetadataPlaintext> {
    if (envelope.keyId !== this.keyId || !envelope.ciphertext.startsWith('fixture-')) throw new AiByokCipherError('BYOK metadata authentication failed.')
    const value = this.values.get(envelope.ciphertext.slice('fixture-'.length))
    if (!value) throw new AiByokCipherError(`BYOK metadata is unavailable for ${aad}.`)
    return structuredClone(value)
  }
}
