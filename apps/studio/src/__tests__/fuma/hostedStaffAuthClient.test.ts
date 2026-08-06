import { describe, expect, it } from 'bun:test'
import type { FetchLike } from '@core/http'
import {
  beginHostedStaffGoogleSignIn,
  beginHostedStaffTotp,
  disableHostedStaffTotp,
  getHostedStaffSession,
  listHostedStaffSessions,
  listHostedStaffUsers,
  loginHostedStaff,
  logoutHostedStaff,
  regenerateHostedStaffRecoveryCodes,
  requestHostedStaffPasswordReset,
  resendHostedStaffVerification,
  resetHostedStaffPassword,
  revokeHostedStaffSession,
  revokeOtherHostedStaffSessions,
  setHostedStaffBan,
  signUpHostedStaff,
  verifyHostedStaffRecoveryCode,
  verifyHostedStaffTotp,
} from '@core/fuma/auth'

interface ExpectedRequest {
  path: string
  method?: string
  body?: unknown
  response: unknown
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function scriptedFetch(expectedRequests: readonly ExpectedRequest[]): Readonly<{
  fetchImpl: FetchLike
  expectComplete: () => void
}> {
  let requestIndex = 0
  const fetchImpl: FetchLike = async (input, init) => {
    const expected = expectedRequests[requestIndex]
    requestIndex += 1
    if (!expected) throw new Error(`Unexpected request to ${String(input)}`)

    expect(String(input)).toBe(expected.path)
    expect(init?.method).toBe(expected.method ?? 'GET')
    expect(init?.credentials).toBe('include')
    if (expected.body === undefined) {
      expect(init?.body).toBeUndefined()
      expect(new Headers(init?.headers).has('content-type')).toBe(false)
    } else {
      expect(init?.body).toBe(JSON.stringify(expected.body))
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    }
    return jsonResponse(expected.response)
  }
  return {
    fetchImpl,
    expectComplete: () => expect(requestIndex).toBe(expectedRequests.length),
  }
}

const user = {
  id: 'staff-1',
  name: 'Fuma Staff',
  email: 'staff@fuma.example',
  emailVerified: true,
  image: null,
  role: 'admin',
  banned: false,
  banReason: null,
  banExpires: null,
  twoFactorEnabled: true,
  createdAt: '2026-07-24T12:00:00.000Z',
  updatedAt: '2026-07-24T12:01:00.000Z',
}

const session = {
  session: {
    id: 'session-1',
    userId: user.id,
    expiresAt: '2026-08-24T12:00:00.000Z',
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
    ipAddress: '203.0.113.7',
    userAgent: 'Contract Test',
    activeOrganizationId: null,
    impersonatedBy: null,
  },
  user,
}

const deviceSession = {
  ...session.session,
  token: 'opaque-revocation-handle',
}

const loginInput = {
  email: user.email,
  password: 'correct horse battery staple',
}

describe('FUMA-013 hosted staff auth client contract', () => {
  it('starts Google through the fixed same-origin central handoff', async () => {
    expect(await beginHostedStaffGoogleSignIn('https://app.trimly.co.ke/admin'))
      .toBe('https://app.trimly.co.ke/api/auth/central-google')
    await expect(beginHostedStaffGoogleSignIn('https://attacker.example/admin?redirect=1'))
      .rejects.toThrow('admin root')
  })
  it('distinguishes password authentication from an MFA challenge and confirms cookie sessions', async () => {
    const challenge = scriptedFetch([{
      path: '/api/auth/sign-in/email',
      method: 'POST',
      body: loginInput,
      response: { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
    }])
    expect(await loginHostedStaff(loginInput, challenge.fetchImpl)).toEqual({
      kind: 'two-factor',
      methods: ['totp'],
    })
    challenge.expectComplete()

    const authenticated = scriptedFetch([
      {
        path: '/api/auth/sign-in/email',
        method: 'POST',
        body: loginInput,
        response: { redirect: false, user },
      },
      { path: '/api/auth/get-session', response: session },
    ])
    expect(await loginHostedStaff(loginInput, authenticated.fetchImpl)).toEqual({
      kind: 'authenticated',
      session,
    })
    authenticated.expectComplete()
  })

  it('completes TOTP and recovery challenges, then reads the cookie-backed session', async () => {
    const totp = scriptedFetch([
      {
        path: '/api/auth/two-factor/verify-totp',
        method: 'POST',
        body: { code: '123456' },
        response: { user },
      },
      { path: '/api/auth/get-session', response: session },
    ])
    expect(await verifyHostedStaffTotp('123456', totp.fetchImpl)).toEqual(session)
    totp.expectComplete()

    const recovery = scriptedFetch([
      {
        path: '/api/auth/two-factor/verify-backup-code',
        method: 'POST',
        body: { code: 'recovery-code-1' },
        response: { user },
      },
      { path: '/api/auth/get-session', response: session },
    ])
    expect(await verifyHostedStaffRecoveryCode('recovery-code-1', recovery.fetchImpl)).toEqual(session)
    recovery.expectComplete()
  })

  it('models MFA setup, disable, and recovery-code rotation envelopes', async () => {
    const requests = scriptedFetch([
      {
        path: '/api/auth/two-factor/enable',
        method: 'POST',
        body: { password: loginInput.password },
        response: {
          totpURI: 'otpauth://totp/Fuma:staff?secret=ABCDEF&issuer=Fuma',
          backupCodes: ['backup-1', 'backup-2'],
        },
      },
      {
        path: '/api/auth/two-factor/generate-backup-codes',
        method: 'POST',
        body: { password: loginInput.password },
        response: { status: true, backupCodes: ['rotated-1', 'rotated-2'] },
      },
      {
        path: '/api/auth/two-factor/disable',
        method: 'POST',
        body: { password: loginInput.password },
        response: { status: true },
      },
    ])

    expect(await beginHostedStaffTotp(loginInput.password, requests.fetchImpl)).toEqual({
      totpURI: 'otpauth://totp/Fuma:staff?secret=ABCDEF&issuer=Fuma',
      backupCodes: ['backup-1', 'backup-2'],
    })
    expect(await regenerateHostedStaffRecoveryCodes(loginInput.password, requests.fetchImpl)).toEqual([
      'rotated-1',
      'rotated-2',
    ])
    await disableHostedStaffTotp(loginInput.password, requests.fetchImpl)
    requests.expectComplete()
  })

  it('lists and revokes self sessions while omitting bodies for cookie-only mutations', async () => {
    const requests = scriptedFetch([
      { path: '/api/auth/list-sessions', response: [deviceSession] },
      {
        path: '/api/auth/revoke-session',
        method: 'POST',
        body: { token: deviceSession.token },
        response: { status: true },
      },
      {
        path: '/api/auth/revoke-other-sessions',
        method: 'POST',
        response: { status: true },
      },
      {
        path: '/api/auth/sign-out',
        method: 'POST',
        response: { success: true },
      },
    ])

    expect(await listHostedStaffSessions(requests.fetchImpl)).toEqual([deviceSession])
    await revokeHostedStaffSession(deviceSession.token, requests.fetchImpl)
    await revokeOtherHostedStaffSessions(requests.fetchImpl)
    await logoutHostedStaff(requests.fetchImpl)
    requests.expectComplete()
  })

  it('accepts the window Better Auth echoes with a staff page', async () => {
    const paged = scriptedFetch([{
      path: '/api/auth/admin/list-users?limit=100',
      response: { users: [user], total: 1, limit: 100, offset: 0 },
    }])
    expect(await listHostedStaffUsers(paged.fetchImpl)).toEqual([user])
    paged.expectComplete()
  })

  it('lists staff and models admin ban and unban requests', async () => {
    const bannedUser = { ...user, banned: true, banReason: 'Suspended by a Fuma administrator' }
    const requests = scriptedFetch([
      {
        path: '/api/auth/admin/list-users?limit=100',
        response: { users: [user], total: 1 },
      },
      {
        path: '/api/auth/admin/ban-user',
        method: 'POST',
        body: { userId: user.id, banReason: 'Suspended by a Fuma administrator' },
        response: { user: bannedUser },
      },
      {
        path: '/api/auth/admin/unban-user',
        method: 'POST',
        body: { userId: user.id },
        response: { user },
      },
    ])

    expect(await listHostedStaffUsers(requests.fetchImpl)).toEqual([user])
    expect(await setHostedStaffBan(user.id, true, requests.fetchImpl)).toEqual(bannedUser)
    expect(await setHostedStaffBan(user.id, false, requests.fetchImpl)).toEqual(user)
    requests.expectComplete()
  })

  it('models signup, verification resend, and password-reset request and completion', async () => {
    const signUpInput = { name: user.name, email: user.email, password: loginInput.password }
    const requests = scriptedFetch([
      {
        path: '/api/auth/sign-up/email',
        method: 'POST',
        body: { ...signUpInput, callbackURL: '/admin?verified=true' },
        response: { token: null, user: { ...user, emailVerified: false } },
      },
      {
        path: '/api/auth/send-verification-email',
        method: 'POST',
        body: { email: user.email, callbackURL: '/admin?verified=true' },
        response: { status: true },
      },
      {
        path: '/api/auth/request-password-reset',
        method: 'POST',
        body: { email: user.email, redirectTo: '/admin/reset-password' },
        response: { status: true, message: 'If this email exists, check your inbox' },
      },
      {
        path: '/api/auth/reset-password',
        method: 'POST',
        body: { token: 'reset-token', newPassword: 'new correct horse battery staple' },
        response: { status: true },
      },
    ])

    expect(await signUpHostedStaff(signUpInput, requests.fetchImpl)).toEqual({
      ...user,
      emailVerified: false,
    })
    await resendHostedStaffVerification(user.email, requests.fetchImpl)
    await requestHostedStaffPasswordReset(user.email, requests.fetchImpl)
    await resetHostedStaffPassword(
      'reset-token',
      'new correct horse battery staple',
      requests.fetchImpl,
    )
    requests.expectComplete()
  })

  it('rejects leaked bearer tokens and endpoint-specific envelope drift', async () => {
    const leakedSession = scriptedFetch([{
      path: '/api/auth/get-session',
      response: { ...session, session: { ...session.session, token: 'bearer-secret' } },
    }])
    await expect(getHostedStaffSession(leakedSession.fetchImpl)).rejects.toThrow()
    leakedSession.expectComplete()

    const leakedLogin = scriptedFetch([{
      path: '/api/auth/sign-in/email',
      method: 'POST',
      body: loginInput,
      response: { redirect: false, token: 'bearer-secret', user },
    }])
    await expect(loginHostedStaff(loginInput, leakedLogin.fetchImpl)).rejects.toThrow()
    leakedLogin.expectComplete()

    const leakedMfa = scriptedFetch([{
      path: '/api/auth/two-factor/verify-totp',
      method: 'POST',
      body: { code: '123456' },
      response: { token: 'bearer-secret', user },
    }])
    await expect(verifyHostedStaffTotp('123456', leakedMfa.fetchImpl)).rejects.toThrow()
    leakedMfa.expectComplete()

    const wrongLogout = scriptedFetch([{
      path: '/api/auth/sign-out',
      method: 'POST',
      response: { status: true },
    }])
    await expect(logoutHostedStaff(wrongLogout.fetchImpl)).rejects.toThrow()
    wrongLogout.expectComplete()
  })
})
