import type {
  DomainCredentialAuthority,
  DomainCredentialEnvelope,
} from './contracts'
import { credentialAuthorityKey } from './contracts'

export interface DomainCredentialKeyAuthority {
  current(): Promise<Readonly<{ keyId: string; key: CryptoKey }>>
  exact(keyId: string): Promise<CryptoKey | null>
}

export interface DomainSecretCipher {
  encrypt(authority: DomainCredentialAuthority, plaintext: Uint8Array): Promise<Readonly<{
    ciphertext: string
    keyId: string
  }>>
  decrypt(authority: DomainCredentialAuthority, envelope: DomainCredentialEnvelope): Promise<Uint8Array>
}

export class DomainCredentialCipherError extends Error {
  readonly code: 'invalid-key' | 'invalid-envelope' | 'decrypt-denied'

  constructor(code: DomainCredentialCipherError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'DomainCredentialCipherError'
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new DomainCredentialCipherError('invalid-envelope', 'Credential envelope encoding is invalid.')
  }
  const decoded = Uint8Array.from(Buffer.from(value, 'base64url'))
  if (base64(decoded) !== value) {
    throw new DomainCredentialCipherError('invalid-envelope', 'Credential envelope encoding is not canonical.')
  }
  return decoded
}

function assertAes256(key: CryptoKey, usage: 'encrypt' | 'decrypt'): void {
  if (key.algorithm.name !== 'AES-GCM' || (key.algorithm as AesKeyAlgorithm).length !== 256) {
    throw new DomainCredentialCipherError('invalid-key', 'Domain credential key must be non-extractable AES-256-GCM.')
  }
  if (key.extractable || !key.usages.includes(usage)) {
    throw new DomainCredentialCipherError('invalid-key', `Domain credential key lacks least-privileged ${usage} permission.`)
  }
}

type DomainCredentialCipherOptions = Readonly<{
  /** Test-only seam. Production omits this and uses WebCrypto randomness. */
  randomBytes?: () => Uint8Array
}>

/** AES-256-GCM envelope encryption. Every ownership coordinate is authenticated AAD. */
export class AesGcmDomainSecretCipher implements DomainSecretCipher {
  readonly #keys: DomainCredentialKeyAuthority
  readonly #randomBytes: () => Uint8Array

  constructor(keys: DomainCredentialKeyAuthority, options: DomainCredentialCipherOptions = {}) {
    this.#keys = keys
    this.#randomBytes = options.randomBytes ?? (() => crypto.getRandomValues(new Uint8Array(12)))
  }

  async encrypt(authority: DomainCredentialAuthority, plaintext: Uint8Array): Promise<Readonly<{
    ciphertext: string
    keyId: string
  }>> {
    const active = await this.#keys.current()
    assertAes256(active.key, 'encrypt')
    const iv = Uint8Array.from(this.#randomBytes())
    if (iv.byteLength !== 12) {
      iv.fill(0)
      throw new DomainCredentialCipherError('invalid-envelope', 'Domain credential IV must contain exactly 96 bits.')
    }
    const copy = Uint8Array.from(plaintext)
    try {
      const encrypted = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(credentialAuthorityKey(authority)),
        tagLength: 128,
      }, active.key, copy)
      return Object.freeze({
        ciphertext: `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`,
        keyId: active.keyId,
      })
    } finally {
      copy.fill(0)
    }
  }

  async decrypt(authority: DomainCredentialAuthority, envelope: DomainCredentialEnvelope): Promise<Uint8Array> {
    const [version, ivText, cipherText, ...extra] = envelope.ciphertext.split('.')
    if (version !== 'v1' || !ivText || !cipherText || extra.length > 0) {
      throw new DomainCredentialCipherError('invalid-envelope', 'Credential envelope shape is invalid.')
    }
    const iv = bytes(ivText)
    const ciphertext = bytes(cipherText)
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
      throw new DomainCredentialCipherError('invalid-envelope', 'Credential envelope lengths are invalid.')
    }
    const key = await this.#keys.exact(envelope.keyId)
    if (!key) throw new DomainCredentialCipherError('decrypt-denied', 'Credential key is unavailable.')
    assertAes256(key, 'decrypt')
    try {
      return new Uint8Array(await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(credentialAuthorityKey(authority)),
        tagLength: 128,
      }, key, ciphertext))
    } catch (_error) {
      throw new DomainCredentialCipherError('decrypt-denied', 'Credential authority, key, or ciphertext authentication failed.')
    }
  }
}
