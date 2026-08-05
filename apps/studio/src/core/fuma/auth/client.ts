import { apiRequest, type FetchLike } from '@core/http'
import { Type, type Static } from '@core/utils/typeboxHelpers'

const NullableStringSchema = Type.Union([Type.String(), Type.Null()])
const NullableBooleanSchema = Type.Union([Type.Boolean(), Type.Null()])

/**
 * Better Auth may add configured user fields, so the user payload remains
 * extensible. Response envelopes and session records are strict because the
 * hosted boundary deliberately removes bearer tokens from those locations.
 */
export const HostedStaffUserSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  email: Type.String(),
  emailVerified: Type.Boolean(),
  image: Type.Optional(NullableStringSchema),
  role: Type.Optional(NullableStringSchema),
  banned: Type.Optional(NullableBooleanSchema),
  banReason: Type.Optional(NullableStringSchema),
  banExpires: Type.Optional(NullableStringSchema),
  twoFactorEnabled: Type.Optional(Type.Boolean()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
}, { additionalProperties: true })

export type HostedStaffUser = Static<typeof HostedStaffUserSchema>

const HostedStaffSessionRecordSchema = Type.Object({
  id: Type.String(),
  userId: Type.String(),
  expiresAt: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  ipAddress: Type.Optional(NullableStringSchema),
  userAgent: Type.Optional(NullableStringSchema),
  impersonatedBy: Type.Optional(Type.String()),
}, { additionalProperties: false })

const HostedStaffSessionEnvelopeSchema = Type.Object({
  session: HostedStaffSessionRecordSchema,
  user: HostedStaffUserSchema,
  needsRefresh: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const HostedStaffSessionSchema = Type.Union([
  Type.Null(),
  HostedStaffSessionEnvelopeSchema,
])

export type HostedStaffSession = Static<typeof HostedStaffSessionEnvelopeSchema>

export const HostedStaffSignUpInputSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  email: Type.String({ minLength: 3, maxLength: 320 }),
  password: Type.String({ minLength: 12, maxLength: 128 }),
}, { additionalProperties: false })
export type HostedStaffSignUpInput = Static<typeof HostedStaffSignUpInputSchema>

export const HostedStaffLoginInputSchema = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 320 }),
  password: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false })
export type HostedStaffLoginInput = Static<typeof HostedStaffLoginInputSchema>

const HostedSignUpEnvelopeSchema = Type.Object({
  token: Type.Null(),
  user: HostedStaffUserSchema,
}, { additionalProperties: false })

const HostedAuthenticatedLoginEnvelopeSchema = Type.Object({
  redirect: Type.Boolean(),
  url: Type.Optional(NullableStringSchema),
  user: HostedStaffUserSchema,
}, { additionalProperties: false })

const TwoFactorChallengeSchema = Type.Object({
  twoFactorRedirect: Type.Literal(true),
  twoFactorMethods: Type.Array(Type.Union([
    Type.Literal('totp'),
    Type.Literal('otp'),
  ])),
}, { additionalProperties: false })

const HostedLoginEnvelopeSchema = Type.Union([
  HostedAuthenticatedLoginEnvelopeSchema,
  TwoFactorChallengeSchema,
])

export type HostedLoginResult =
  | Readonly<{ kind: 'authenticated'; session: HostedStaffSession }>
  | Readonly<{ kind: 'two-factor'; methods: readonly ('totp' | 'otp')[] }>

const HostedMfaCompletionEnvelopeSchema = Type.Object({
  user: HostedStaffUserSchema,
}, { additionalProperties: false })

const StatusEnvelopeSchema = Type.Object({
  status: Type.Literal(true),
}, { additionalProperties: false })

const PasswordResetRequestEnvelopeSchema = Type.Object({
  status: Type.Literal(true),
  message: Type.String(),
}, { additionalProperties: false })

const SignOutEnvelopeSchema = Type.Object({
  success: Type.Literal(true),
}, { additionalProperties: false })

const TotpSetupSchema = Type.Object({
  totpURI: Type.String(),
  backupCodes: Type.Array(Type.String()),
}, { additionalProperties: false })
export type HostedTotpSetup = Static<typeof TotpSetupSchema>

const BackupCodesSchema = Type.Object({
  status: Type.Literal(true),
  backupCodes: Type.Array(Type.String()),
}, { additionalProperties: false })


const HostedSocialAuthorizationSchema = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 4_096 }),
  redirect: Type.Boolean(),
}, { additionalProperties: false })
export const HostedStaffDeviceSessionSchema = Type.Object({
  id: Type.String(),
  token: Type.String(),
  userId: Type.String(),
  expiresAt: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  ipAddress: Type.Optional(NullableStringSchema),
  userAgent: Type.Optional(NullableStringSchema),
  impersonatedBy: Type.Optional(Type.String()),
}, { additionalProperties: false })
export type HostedStaffDeviceSession = Static<typeof HostedStaffDeviceSessionSchema>

const HostedStaffDeviceSessionsSchema = Type.Array(HostedStaffDeviceSessionSchema)
const AdminUsersEnvelopeSchema = Type.Object({
  users: Type.Array(HostedStaffUserSchema),
  total: Type.Number(),
}, { additionalProperties: false })
const HostedUserEnvelopeSchema = Type.Object({
  user: HostedStaffUserSchema,
}, { additionalProperties: false })

const AUTH_BASE = '/api/auth'

export async function beginHostedStaffGoogleSignIn(
  callbackURL: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<string> {
  const response = await apiRequest(`${AUTH_BASE}/sign-in/social`, {
    method: 'POST',
    body: { provider: 'google', callbackURL },
    schema: HostedSocialAuthorizationSchema,
    fetchImpl,
    fallbackMessage: 'Google sign-in could not start',
  })
  const url = new URL(response.url)
  if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com'
    || url.username || url.password || url.pathname !== '/o/oauth2/v2/auth') {
    throw new Error('Google sign-in returned an invalid authorization URL')
  }
  return url.toString()
}

export async function getHostedStaffSession(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<HostedStaffSession | null> {
  return await apiRequest(`${AUTH_BASE}/get-session`, {
    schema: HostedStaffSessionSchema,
    fetchImpl,
    fallbackMessage: 'Staff session request failed',
  })
}

export async function signUpHostedStaff(
  input: HostedStaffSignUpInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<HostedStaffUser> {
  const response = await apiRequest(`${AUTH_BASE}/sign-up/email`, {
    method: 'POST',
    body: { ...input, callbackURL: '/admin?verified=true' },
    schema: HostedSignUpEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Staff signup failed',
  })
  return response.user
}

export async function loginHostedStaff(
  input: HostedStaffLoginInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<HostedLoginResult> {
  const response = await apiRequest(`${AUTH_BASE}/sign-in/email`, {
    method: 'POST',
    body: input,
    schema: HostedLoginEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Staff login failed',
  })
  if ('twoFactorRedirect' in response) {
    return { kind: 'two-factor', methods: response.twoFactorMethods }
  }
  const session = await getHostedStaffSession(fetchImpl)
  if (!session) throw new Error('Staff login completed without a session')
  return { kind: 'authenticated', session }
}

export async function verifyHostedStaffTotp(
  code: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<HostedStaffSession> {
  await apiRequest(`${AUTH_BASE}/two-factor/verify-totp`, {
    method: 'POST',
    body: { code },
    schema: HostedMfaCompletionEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Authentication code verification failed',
  })
  const session = await getHostedStaffSession(fetchImpl)
  if (!session) throw new Error('Authentication code completed without a session')
  return session
}

export async function verifyHostedStaffRecoveryCode(
  code: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<HostedStaffSession> {
  await apiRequest(`${AUTH_BASE}/two-factor/verify-backup-code`, {
    method: 'POST',
    body: { code },
    schema: HostedMfaCompletionEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Recovery code verification failed',
  })
  const session = await getHostedStaffSession(fetchImpl)
  if (!session) throw new Error('Recovery completed without a session')
  return session
}

export async function beginHostedStaffTotp(
  password: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<HostedTotpSetup> {
  return await apiRequest(`${AUTH_BASE}/two-factor/enable`, {
    method: 'POST',
    body: { password },
    schema: TotpSetupSchema,
    fetchImpl,
    fallbackMessage: 'Could not start two-factor setup',
  })
}

export async function disableHostedStaffTotp(
  password: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<void> {
  await apiRequest(`${AUTH_BASE}/two-factor/disable`, {
    method: 'POST',
    body: { password },
    schema: StatusEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Could not disable two-factor authentication',
  })
}

export async function regenerateHostedStaffRecoveryCodes(
  password: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<readonly string[]> {
  const response = await apiRequest(`${AUTH_BASE}/two-factor/generate-backup-codes`, {
    method: 'POST',
    body: { password },
    schema: BackupCodesSchema,
    fetchImpl,
    fallbackMessage: 'Could not regenerate recovery codes',
  })
  return response.backupCodes
}

export async function listHostedStaffSessions(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<readonly HostedStaffDeviceSession[]> {
  return await apiRequest(`${AUTH_BASE}/list-sessions`, {
    schema: HostedStaffDeviceSessionsSchema,
    fetchImpl,
    fallbackMessage: 'Could not load staff sessions',
  })
}

export async function revokeHostedStaffSession(
  token: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<void> {
  await apiRequest(`${AUTH_BASE}/revoke-session`, {
    method: 'POST',
    body: { token },
    schema: StatusEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Could not revoke staff session',
  })
}

export async function revokeOtherHostedStaffSessions(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<void> {
  await apiRequest(`${AUTH_BASE}/revoke-other-sessions`, {
    method: 'POST',
    schema: StatusEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Could not revoke other staff sessions',
  })
}

export async function listHostedStaffUsers(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<readonly HostedStaffUser[]> {
  const response = await apiRequest(`${AUTH_BASE}/admin/list-users`, {
    query: { limit: 100 },
    schema: AdminUsersEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Could not load staff accounts',
  })
  return response.users
}

export async function setHostedStaffBan(
  userId: string,
  banned: boolean,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<HostedStaffUser> {
  const response = await apiRequest(`${AUTH_BASE}/admin/${banned ? 'ban-user' : 'unban-user'}`, {
    method: 'POST',
    body: banned ? { userId, banReason: 'Suspended by a Fuma administrator' } : { userId },
    schema: HostedUserEnvelopeSchema,
    fetchImpl,
    fallbackMessage: banned ? 'Could not suspend staff account' : 'Could not restore staff account',
  })
  return response.user
}

export async function logoutHostedStaff(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<void> {
  await apiRequest(`${AUTH_BASE}/sign-out`, {
    method: 'POST',
    schema: SignOutEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Staff logout failed',
  })
}

export async function resendHostedStaffVerification(
  email: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<void> {
  await apiRequest(`${AUTH_BASE}/send-verification-email`, {
    method: 'POST',
    body: { email, callbackURL: '/admin?verified=true' },
    schema: StatusEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Verification email request failed',
  })
}

export async function requestHostedStaffPasswordReset(
  email: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<void> {
  await apiRequest(`${AUTH_BASE}/request-password-reset`, {
    method: 'POST',
    body: { email, redirectTo: '/admin/reset-password' },
    schema: PasswordResetRequestEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Password reset request failed',
  })
}

export async function resetHostedStaffPassword(
  token: string,
  newPassword: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<void> {
  await apiRequest(`${AUTH_BASE}/reset-password`, {
    method: 'POST',
    body: { token, newPassword },
    schema: StatusEnvelopeSchema,
    fetchImpl,
    fallbackMessage: 'Password reset failed',
  })
}
