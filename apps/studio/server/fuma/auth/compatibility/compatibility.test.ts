import { describe, expect, it } from 'bun:test'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { getAuthTables } from 'better-auth/db'
import { getTableColumns, getTableName } from 'drizzle-orm'
import {
  createHostedAuth as createCompatibilityAuth,
  createHostedAuthOptions as createCompatibilityAuthOptions,
} from '../../../auth/hosted/auth'
import { AUTH_MODEL_NAMES } from '../../../auth/hosted/schemaManifest'
import {
  auth_accounts,
  auth_invitations,
  auth_members,
  auth_organizations,
  auth_sessions,
  auth_two_factors,
  auth_users,
  auth_verifications,
} from '../../../auth/hosted/schema'
import { withHashedSessionTokens } from '../../../auth/hosted/sessionTokenAdapter'
import {
  FUMA_AUTH_COMPATIBILITY_PACKAGES,
  FUMA_AUTH_PROVEN_BUN_RANGE,
} from './versions'

type MemoryDatabase = Record<string, Record<string, unknown>[]>

const BASE_URL = 'https://app.trimly.co.ke'
const SECRET = 'fuma-010-compatibility-secret-is-not-used-outside-tests'
const PASSWORD = 'Fuma-compatibility-password-123!'

function compatibilityInput() {
  return {
    baseURL: BASE_URL,
    secret: SECRET,
    secureCookies: true,
  } as const
}

function initializedMemoryDatabase(): MemoryDatabase {
  return Object.fromEntries(Object.values(AUTH_MODEL_NAMES).map((modelName) => [modelName, []]))
}

const noOpStaffProfiles = { create: async () => {} }

async function runNativeProbe(
  filename: 'postgresProbe.ts' | 'rawHeaderProbe.ts',
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const subprocess = Bun.spawn([process.execPath, 'run', new URL(filename, import.meta.url).pathname], {
    cwd: new URL('../../../../', import.meta.url).pathname,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    Bun.readableStreamToText(subprocess.stdout),
    Bun.readableStreamToText(subprocess.stderr),
  ])
  if (exitCode !== 0) throw new Error(`FUMA-010 ${filename} failed:\n${stderr}`)
  return stdout.trim()
}

describe('FUMA-010 exact package and platform matrix', () => {
  it('pins only registry-verified package versions and records portable declarations', async () => {
    const packageJson = await Bun.file(new URL('../../../../package.json', import.meta.url)).text()
    const lock = await Bun.file(new URL('../../../../../../bun.lock', import.meta.url)).text()

    for (const [name, evidence] of Object.entries(FUMA_AUTH_COMPATIBILITY_PACKAGES)) {
      expect(packageJson).toContain(`"${name}": "${evidence.version}"`)
      expect(packageJson).not.toContain(`"${name}": "^${evidence.version}"`)
      expect(packageJson).not.toContain(`"${name}": "~${evidence.version}"`)
      expect(lock).toContain(`${name}@${evidence.version}`)
      expect(lock).toContain(evidence.integrity)
      expect(evidence.os).toBeNull()
      expect(evidence.cpu).toBeNull()
    }

    expect(Bun.version).toMatch(/^1\.3\./)
    expect(FUMA_AUTH_PROVEN_BUN_RANGE).toBe('>=1.3.0 <1.4.0')
    expect(process.platform).toBeTruthy()
    expect(process.arch).toBeTruthy()
  })

  it('loads Better Auth, its official Drizzle adapter, Drizzle, and postgres.js on Bun', async () => {
    const [betterAuth, adapter, drizzle, postgresDriver] = await Promise.all([
      import('better-auth'),
      import('@better-auth/drizzle-adapter'),
      import('drizzle-orm'),
      import('postgres'),
    ])
    expect(typeof betterAuth.betterAuth).toBe('function')
    expect(typeof adapter.drizzleAdapter).toBe('function')
    expect(typeof drizzle.getTableName).toBe('function')
    expect(typeof postgresDriver.default).toBe('function')
  })
})

it.skipIf(process.arch !== 'arm64')(
  'FUMA-010 ARM64 gate: exact packages and compatibility options initialize on an ARM64 Bun host',
  async () => {
    const auth = createCompatibilityAuth(
      withHashedSessionTokens(memoryAdapter(initializedMemoryDatabase())),
      compatibilityInput(),
      noOpStaffProfiles,
    )
    expect(process.arch).toBe('arm64')
    expect(typeof auth.handler).toBe('function')
    expect(Object.keys(auth.api)).toContain('verifyTOTP')
  },
)

describe('FUMA-010 generated schema and plugin matrix', () => {
  it('maps all core and organization/2FA models to reviewed auth_* Drizzle tables', () => {
    const options = createCompatibilityAuthOptions(
      withHashedSessionTokens(memoryAdapter(initializedMemoryDatabase())),
      compatibilityInput(),
      noOpStaffProfiles,
    )
    const logicalModels = Object.values(getAuthTables(options))
      .map(({ modelName }) => modelName)
      .sort()
    const expectedModels = Object.values(AUTH_MODEL_NAMES).sort()

    expect(logicalModels).toEqual(expectedModels)
    expect([
      auth_users,
      auth_sessions,
      auth_accounts,
      auth_verifications,
      auth_organizations,
      auth_members,
      auth_invitations,
      auth_two_factors,
    ].map(getTableName).sort()).toEqual(expectedModels)

    expect(Object.keys(getTableColumns(auth_users))).toEqual(expect.arrayContaining([
      'role',
      'banned',
      'banReason',
      'banExpires',
      'twoFactorEnabled',
    ]))
    expect(Object.keys(getTableColumns(auth_sessions))).toEqual(expect.arrayContaining([
      'activeOrganizationId',
      'impersonatedBy',
    ]))
    expect(Object.keys(getTableColumns(auth_two_factors))).toEqual(expect.arrayContaining([
      'secret',
      'backupCodes',
      'verified',
      'failedVerificationCount',
      'lockedUntil',
    ]))
  })

  it('initializes organization, admin, and 2FA endpoint surfaces with existing Argon2id hooks', async () => {
    const options = createCompatibilityAuthOptions(
      withHashedSessionTokens(memoryAdapter(initializedMemoryDatabase())),
      compatibilityInput(),
      noOpStaffProfiles,
    )
    const pluginIds = options.plugins?.map(({ id }) => id)
    const passwordHash = await options.emailAndPassword?.password?.hash?.(PASSWORD)
    const auth = createCompatibilityAuth(options.database!, compatibilityInput(), noOpStaffProfiles)

    expect(pluginIds).toEqual(['organization', 'admin', 'two-factor'])
    expect(passwordHash).toStartWith('$argon2id$')
    expect(await options.emailAndPassword?.password?.verify?.({
      password: PASSWORD,
      hash: passwordHash!,
    })).toBe(true)
    expect(Object.keys(auth.api)).toEqual(expect.arrayContaining([
      'createOrganization',
      'listUsers',
      'enableTwoFactor',
      'verifyTOTP',
    ]))
  })
})

describe('FUMA-010 raw headers and token-at-rest policy', () => {
  it('proves native Bun create/restart/revoke with host-only cookies and no bearer token at rest', async () => {
    const evidence = await runNativeProbe('rawHeaderProbe.ts')
    expect(evidence).toContain('"passed":true')
    expect(evidence).toContain('"hostOnly":true')
    expect(evidence).toContain('"argon2id":true')
    expect(evidence).toContain('"hashedSessionToken":true')
    expect(evidence).toContain('"restart":true')
    expect(evidence).toContain('"revoke":true')
  })
})

const postgresUrl = process.env.FUMA_AUTH_COMPAT_POSTGRES_URL

it.skipIf(postgresUrl === undefined)(
  'FUMA-010 live PostgreSQL: create, login, restart, revoke, and inspect token-at-rest evidence',
  async () => {
    const evidence = await runNativeProbe('postgresProbe.ts')
    expect(evidence).toContain('"passed":true')
    expect(evidence).toContain('"postgres":true')
    expect(evidence).toContain('"create":true')
    expect(evidence).toContain('"login":true')
    expect(evidence).toContain('"restart":true')
    expect(evidence).toContain('"revoke":true')
    expect(evidence).toContain('"hostOnly":true')
    expect(evidence).toContain('"argon2id":true')
    expect(evidence).toContain('"hashedSessionToken":true')
  },
  30_000,
)
