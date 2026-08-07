/**
 * The master key must be established at BOOT in production, not on first use.
 *
 * THE DEFECT THIS CLOSES (task 1): `secrets/masterKey.ts` documented that an unset
 * INSTATIC_SECRET_KEY makes boot "fail loudly with instructions" in production. Nothing did that.
 * The key was resolved lazily, only when `ai/credentials/store.ts` or `auth/totpSecrets.ts` first
 * needed it - so a production deployment missing one variable BOOTED AND SERVED TRAFFIC, and failed
 * later inside a request. The customer saw the AI feature and two-factor auth as broken; the deploy
 * that caused it reported success.
 *
 * WHY FAILING THE BOOT IS THE RIGHT DIRECTION, and it is not a general preference: this key also
 * encrypts MFA TOTP seeds (auth/totpSecrets.ts calls loadMasterKey). A server that cannot decrypt a
 * second factor must not accept sign-ins, so refusing to start beats serving while an authentication
 * factor cannot be verified.
 */

import { describe, expect, it, afterEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MasterKeyConfigurationError,
  verifyMasterKeyAtBoot,
  __resetMasterKeyCacheForTesting,
} from '../../../server/secrets/masterKey'

const SERVER = join(import.meta.dir, '..', '..', '..', 'server')

// A valid 32-byte AES-256 key, base64. Generated once for this test; it protects nothing.
const VALID_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64')

function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(vars)) {
    previous[name] = process.env[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    return run()
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

afterEach(() => {
  __resetMasterKeyCacheForTesting()
})

describe('the master key is established at boot, not on first use', () => {
  it('verifies a well-formed key and returns its fingerprint', async () => {
    __resetMasterKeyCacheForTesting()
    const fingerprint = await withEnv(
      { INSTATIC_SECRET_KEY: VALID_KEY },
      () => verifyMasterKeyAtBoot(),
    )
    expect(typeof fingerprint).toBe('string')
    expect(fingerprint.length).toBeGreaterThan(8)
  })

  it('REFUSES in production when the key is absent, naming the remedy', async () => {
    __resetMasterKeyCacheForTesting()
    let failure: unknown = null
    try {
      await withEnv(
        { INSTATIC_SECRET_KEY: undefined, NODE_ENV: 'production' },
        () => verifyMasterKeyAtBoot(),
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(MasterKeyConfigurationError)
    const message = failure instanceof Error ? failure.message : ''
    // A refusal that does not say how to fix it sends an operator reading source during an incident.
    expect(message).toContain('INSTATIC_SECRET_KEY')
    expect(message).toContain('generate-secret-key')
  })

  it('REFUSES a malformed key rather than accepting it as configuration', async () => {
    __resetMasterKeyCacheForTesting()
    let failure: unknown = null
    try {
      await withEnv(
        { INSTATIC_SECRET_KEY: 'not-base64-and-not-32-bytes', NODE_ENV: 'production' },
        () => verifyMasterKeyAtBoot(),
      )
    } catch (error) {
      failure = error
    }
    // Rethrown as a CONFIGURATION error, so the boot failure names the cause rather than surfacing as a
    // stray WebCrypto error from whichever call site happened to run first.
    expect(failure).toBeInstanceOf(MasterKeyConfigurationError)
  })

  it('performs a real encrypt/decrypt ROUND TRIP, not merely a key import', async () => {
    // Importing proves the bytes form a valid AES key. It does NOT prove this process can recover a
    // secret it wrote, which is what the credential store and TOTP verification actually depend on.
    const source = readFileSync(join(SERVER, 'secrets', 'masterKey.ts'), 'utf8')
    expect(source).toContain('encryptSecret(key, MASTER_KEY_BOOT_PROBE)')
    expect(source).toContain('decryptSecret(key, probe)')
  })

  it('logs the FINGERPRINT and never the key material', async () => {
    const source = readFileSync(join(SERVER, 'secrets', 'masterKey.ts'), 'utf8')
    // BOUNDED to this function. Slicing to end-of-file also captured `readMasterKeyBytes`, which reads
    // process.env legitimately - the scan then measured more than it claimed and failed on correct code.
    const start = source.indexOf('export async function verifyMasterKeyAtBoot')
    const verifier = source.slice(start, source.indexOf('export function __resetMasterKeyCacheForTesting', start))
    expect(verifier).toContain('fingerprint')
    // A rotated key is not a configuration error - the process works, it just cannot read older rows -
    // so the fingerprint is what distinguishes "wrong key" from "corrupt row".
    expect(verifier).toContain('re-entry')
    // The key bytes must never reach a log line.
    expect(verifier).not.toContain('rawBytes')
    expect(verifier).not.toContain('process.env[ENV_VAR_NAME]')
  })
})

describe('the verification is wired into boot, and only for production', () => {
  it('server/index.ts calls it', () => {
    const index = readFileSync(join(SERVER, 'index.ts'), 'utf8')
    expect(index).toContain('verifyMasterKeyAtBoot()')
  })

  it('runs BEFORE migrations, so a misconfigured deploy does not alter the schema first', () => {
    const index = readFileSync(join(SERVER, 'index.ts'), 'utf8')
    const verify = index.indexOf('verifyMasterKeyAtBoot()')
    const migrate = index.indexOf('await runMigrations(db, migrations)')
    expect(verify).toBeGreaterThan(-1)
    expect(migrate).toBeGreaterThan(-1)
    expect(verify).toBeLessThan(migrate)
  })

  it('is gated on production, so a self-hosted dev boot keeps its auto-created key', () => {
    const index = readFileSync(join(SERVER, 'index.ts'), 'utf8')
    const guard = index.indexOf("process.env.NODE_ENV === 'production'")
    const verify = index.indexOf('verifyMasterKeyAtBoot()')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(verify)
    // The dev fallback must still exist, or `bun run dev` would demand a key nobody has set.
    const master = readFileSync(join(SERVER, 'secrets', 'masterKey.ts'), 'utf8')
    expect(master).toContain('readOrCreateDevKey')
  })
})
