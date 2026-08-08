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
 * Boot-time REPORT for the reversible-secret master key. Deliberately never throws.
 *
 * WHAT THIS CLOSES (task 1): the key was resolved lazily, only when `ai/credentials/store.ts` or
 * `auth/totpSecrets.ts` first needed it. A production deployment missing INSTATIC_SECRET_KEY therefore
 * booted, served traffic, and failed later inside a request - so the operator saw a green deploy and the
 * customer saw the AI and two-factor features broken. Resolving it at boot puts the diagnosis in the
 * deploy log, next to the change that caused it.
 *
 * WHY IT REPORTS RATHER THAN REFUSING TO START, which is a correction of my own first attempt: I made it
 * throw, reasoning that a server unable to decrypt a TOTP seed must not accept sign-ins. That reasoning
 * was wrong, and the cluster proved it - the studio entered CrashLoopBackOff and the rollout failed.
 * `decryptTotpSecret` ALREADY throws on a fingerprint mismatch and `verifyTotpEnrollment` does not
 * swallow it, so MFA already fails closed; there is no bypass to prevent. Refusing to boot therefore
 * traded two degraded features for a total outage of every hosted site, which is strictly worse.
 *
 * A real encrypt/decrypt ROUND TRIP is performed rather than only importing the key. Importing proves the
 * bytes form a valid AES key; it does not prove this process can recover a secret it wrote, which is what
 * the credential store and TOTP verification actually depend on.
 *
 * The FINGERPRINT is logged, never the key. A rotated key is not a configuration error - the process
 * works, it simply cannot read rows written under the previous key - so the fingerprint is the one value
 * that separates "wrong key" from "corrupt row" without guessing.
 */
export async function reportMasterKeyAtBoot(): Promise<string | null> {
  try {
    const key = await loadMasterKey()
    const probe = await encryptSecret(key, MASTER_KEY_BOOT_PROBE)
    if ((await decryptSecret(key, probe)) !== MASTER_KEY_BOOT_PROBE) {
      throw new MasterKeyConfigurationError(
        'The master key did not survive an encrypt/decrypt round trip.',
      )
    }
    const fingerprint = await getMasterKeyFingerprint()
    console.log(
      `[secrets/masterKey] Master key verified at boot (fingerprint ${fingerprint}). ` +
      'Rows encrypted under a different fingerprint will need re-entry.',
    )
    return fingerprint
  } catch (error) {
    // Loud, and naming both affected features, because the whole point is that this used to surface as
    // "the AI page is broken" on a customer's screen instead of here.
    console.error(
      `[secrets/masterKey] MASTER KEY UNAVAILABLE: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    console.error(
      `[secrets/masterKey] AI provider credentials and MFA TOTP enrolment will REFUSE to store or read ` +
      `secrets until ${ENV_VAR_NAME} is set to a base64 32-byte key. ` +
      'Generate one with: bun run scripts/generate-secret-key.ts',
    )
    return null
  }
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
