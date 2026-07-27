import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth'
import { admin, organization, twoFactor } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { hashPassword, verifyPassword } from '../tokens'
import * as authSchema from './schema'
import { AUTH_MODEL_NAMES } from './schemaManifest'
import { sessionTokenAtRestValue, withHashedSessionTokens } from './sessionTokenAdapter'

export const FUMA_STAFF_SESSION_COOKIE = '__Host-fuma_staff'
export const FUMA_STAFF_FRESH_SESSION_SECONDS = 5 * 60
export const FUMA_STAFF_MFA_MAX_FAILED_ATTEMPTS = 5
export const FUMA_STAFF_MFA_LOCKOUT_SECONDS = 15 * 60

export type HostedAuthDelivery = Readonly<{
  sendVerification: (message: Readonly<{
    email: string
    name: string
    url: string
  }>) => Promise<void>
  sendPasswordReset: (message: Readonly<{
    email: string
    name: string
    url: string
  }>) => Promise<void>
}>

export type HostedAuthInput = Readonly<{
  baseURL: string
  secret: string
  secureCookies: boolean
  cookieName?: string
  delivery?: HostedAuthDelivery
}>

export type HostedStaffProfileLifecycle = Readonly<{
  create: (user: Readonly<{ id: string }>) => Promise<void>
}>

export type HostedResolvedSession = Readonly<{
  userId: string
  sessionId: string
  impersonatedBy: string | null
  email: string
  createdAt: Date
}>

type AuthDatabase = NonNullable<BetterAuthOptions['database']>
type HostedAuth = ReturnType<typeof betterAuth>

export function createHostedAuthOptions(
  database: AuthDatabase,
  input: HostedAuthInput,
  staffProfiles: HostedStaffProfileLifecycle,
): BetterAuthOptions {
  return {
    appName: 'Fuma',
    basePath: '/api/auth',
    baseURL: input.baseURL,
    trustedOrigins: [new URL(input.baseURL).origin],
    secret: input.secret,
    database,
    user: { modelName: AUTH_MODEL_NAMES.user },
    session: {
      modelName: AUTH_MODEL_NAMES.session,
      cookieCache: { enabled: false },
      freshAge: FUMA_STAFF_FRESH_SESSION_SECONDS,
    },
    account: { modelName: AUTH_MODEL_NAMES.account },
    verification: { modelName: AUTH_MODEL_NAMES.verification },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: input.delivery !== undefined,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: input.delivery === undefined
        ? undefined
        : async ({ user, url }) => await input.delivery?.sendPasswordReset({
          email: user.email,
          name: user.name,
          url,
        }),
      password: {
        hash: hashPassword,
        verify: async ({ password, hash }) => await verifyPassword(password, hash),
      },
    },
    emailVerification: input.delivery === undefined
      ? undefined
      : {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }) => await input.delivery?.sendVerification({
          email: user.email,
          name: user.name,
          url,
        }),
      },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => await staffProfiles.create({ id: user.id }),
        },
      },
    },
    advanced: {
      // Fuma supplies the complete cookie name. Better Auth otherwise prepends
      // `__Secure-`, which would corrupt the required `__Host-` prefix.
      // Security still comes from the explicit attributes below.
      useSecureCookies: false,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: input.secureCookies,
        path: '/',
      },
      cookies: {
        session_token: {
          name: input.cookieName ?? FUMA_STAFF_SESSION_COOKIE,
          attributes: {
            httpOnly: true,
            sameSite: 'lax',
            secure: input.secureCookies,
            path: '/',
          },
        },
      },
    },
    plugins: [
      organization({
        schema: {
          organization: { modelName: AUTH_MODEL_NAMES.organization },
          member: { modelName: AUTH_MODEL_NAMES.member },
          invitation: { modelName: AUTH_MODEL_NAMES.invitation },
        },
      }),
      // Better Auth 1.6.25's admin factory narrows `user.email` while its
      // exported BetterAuthPlugin hook type makes that field optional. Runtime
      // values are produced by the same package; contain the declaration bug here.
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
        bannedUserMessage: 'This Fuma staff account is suspended.',
      }) as unknown as BetterAuthPlugin,
      twoFactor({
        issuer: 'Fuma',
        twoFactorTable: AUTH_MODEL_NAMES.twoFactor,
        twoFactorCookieMaxAge: 10 * 60,
        accountLockout: {
          enabled: true,
          maxFailedAttempts: FUMA_STAFF_MFA_MAX_FAILED_ATTEMPTS,
          durationSeconds: FUMA_STAFF_MFA_LOCKOUT_SECONDS,
        },
        backupCodeOptions: { amount: 10, length: 10 },
        totpOptions: { digits: 6, period: 30 },
      }),
    ],
  }
}

export function createHostedAuth(
  database: AuthDatabase,
  input: HostedAuthInput,
  staffProfiles: HostedStaffProfileLifecycle,
): HostedAuth {
  return betterAuth(createHostedAuthOptions(database, input, staffProfiles))
}

export async function resolveHostedSession(
  auth: HostedAuth,
  headers: Headers,
): Promise<HostedResolvedSession | null> {
  const current = await auth.api.getSession({ headers })
  if (!current) return null
  const rawImpersonatedBy = 'impersonatedBy' in current.session
    ? current.session.impersonatedBy
    : null
  if (
    rawImpersonatedBy !== null
    && rawImpersonatedBy !== undefined
    && typeof rawImpersonatedBy !== 'string'
  ) {
    throw new Error('Hosted auth returned an invalid impersonator identifier.')
  }
  return Object.freeze({
    userId: current.user.id,
    sessionId: current.session.id,
    impersonatedBy: rawImpersonatedBy ?? null,
    email: current.user.email,
    createdAt: new Date(current.session.createdAt),
  })
}

export type PostgresHostedAuthInput = HostedAuthInput & Readonly<{
  databaseUrl: string
  searchPath?: string
}>

function assertSafeSearchPath(searchPath: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(searchPath)) {
    throw new Error('Hosted auth search_path must be a safe PostgreSQL identifier')
  }
}

export function createPostgresHostedAuth(input: PostgresHostedAuthInput): Readonly<{
  auth: HostedAuth
  resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
  findUserEmailById: (userId: string) => Promise<string | null>
  findSessionUserIdByToken: (token: string) => Promise<string | null>
  close: () => Promise<void>
}> {
  if (input.searchPath) assertSafeSearchPath(input.searchPath)
  const client = postgres(input.databaseUrl, {
    max: 2,
    connection: input.searchPath ? { search_path: input.searchPath } : undefined,
  })
  const db = drizzle(client, { schema: authSchema })
  const database = withHashedSessionTokens(drizzleAdapter(db, {
    provider: 'pg',
    schema: authSchema,
    transaction: true,
  }))
  const staffProfiles: HostedStaffProfileLifecycle = {
    create: async ({ id }) => {
      await client`
        insert into auth_staff_profiles (user_id, source)
        values (${id}, ${'native'})
        on conflict (user_id) do nothing
      `
    },
  }
  const auth = createHostedAuth(database, input, staffProfiles)

  return {
    auth,
    resolveSession: async (headers) => await resolveHostedSession(auth, headers),
    findUserEmailById: async (userId) => {
      const rows = await client<{ email: string }[]>`
        select email from auth_users where id = ${userId} limit 1
      `
      return rows[0]?.email ?? null
    },
    findSessionUserIdByToken: async (token) => {
      const storedToken = await sessionTokenAtRestValue(token)
      const rows = await client<{ user_id: string }[]>`
        select user_id from auth_sessions where token = ${storedToken} limit 1
      `
      return rows[0]?.user_id ?? null
    },
    close: async () => await client.end({ timeout: 5 }),
  }
}
