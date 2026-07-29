import { credentialAuthorityKey, type CredentialScope, type DomainCredentialAuthority, type DomainProviderResult } from './contracts'
import type { DomainCredentialKeyAuthority } from './credentialCipher'
import type { DomainCredentialProvider } from './service'

function sha256(value: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

/** Deterministic fake clock. It advances only when a test explicitly requests it. */
export class FakeDomainClock {
  #current: number

  constructor(start = '2026-07-28T00:00:00.000Z') {
    this.#current = Date.parse(start)
    if (!Number.isFinite(this.#current)) throw new Error('Fake domain clock start is invalid.')
  }

  now = (): Date => new Date(this.#current)

  advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('Fake domain clock advance is invalid.')
    this.#current += milliseconds
  }
}

/** Non-extractable deterministic AES key authority. No key bytes can leave WebCrypto. */
export class FakeDomainCredentialKeyAuthority implements DomainCredentialKeyAuthority {
  readonly #keyId: string
  readonly #key: CryptoKey

  private constructor(keyId: string, key: CryptoKey) {
    this.#keyId = keyId
    this.#key = key
  }

  static async create(keyId = 'domain-test-key-v1', fill = 0x5a): Promise<FakeDomainCredentialKeyAuthority> {
    const material = new Uint8Array(32).fill(fill)
    try {
      const key = await crypto.subtle.importKey('raw', material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      return new FakeDomainCredentialKeyAuthority(keyId, key)
    } finally {
      material.fill(0)
    }
  }

  async current(): Promise<Readonly<{ keyId: string; key: CryptoKey }>> {
    return Object.freeze({ keyId: this.#keyId, key: this.#key })
  }

  async exact(keyId: string): Promise<CryptoKey | null> {
    return keyId === this.#keyId ? this.#key : null
  }
}

/** Deterministic IV source for tests. Production must retain the cipher's random default. */
export function deterministicDomainIvSource(seed = 1): () => Uint8Array {
  let counter = seed
  return () => {
    const output = new Uint8Array(12)
    new DataView(output.buffer).setUint32(8, counter, false)
    counter += 1
    return output
  }
}

type FakeResponse = Readonly<{
  status: DomainProviderResult['status']
  providerCode: string
  expectedSecretSha256: string
  failuresRemaining: number
}>

/** Read-only provider-port fake. It records metadata only and never persists plaintext. */
export class FakeDomainCredentialProvider implements DomainCredentialProvider {
  readonly calls: ReadonlyArray<Readonly<{
    operationId: string
    action: 'validate-ownership' | 'read-provider-status'
    hostname: string
    credentialScope: CredentialScope
  }>> = []
  readonly #responses = new Map<string, FakeResponse>()

  authorize(input: Readonly<{
    authority: DomainCredentialAuthority
    hostname: string
    action: 'validate-ownership' | 'read-provider-status'
    secret: Uint8Array
    status?: DomainProviderResult['status']
    providerCode?: string
    failAttempts?: number
  }>): void {
    this.#responses.set(this.#key(input.authority.scope, input.hostname, input.action), Object.freeze({
      status: input.status ?? 'authorized',
      providerCode: input.providerCode ?? 'fixture-authorized',
      expectedSecretSha256: sha256(input.secret),
      failuresRemaining: input.failAttempts ?? 0,
    }))
  }

  async execute(input: Readonly<{
    operationId: string
    action: 'validate-ownership' | 'read-provider-status'
    hostname: string
    credentialScope: CredentialScope
    secret: Uint8Array
  }>): Promise<Readonly<{ status: DomainProviderResult['status']; providerCode: string }>> {
    const key = this.#key(input.credentialScope, input.hostname, input.action)
    const response = this.#responses.get(key)
    if (!response || response.expectedSecretSha256 !== sha256(input.secret)) throw new Error('Fake provider denied credential authority.')
    ;(this.calls as Array<(typeof this.calls)[number]>).push(Object.freeze({
      operationId: input.operationId,
      action: input.action,
      hostname: input.hostname,
      credentialScope: input.credentialScope,
    }))
    if (response.failuresRemaining > 0) {
      this.#responses.set(key, Object.freeze({ ...response, failuresRemaining: response.failuresRemaining - 1 }))
      throw new Error('Fake provider retryable failure.')
    }
    return Object.freeze({ status: response.status, providerCode: response.providerCode })
  }

  authorityKey(authority: DomainCredentialAuthority): string {
    return credentialAuthorityKey(authority)
  }

  #key(scope: CredentialScope, hostname: string, action: string): string {
    return `${scope}:${hostname}:${action}`
  }
}
