import type { DomainScope } from '../domains/contracts'
import { DomainOperationError, domainOperationHash, type RegistrarAuthCodeEnvelope } from './contracts'

export type RegistrarAuthCodeAuthority = Readonly<{ scope: DomainScope; transferOperationId: string; domainId: string; direction: 'inbound' | 'outbound' }>
export interface RegistrarAuthCodeKeyAuthority { current(): Promise<Readonly<{ keyId: string; key: CryptoKey }>>; exact(keyId: string): Promise<CryptoKey | null> }
export interface RegistrarAuthCodeVault {
  seal(authority: RegistrarAuthCodeAuthority, plaintext: Uint8Array, expiresAt: string): Promise<RegistrarAuthCodeEnvelope>
  use<T>(authority: RegistrarAuthCodeAuthority, envelope: RegistrarAuthCodeEnvelope, operation: (plaintext: Uint8Array) => Promise<T>): Promise<T>
  destroy(authority: RegistrarAuthCodeAuthority, envelope: RegistrarAuthCodeEnvelope): Promise<void>
}
const base64 = (value: Uint8Array): string => Buffer.from(value).toString('base64url')
function decoded(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new DomainOperationError('provider', 'Auth-code envelope encoding is invalid.')
  const bytes = Uint8Array.from(Buffer.from(value, 'base64url'))
  if (base64(bytes) !== value) throw new DomainOperationError('provider', 'Auth-code envelope encoding is not canonical.')
  return bytes
}
function keyFor(authority: RegistrarAuthCodeAuthority): string { return domainOperationHash(authority) }
function assertKey(key: CryptoKey, usage: 'encrypt'|'decrypt'): void {
  if (key.algorithm.name !== 'AES-GCM' || (key.algorithm as AesKeyAlgorithm).length !== 256 || key.extractable || !key.usages.includes(usage)) {
    throw new DomainOperationError('provider', 'Registrar auth-code key must be non-extractable least-privileged AES-256-GCM.')
  }
}
export class AesGcmRegistrarAuthCodeVault implements RegistrarAuthCodeVault {
  readonly #keys: RegistrarAuthCodeKeyAuthority
  readonly #random: () => Uint8Array
  constructor(keys: RegistrarAuthCodeKeyAuthority, random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(12))) { this.#keys = keys; this.#random = random }
  async seal(authority: RegistrarAuthCodeAuthority, plaintext: Uint8Array, expiresAt: string): Promise<RegistrarAuthCodeEnvelope> {
    const active = await this.#keys.current(); assertKey(active.key, 'encrypt')
    const iv = Uint8Array.from(this.#random()); const copy = Uint8Array.from(plaintext)
    if (iv.byteLength !== 12) { iv.fill(0); copy.fill(0); throw new DomainOperationError('provider', 'Registrar auth-code IV must be 96 bits.') }
    try {
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(keyFor(authority)), tagLength: 128 }, active.key, copy)
      return Object.freeze({ ciphertext: `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`, keyId: active.keyId, fingerprintSha256: new Bun.CryptoHasher('sha256').update(copy).digest('hex'), expiresAt })
    } finally { copy.fill(0) }
  }
  async use<T>(authority: RegistrarAuthCodeAuthority, envelope: RegistrarAuthCodeEnvelope, operation: (plaintext: Uint8Array) => Promise<T>): Promise<T> {
    const [version, ivText, cipherText, ...extra] = envelope.ciphertext.split('.')
    if (version !== 'v1' || !ivText || !cipherText || extra.length) throw new DomainOperationError('provider', 'Registrar auth-code envelope is invalid.')
    const key = await this.#keys.exact(envelope.keyId); if (!key) throw new DomainOperationError('provider', 'Registrar auth-code key is unavailable.')
    assertKey(key, 'decrypt'); const iv = decoded(ivText); const ciphertext = decoded(cipherText)
    let plaintext: Uint8Array
    try { plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(keyFor(authority)), tagLength: 128 }, key, ciphertext)) }
    catch { throw new DomainOperationError('provider', 'Registrar auth-code authority or ciphertext authentication failed.') }
    try { return await operation(plaintext) } finally { plaintext.fill(0) }
  }
  async destroy(_authority: RegistrarAuthCodeAuthority, _envelope: RegistrarAuthCodeEnvelope): Promise<void> { /* ciphertext removal is committed by the repository state transition */ }
}
