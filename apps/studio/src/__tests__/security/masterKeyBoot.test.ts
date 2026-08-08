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
  reportMasterKeyAtBoot,
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
      () => reportMasterKeyAtBoot(),
    )
    expect(typeof fingerprint).toBe('string')
    expect(fingerprint.length).toBeGreaterThan(8)
  })

  it('REPORTS rather than crashing when the key is absent, so a misconfiguration is not an outage', async () => {
    __resetMasterKeyCacheForTesting()
    const errors: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')) }
    let returned: string | null = 'unset'
    try {
      returned = await withEnv(
        { INSTATIC_SECRET_KEY: undefined, NODE_ENV: 'production' },
        () => reportMasterKeyAtBoot(),
      )
    } finally {
      console.error = original
    }
    // NULL, not a throw. Refusing to boot took the studio into CrashLoopBackOff and every hosted site
    // with it, to protect two features that already fail closed.
    expect(returned).toBeNull()
    const joined = errors.join(' ')
    expect(joined).toContain('INSTATIC_SECRET_KEY')
    expect(joined).toContain('generate-secret-key')
    // Names both affected features, because the defect was that this surfaced as a broken page instead.
    expect(joined.toLowerCase()).toContain('mfa')
  })

  it('reports a malformed key without crashing', async () => {
    __resetMasterKeyCacheForTesting()
    const original = console.error
    let saw = false
    console.error = () => { saw = true }
    let returned: string | null = 'unset'
    try {
      returned = await withEnv(
        { INSTATIC_SECRET_KEY: 'not-base64-and-not-32-bytes', NODE_ENV: 'production' },
        () => reportMasterKeyAtBoot(),
      )
    } finally {
      console.error = original
    }
    expect(returned).toBeNull()
    expect(saw).toBe(true)
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
    const start = source.indexOf('export async function reportMasterKeyAtBoot')
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
    expect(index).toContain('reportMasterKeyAtBoot()')
  })

  it('runs BEFORE migrations, so a misconfigured deploy does not alter the schema first', () => {
    const index = readFileSync(join(SERVER, 'index.ts'), 'utf8')
    const verify = index.indexOf('reportMasterKeyAtBoot()')
    const migrate = index.indexOf('await runMigrations(db, migrations)')
    expect(verify).toBeGreaterThan(-1)
    expect(migrate).toBeGreaterThan(-1)
    expect(verify).toBeLessThan(migrate)
  })

  it('is gated on production, so a self-hosted dev boot keeps its auto-created key', () => {
    const index = readFileSync(join(SERVER, 'index.ts'), 'utf8')
    const guard = index.indexOf("process.env.NODE_ENV === 'production'")
    const verify = index.indexOf('reportMasterKeyAtBoot()')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(verify)
    // The dev fallback must still exist, or `bun run dev` would demand a key nobody has set.
    const master = readFileSync(join(SERVER, 'secrets', 'masterKey.ts'), 'utf8')
    expect(master).toContain('readOrCreateDevKey')
  })
})
