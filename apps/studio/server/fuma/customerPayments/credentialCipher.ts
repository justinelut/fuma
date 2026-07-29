import type { CustomerMerchantCredentialEnvelope } from './contracts'
import type { CustomerMerchantCredentialCipher } from './service'

export interface CustomerPaymentCredentialKeyAuthority {
  current(): Promise<Readonly<{ keyId: string; key: CryptoKey }>>
  exact(keyId: string): Promise<CryptoKey | null>
}

export class CustomerPaymentCredentialCipherError extends Error {
  readonly code: 'invalid-key' | 'invalid-envelope' | 'decrypt-denied'

  constructor(code: CustomerPaymentCredentialCipherError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'CustomerPaymentCredentialCipherError'
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new CustomerPaymentCredentialCipherError('invalid-envelope', 'Credential envelope encoding is invalid.')
  }
  const bytes = Uint8Array.from(Buffer.from(value, 'base64url'))
  if (base64(bytes) !== value) {
    throw new CustomerPaymentCredentialCipherError('invalid-envelope', 'Credential envelope encoding is not canonical.')
  }
  return bytes
}

function assertKey(key: CryptoKey, usage: 'encrypt' | 'decrypt'): void {
  if (key.algorithm.name !== 'AES-GCM' || (key.algorithm as AesKeyAlgorithm).length !== 256
    || key.extractable || !key.usages.includes(usage)) {
    throw new CustomerPaymentCredentialCipherError(
      'invalid-key',
      `Customer payment credential key lacks least-privileged AES-256-GCM ${usage} authority.`,
    )
  }
}

/** Production envelope cipher. The complete merchant ownership/version AAD is supplied by the service. */
export class AesGcmCustomerPaymentCredentialCipher implements CustomerMerchantCredentialCipher {
  readonly #keys: CustomerPaymentCredentialKeyAuthority
  readonly #randomBytes: () => Uint8Array

  constructor(
    keys: CustomerPaymentCredentialKeyAuthority,
    options: Readonly<{ randomBytes?: () => Uint8Array }> = {},
  ) {
    this.#keys = keys
    this.#randomBytes = options.randomBytes ?? (() => crypto.getRandomValues(new Uint8Array(12)))
  }

  async encrypt(aad: string, plaintext: Uint8Array): Promise<CustomerMerchantCredentialEnvelope> {
    const active = await this.#keys.current()
    assertKey(active.key, 'encrypt')
    const iv = Uint8Array.from(this.#randomBytes())
    if (iv.byteLength !== 12) {
      iv.fill(0)
      throw new CustomerPaymentCredentialCipherError('invalid-envelope', 'Credential IV must contain exactly 96 bits.')
    }
    const copy = Uint8Array.from(plaintext)
    try {
      const encrypted = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(aad),
        tagLength: 128,
      }, active.key, copy)
      return Object.freeze({
        ciphertext: `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`,
        keyId: active.keyId,
      })
    } finally {
      copy.fill(0)
      iv.fill(0)
    }
  }

  async decrypt(aad: string, envelope: CustomerMerchantCredentialEnvelope): Promise<Uint8Array> {
    const [version, ivText, ciphertextText, ...extra] = envelope.ciphertext.split('.')
    if (version !== 'v1' || !ivText || !ciphertextText || extra.length > 0) {
      throw new CustomerPaymentCredentialCipherError('invalid-envelope', 'Credential envelope shape is invalid.')
    }
    const iv = decode(ivText)
    const ciphertext = decode(ciphertextText)
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
      throw new CustomerPaymentCredentialCipherError('invalid-envelope', 'Credential envelope lengths are invalid.')
    }
    const key = await this.#keys.exact(envelope.keyId)
    if (!key) throw new CustomerPaymentCredentialCipherError('decrypt-denied', 'Credential key is unavailable.')
    assertKey(key, 'decrypt')
    try {
      return new Uint8Array(await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(aad),
        tagLength: 128,
      }, key, ciphertext))
    } catch {
      throw new CustomerPaymentCredentialCipherError(
        'decrypt-denied',
        'Credential ownership, version, key, or ciphertext authentication failed.',
      )
    } finally {
      iv.fill(0)
      ciphertext.fill(0)
    }
  }
}
