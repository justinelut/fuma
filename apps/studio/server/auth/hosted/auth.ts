import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
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

/**
 * Optional hosted social sign-in. A provider is configured only when both of
 * its credentials are present and non-blank; a partially configured provider is
 * omitted entirely rather than half-enabled, so sign-in never advertises a
 * button that cannot complete.
 *
 * These are platform-owned identity credentials for the Fuma auth host. They
 * are unrelated to tenant payment or provider secrets and never reach site AI,
 * imported runtimes, or exported adapters.
 */
export type HostedSocialProviderCredential = Readonly<{
  clientId: string
  clientSecret: string
}>

export type HostedSocialProviders = Readonly<{
  google?: HostedSocialProviderCredential
  github?: HostedSocialProviderCredential
}>

export type HostedOrganizationLifecycle = Readonly<{
  beforeCreate(input: Readonly<{ organization: Readonly<{ name?: string; slug?: string; logo?: string | null; metadata?: Record<string, unknown> }>; user: Readonly<{ id: string }> }>): Promise<void | Readonly<{ data: Record<string, unknown> }>>
  afterCreate(input: Readonly<{ organization: Readonly<{ id: string; name: string; slug: string }>; member: Readonly<{ organizationId: string; userId: string; role: string }>; user: Readonly<{ id: string }> }>): Promise<void>
}>

export const HOSTED_SOCIAL_PROVIDER_IDS = Object.freeze(['google', 'github'] as const)
export type HostedSocialProviderId = typeof HOSTED_SOCIAL_PROVIDER_IDS[number]

export type HostedAuthInput = Readonly<{
  baseURL: string
  secret: string
  secureCookies: boolean
  cookieName?: string
  delivery?: HostedAuthDelivery
  socialProviders?: HostedSocialProviders
  organizationLifecycle?: HostedOrganizationLifecycle
}>

function usableCredential(value: HostedSocialProviderCredential | undefined): HostedSocialProviderCredential | null {
  if (!value) return null
  const clientId = value.clientId.trim()
  const clientSecret = value.clientSecret.trim()
  if (clientId.length === 0 || clientSecret.length === 0) return null
  return Object.freeze({ clientId, clientSecret })
}

/**
 * Providers Fuma will actually expose, in a stable order. Callers use this to
 * render sign-in buttons so the UI can never offer an unconfigured provider.
 */
export function enabledHostedSocialProviders(
  providers: HostedSocialProviders | undefined,
): readonly HostedSocialProviderId[] {
  if (!providers) return Object.freeze([])
  return Object.freeze(HOSTED_SOCIAL_PROVIDER_IDS.filter((id) => usableCredential(providers[id]) !== null))
}

export type HostedAuthImpersonationMutation = Readonly<{
  userId: string
  sessionId: string
  impersonatedBy: string | null
  setCookies: readonly string[]
}>

function responseCookieValues(headers: Headers): readonly string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') return Object.freeze(getSetCookie.call(headers))
  const combined = headers.get('set-cookie')
  return Object.freeze(combined ? [combined] : [])
}

function safeHostedCookies(headers: Headers, cookieName: string, secureCookies: boolean): readonly string[] {
  const values = responseCookieValues(headers)
  if (values.some((value) => /(?:^|;)\s*Domain=/i.test(value)
    || (value.startsWith(`${cookieName}=`) && (!/(?:^|;)\s*HttpOnly(?:;|$)/i.test(value)
      || !/(?:^|;)\s*SameSite=Lax(?:;|$)/i.test(value)
      || !/(?:^|;)\s*Path=\/(?:;|$)/i.test(value)
      || (secureCookies && !/(?:^|;)\s*Secure(?:;|$)/i.test(value)))))) {
    throw new Error('Better Auth emitted an unsafe support impersonation cookie.')
  }
  return values
}


const HostedAuthMutationResponseSchema = Type.Object({
  session: Type.Object({
    id: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
    impersonatedBy: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: true }),
  user: Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: true }),
}, { additionalProperties: true })

type HostedAdminApi = Readonly<{
  impersonateUser(input: Readonly<{ body: { userId: string }; headers: Headers; returnHeaders: true }>): Promise<{ headers: Headers; response: unknown }>
  stopImpersonating(input: Readonly<{ headers: Headers; returnHeaders: true }>): Promise<{ headers: Headers; response: unknown }>
  banUser(input: Readonly<{ headers: Headers; body: { userId: string; banReason: string } }>): Promise<unknown>
  unbanUser(input: Readonly<{ headers: Headers; body: { userId: string } }>): Promise<unknown>
  revokeUserSessions(input: Readonly<{ headers: Headers; body: { userId: string } }>): Promise<unknown>
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

/**
 * Emits `socialProviders` plus `account.accountLinking` only when at least one
 * provider is fully configured. Linking is restricted to the exact configured
 * providers and requires a verified email, so a social account can never take
 * over an existing Fuma staff identity by asserting an unverified address.
 */
function hostedSocialAuthOptions(input: HostedAuthInput): Partial<BetterAuthOptions> {
  const configured = enabledHostedSocialProviders(input.socialProviders)
  if (configured.length === 0) return {}
  const authOrigin = new URL(input.baseURL).origin
  const socialProviders: Record<string, unknown> = {}
  for (const id of configured) {
    const credential = usableCredential(input.socialProviders?.[id])
    if (!credential) continue
    socialProviders[id] = {
      clientId: credential.clientId,
      clientSecret: credential.clientSecret,
      // Callback stays on the exact auth host: never a tenant or wildcard origin.
      redirectURI: `${authOrigin}/api/auth/callback/${id}`,
    }
  }
  return {
    socialProviders: socialProviders as BetterAuthOptions['socialProviders'],
    account: {
      modelName: AUTH_MODEL_NAMES.account,
      accountLinking: {
        enabled: true,
        trustedProviders: [...configured],
        allowDifferentEmails: false,
      },
    },
  }
}

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
    ...hostedSocialAuthOptions(input),
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
        organizationHooks: input.organizationLifecycle ? {
          beforeCreateOrganization: async ({ organization, user }) => await input.organizationLifecycle!.beforeCreate({ organization, user: { id: user.id } }),
          afterCreateOrganization: async ({ organization, member, user }) => { await input.organizationLifecycle!.afterCreate({ organization: { id: organization.id, name: organization.name, slug: organization.slug }, member: { organizationId: member.organizationId, userId: member.userId, role: member.role }, user: { id: user.id } }) },
        } : undefined,
      }),
      // Better Auth 1.6.25's admin factory narrows `user.email` while its
      // exported BetterAuthPlugin hook type makes that field optional. Runtime
      // values are produced by the same package; contain the declaration bug here.
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
        impersonationSessionDuration: 30 * 60,
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

function createPostgresHostedAuthBase(
  input: PostgresHostedAuthInput,
  createStaffProfiles: boolean,
) {
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
  const profiles: HostedStaffProfileLifecycle = createStaffProfiles
    ? {
      create: async ({ id }) => {
        await client`
          insert into auth_staff_profiles (user_id, source)
          values (${id}, ${'native'})
          on conflict (user_id) do nothing
        `
      },
    }
    : { create: async () => undefined }
  const auth = createHostedAuth(database, input, profiles)
  return { client, auth }
}

export type PostgresHostedIdentityAuth = Readonly<{
  auth: HostedAuth
  resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
  close: () => Promise<void>
}>

/**
 * Reuses the canonical Better Auth users, credentials, and sessions for the
 * public app identity host without granting or persisting staff lifecycle state.
 */
export function createPostgresHostedIdentityAuth(input: PostgresHostedAuthInput): PostgresHostedIdentityAuth {
  const { client, auth } = createPostgresHostedAuthBase(input, false)
  return Object.freeze({
    auth,
    resolveSession: async (headers: Headers) => await resolveHostedSession(auth, headers),
    close: async () => await client.end({ timeout: 5 }),
  })
}

export function createPostgresHostedAuth(input: PostgresHostedAuthInput): Readonly<{
  auth: HostedAuth
  resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
  startSupportImpersonation: (headers: Headers, targetUserId: string, expiresAt: string) => Promise<HostedAuthImpersonationMutation>
  stopSupportImpersonation: (headers: Headers) => Promise<HostedAuthImpersonationMutation>
  setSupportModerationBan: (headers: Headers, targetUserId: string, banned: boolean, reason: string) => Promise<void>
  recoverProtectedOwner: (headers: Headers, targetUserId: string) => Promise<void>
  findUserEmailById: (userId: string) => Promise<string | null>
  findSessionUserIdByToken: (token: string) => Promise<string | null>
  close: () => Promise<void>
}> {
  const { client, auth } = createPostgresHostedAuthBase(input, true)
  // Better Auth's admin plugin is cast at configuration because 1.6.25 ships a
  // declaration mismatch; recover only the reviewed runtime endpoints here.
  const supportApi = auth.api as unknown as HostedAdminApi

  return {
    auth,
    resolveSession: async (headers) => await resolveHostedSession(auth, headers),
    startSupportImpersonation: async (headers, targetUserId, expiresAt) => {
      const requestedExpiry = Date.parse(expiresAt)
      if (!Number.isFinite(requestedExpiry) || requestedExpiry <= Date.now() || requestedExpiry - Date.now() > 30 * 60_000) {
        throw new Error('Support impersonation expiry is invalid or exceeds 30 minutes.')
      }
      const result = await supportApi.impersonateUser({ body: { userId: targetUserId }, headers, returnHeaders: true })
      const parsed = safeParseValue(HostedAuthMutationResponseSchema, result.response)
      if (!parsed.ok) throw new Error('Better Auth returned a malformed support impersonation response.')
      const session = parsed.value.session
      if (session.userId !== targetUserId || typeof session.id !== 'string'
        || (session.impersonatedBy !== undefined && typeof session.impersonatedBy !== 'string')) {
        throw new Error('Better Auth returned an invalid support impersonation session.')
      }
      const tightened = await client`update auth_sessions set expires_at=${new Date(requestedExpiry).toISOString()},updated_at=current_timestamp where id=${session.id} and user_id=${targetUserId} and impersonated_by=${session.impersonatedBy ?? ''} and expires_at>=${new Date(requestedExpiry).toISOString()}`
      if (tightened.count !== 1) throw new Error('Better Auth support impersonation expiry could not be tightened.')
      return Object.freeze({
        userId: session.userId,
        sessionId: session.id,
        impersonatedBy: typeof session.impersonatedBy === 'string' ? session.impersonatedBy : null,
        setCookies: safeHostedCookies(result.headers, input.cookieName ?? FUMA_STAFF_SESSION_COOKIE, input.secureCookies),
      })
    },
    stopSupportImpersonation: async (headers) => {
      const result = await supportApi.stopImpersonating({ headers, returnHeaders: true })
      const parsed = safeParseValue(HostedAuthMutationResponseSchema, result.response)
      if (!parsed.ok) throw new Error('Better Auth returned a malformed restored staff response.')
      const session = parsed.value.session
      if (typeof session.userId !== 'string' || typeof session.id !== 'string') {
        throw new Error('Better Auth returned an invalid restored staff session.')
      }
      return Object.freeze({
        userId: session.userId,
        sessionId: session.id,
        impersonatedBy: typeof session.impersonatedBy === 'string' ? session.impersonatedBy : null,
        setCookies: safeHostedCookies(result.headers, input.cookieName ?? FUMA_STAFF_SESSION_COOKIE, input.secureCookies),
      })
    },
    setSupportModerationBan: async (headers, targetUserId, banned, reason) => {
      if (banned) await supportApi.banUser({ headers, body: { userId: targetUserId, banReason: reason } })
      else await supportApi.unbanUser({ headers, body: { userId: targetUserId } })
    },
    recoverProtectedOwner: async (headers, targetUserId) => {
      const rows = await client<{ email: string }[]>`select email from auth_users where id=${targetUserId} limit 1`
      const email = rows[0]?.email
      if (!email) throw new Error('Protected owner recovery target no longer exists.')
      await supportApi.revokeUserSessions({ headers, body: { userId: targetUserId } })
      await auth.api.requestPasswordReset({ body: { email } })
    },
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
