/**
 * Master encryption key bootstrap for reversible server secrets.
 *
 * The master key is a 32-byte (256-bit) AES key used by `encryption.ts` to
 * encrypt secrets that must be recovered later, such as AI provider API keys
 * and MFA TOTP seeds. It is loaded once at boot and cached for the lifetime of
 * the process.
 *
 * Source priority:
 *
 *   1. `INSTATIC_SECRET_KEY` environment variable (base64).
 *      Production deployments MUST set this. If unset in production
 *      (`NODE_ENV=production`), boot fails loudly with instructions.
 *
 *   2. `.tmp/secret.key` file in the working directory.
 *      Dev / non-production fallback. Auto-created on first boot so a fresh
 *      `bun run dev` works without manual setup. The file is intentionally
 *      under `.tmp/` (already git-ignored).
 *
 * Key rotation: replace the env var or `.tmp/secret.key` file and restart.
 * Existing encrypted rows whose key fingerprint no longer matches will require
 * re-entry or re-enrollment.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { decryptSecret, encryptSecret } from './encryption'

const REQUIRED_KEY_BYTES = 32
const DEV_KEY_PATH = '.tmp/secret.key'
const ENV_VAR_NAME = 'INSTATIC_SECRET_KEY'
// Fixed plaintext for the boot round trip. Not a secret and never stored - it only has to prove that a
// value encrypted by this process can be read back by it.
const MASTER_KEY_BOOT_PROBE = 'instatic:master-key:boot-probe'

let cachedKey: CryptoKey | null = null
let cachedFingerprint: string | null = null

export class MasterKeyConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MasterKeyConfigurationError'
  }
}

export async function loadMasterKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const rawBytes = readMasterKeyBytes()
  cachedKey = await crypto.subtle.importKey(
    'raw',
    rawBytes as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
  cachedFingerprint = await computeMasterKeyFingerprint(rawBytes)
  return cachedKey
}

export async function getMasterKeyFingerprint(): Promise<string> {
  if (!cachedFingerprint) {
    await loadMasterKey()
  }
  if (!cachedFingerprint) {
    throw new Error('[secrets/masterKey] Fingerprint unavailable after loadMasterKey().')
  }
  return cachedFingerprint
}

/**
 * Boot-time verification for production deployments.
 *
 * Resolves the master key eagerly so a missing or malformed INSTATIC_SECRET_KEY stops the deployment
 * instead of surfacing later, inside a request, as a broken feature. Without this the key was only ever
 * resolved on first use (`ai/credentials/store.ts`, `auth/totpSecrets.ts`), so the failure appeared on a
 * customer's screen rather than in the deploy that caused it.
 *
 * It also performs a real encrypt/decrypt round trip rather than only importing the key. Importing proves
 * the bytes are a well-formed AES key; it does not prove this process can actually recover a secret it
 * wrote. The round trip is what the AI credential store and TOTP verification depend on.
 *
 * The FINGERPRINT is logged, never the key. A rotated key is not a configuration error - the process
 * works perfectly, it simply cannot read rows written under the previous key - so the fingerprint is the
 * one value that lets an operator tell "wrong key" apart from "corrupt row" without guessing.
 */
export async function verifyMasterKeyAtBoot(): Promise<string> {
  let fingerprint: string
  try {
    const key = await loadMasterKey()
    const probe = await encryptSecret(key, MASTER_KEY_BOOT_PROBE)
    const recovered = await decryptSecret(key, probe)
    if (recovered !== MASTER_KEY_BOOT_PROBE) {
      throw new MasterKeyConfigurationError(
        '[secrets/masterKey] The master key did not survive an encrypt/decrypt round trip. ' +
        'Reversible secrets cannot be stored or recovered by this process.',
      )
    }
    fingerprint = await getMasterKeyFingerprint()
  } catch (error) {
    // Rethrown as a configuration error so the boot failure names the cause rather than surfacing as a
    // stray crypto error from whichever call happened to run first.
    if (error instanceof MasterKeyConfigurationError) throw error
    throw new MasterKeyConfigurationError(
      `[secrets/masterKey] Could not establish the master key at boot: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    )
  }
  console.log(
    `[secrets/masterKey] Master key verified at boot (fingerprint ${fingerprint}). ` +
    'Rows encrypted under a different fingerprint will need re-entry.',
  )
  return fingerprint
}

export function __resetMasterKeyCacheForTesting(): void {
  cachedKey = null
  cachedFingerprint = null
}

function readMasterKeyBytes(): Uint8Array {
  const envValue = process.env[ENV_VAR_NAME]
  if (envValue && envValue.trim()) {
    return parseAndValidateBase64(envValue.trim(), `env var ${ENV_VAR_NAME}`)
  }

  if (process.env.NODE_ENV === 'production') {
    throw new MasterKeyConfigurationError(
      `[secrets/masterKey] ${ENV_VAR_NAME} is required in production. ` +
      'Generate one with: bun run scripts/generate-secret-key.ts',
    )
  }

  return readOrCreateDevKey(DEV_KEY_PATH)
}

function readOrCreateDevKey(path: string): Uint8Array {
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim()
    return parseAndValidateBase64(raw, `file ${path}`)
  }
  const fresh = crypto.getRandomValues(new Uint8Array(REQUIRED_KEY_BYTES))
  const dir = dirname(path)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  const base64 = bytesToBase64(fresh)
  writeFileSync(path, base64 + '\n', 'utf8')
  try {
    chmodSync(path, 0o600)
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }
  console.warn(
    `[secrets/masterKey] Generated a new dev master key at ${path}. ` +
    `Set ${ENV_VAR_NAME} for production.`,
  )
  return fresh
}

function parseAndValidateBase64(value: string, source: string): Uint8Array {
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(value)
  } catch (err) {
    throw new MasterKeyConfigurationError(
      `[secrets/masterKey] ${source} is not valid base64. ` +
      'Generate a new key with: bun run scripts/generate-secret-key.ts',
      { cause: err },
    )
  }
  if (bytes.length !== REQUIRED_KEY_BYTES) {
    throw new MasterKeyConfigurationError(
      `[secrets/masterKey] ${source} decoded to ${bytes.length} bytes; ` +
      `must be exactly ${REQUIRED_KEY_BYTES}. ` +
      'Generate a new key with: bun run scripts/generate-secret-key.ts',
    )
  }
  return bytes
}

async function computeMasterKeyFingerprint(keyBytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', keyBytes as BufferSource)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 16)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}
