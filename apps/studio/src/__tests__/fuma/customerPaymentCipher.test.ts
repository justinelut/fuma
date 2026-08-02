import { describe, expect, it } from 'bun:test'
import {
  AesGcmCustomerPaymentCredentialCipher,
  type CustomerPaymentCredentialKeyAuthority,
} from '../../../server/fuma/customerPayments/credentialCipher'

async function keys(): Promise<CustomerPaymentCredentialKeyAuthority> {
  const material = new Uint8Array(32).fill(0x4c)
  const key = await crypto.subtle.importKey(
    'raw', material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
  material.fill(0)
  return {
    current: async () => ({ keyId: 'customer-payment-key-v1', key }),
    exact: async (keyId) => keyId === 'customer-payment-key-v1' ? key : null,
  }
}

function ivSource(): () => Uint8Array {
  let counter = 1
  return () => {
    const iv = new Uint8Array(12)
    new DataView(iv.buffer).setUint32(8, counter++, false)
    return iv
  }
}

describe('FUMA-058 customer merchant credential cipher', () => {
  it('round-trips only under exact ownership/version AAD and persists no plaintext', async () => {
    const cipher = new AesGcmCustomerPaymentCredentialCipher(await keys(), { randomBytes: ivSource() })
    const plaintext = new TextEncoder().encode('{"scope":"customer_merchant","secretKey":"never-store"}')
    const envelope = await cipher.encrypt('customer_merchant:site-a:owner-a:1', plaintext)
    expect(envelope.ciphertext).toMatch(/^v1\./)
    expect(JSON.stringify(envelope)).not.toContain('never-store')
    expect(new TextDecoder().decode(await cipher.decrypt('customer_merchant:site-a:owner-a:1', envelope)))
      .toContain('never-store')
    await expect(cipher.decrypt('customer_merchant:site-a:owner-b:1', envelope))
      .rejects.toMatchObject({ code: 'decrypt-denied' })
  })

  it('rejects tampering, unknown keys, extractable keys, and malformed IVs', async () => {
    const authority = await keys()
    const cipher = new AesGcmCustomerPaymentCredentialCipher(authority, { randomBytes: ivSource() })
    const envelope = await cipher.encrypt('aad', new TextEncoder().encode('credential'))
    const last = envelope.ciphertext.at(-1)!
    await expect(cipher.decrypt('aad', {
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`,
    })).rejects.toMatchObject({ code: 'decrypt-denied' })
    await expect(cipher.decrypt('aad', { ...envelope, keyId: 'missing' }))
      .rejects.toMatchObject({ code: 'decrypt-denied' })

    const material = new Uint8Array(32).fill(1)
    const extractable = await crypto.subtle.importKey(
      'raw', material, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    )
    const unsafe = new AesGcmCustomerPaymentCredentialCipher({
      current: async () => ({ keyId: 'unsafe', key: extractable }),
      exact: async () => extractable,
    })
    await expect(unsafe.encrypt('aad', new Uint8Array([1])))
      .rejects.toMatchObject({ code: 'invalid-key' })
    const malformed = new AesGcmCustomerPaymentCredentialCipher(authority, {
      randomBytes: () => new Uint8Array(8),
    })
    await expect(malformed.encrypt('aad', new Uint8Array([1])))
      .rejects.toMatchObject({ code: 'invalid-envelope' })
  })
})
