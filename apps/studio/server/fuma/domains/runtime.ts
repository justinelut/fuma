import type { DbClient } from '../../db/client'
import type { EntitlementService } from '../entitlements'
import type { MeteringService } from '../metering'
import type { QuotaService } from '../quotas'
import { DomainCommercialIntegration } from './commercial'
import {
  AesGcmDomainSecretCipher,
  type DomainCredentialKeyAuthority,
} from './credentialCipher'
import { PostgresDomainRepository } from './postgres'
import {
  DomainService,
  type DomainCredentialProvider,
} from './service'

const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/
const MAX_KEYRING_KEYS = 16

export type HostedDomainCredentialKey = Readonly<{
  keyId: string
  bytes: Uint8Array
}>

export type HostedDomainCredentialKeyring = Readonly<{
  activeKeyId: string
  keys: readonly HostedDomainCredentialKey[]
}>

class ImportedDomainCredentialKeyAuthority implements DomainCredentialKeyAuthority {
  readonly #activeKeyId: string
  readonly #keys: ReadonlyMap<string, CryptoKey>

  constructor(activeKeyId: string, keys: ReadonlyMap<string, CryptoKey>) {
    this.#activeKeyId = activeKeyId
    this.#keys = keys
  }

  async current(): Promise<Readonly<{ keyId: string; key: CryptoKey }>> {
    const key = this.#keys.get(this.#activeKeyId)
    if (!key) throw new TypeError('Active domain credential key is unavailable.')
    return Object.freeze({ keyId: this.#activeKeyId, key })
  }

  async exact(keyId: string): Promise<CryptoKey | null> {
    return this.#keys.get(keyId) ?? null
  }
}

function validateKeyId(keyId: string): void {
  if (!KEY_ID_PATTERN.test(keyId)) throw new TypeError('Domain credential key ID is invalid.')
}

function owned(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(new ArrayBuffer(input.byteLength))
  result.set(input)
  return result
}

/** Imports active and retained decryption keys into non-extractable WebCrypto custody. */
export async function importDomainCredentialKeyring(
  input: HostedDomainCredentialKeyring,
): Promise<DomainCredentialKeyAuthority> {
  validateKeyId(input.activeKeyId)
  if (input.keys.length < 1 || input.keys.length > MAX_KEYRING_KEYS) {
    throw new TypeError('Domain credential keyring size is invalid.')
  }
  const imported = new Map<string, CryptoKey>()
  for (const entry of input.keys) {
    validateKeyId(entry.keyId)
    if (imported.has(entry.keyId)) throw new TypeError('Domain credential keyring contains a duplicate key ID.')
    if (entry.bytes.byteLength !== 32) throw new TypeError('Domain credential keys must contain exactly 256 bits.')
    const copy = owned(entry.bytes)
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        copy,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
      imported.set(entry.keyId, key)
    } finally {
      copy.fill(0)
    }
  }
  if (!imported.has(input.activeKeyId)) throw new TypeError('Active domain credential key is absent from the keyring.')
  return new ImportedDomainCredentialKeyAuthority(input.activeKeyId, imported)
}

/**
 * Reads a rotation-safe production keyring. The JSON object maps stable key IDs
 * to canonical base64url-encoded 256-bit keys; the active ID selects encryption,
 * while retained entries continue to decrypt historical envelopes.
 */
export function readHostedDomainCredentialKeyring(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HostedDomainCredentialKeyring {
  const activeKeyId = env.FUMA_DOMAIN_CREDENTIAL_ACTIVE_KEY_ID?.trim() ?? ''
  validateKeyId(activeKeyId)
  const encoded = env.FUMA_DOMAIN_CREDENTIAL_KEYRING?.trim() ?? ''
  let candidate: unknown
  try { candidate = JSON.parse(encoded) } catch { throw new TypeError('FUMA_DOMAIN_CREDENTIAL_KEYRING must be a JSON object.') }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('FUMA_DOMAIN_CREDENTIAL_KEYRING must be a JSON object.')
  }
  const entries = Object.entries(candidate as Record<string, unknown>)
  if (entries.length < 1 || entries.length > MAX_KEYRING_KEYS) {
    throw new TypeError('FUMA_DOMAIN_CREDENTIAL_KEYRING size is invalid.')
  }
  const keys = entries.map(([keyId, value]) => {
    validateKeyId(keyId)
    if (typeof value !== 'string' || !BASE64URL_256_PATTERN.test(value)) {
      throw new TypeError('FUMA_DOMAIN_CREDENTIAL_KEYRING contains a malformed key.')
    }
    const bytes = new Uint8Array(Buffer.from(value, 'base64url'))
    if (bytes.byteLength !== 32 || Buffer.from(bytes).toString('base64url') !== value) {
      bytes.fill(0)
      throw new TypeError('FUMA_DOMAIN_CREDENTIAL_KEYRING contains a non-canonical key.')
    }
    return Object.freeze({ keyId, bytes })
  })
  if (!keys.some((entry) => entry.keyId === activeKeyId)) {
    for (const entry of keys) entry.bytes.fill(0)
    throw new TypeError('FUMA_DOMAIN_CREDENTIAL_ACTIVE_KEY_ID is absent from the keyring.')
  }
  return Object.freeze({ activeKeyId, keys: Object.freeze(keys) })
}

export type HostedDomainRuntimeInput = Readonly<{
  db: DbClient
  keyring: HostedDomainCredentialKeyring
  provider: DomainCredentialProvider
  entitlements: Pick<EntitlementService, 'evaluate'>
  quotas: Pick<QuotaService, 'admit' | 'settleReservation' | 'releaseReservation'>
  metering: Pick<MeteringService, 'adjust'>
  now?: () => Date
}>

/**
 * Production FUMA-059 authority graph. It intentionally mounts no routes or
 * jobs and performs no provider call during composition; FUMA-060 and FUMA-061
 * consume the returned DomainService through their own adapters.
 */
export async function createHostedDomainRuntime(input: HostedDomainRuntimeInput) {
  if (input.db.dialect !== 'postgres') throw new TypeError('Hosted domain authority requires PostgreSQL.')
  const repository = new PostgresDomainRepository(input.db)
  const keys = await importDomainCredentialKeyring(input.keyring)
  const cipher = new AesGcmDomainSecretCipher(keys)
  const commercial = new DomainCommercialIntegration({
    entitlements: input.entitlements,
    quotas: input.quotas,
    metering: input.metering,
  })
  const service = new DomainService({
    repository,
    cipher,
    commercial,
    provider: input.provider,
    ...(input.now ? { now: input.now } : {}),
  })
  return Object.freeze({ repository, keys, cipher, commercial, service })
}
