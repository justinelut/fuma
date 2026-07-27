import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HostedStaffShell } from '@admin/preauth/HostedStaffShell'
import type {
  HostedStaffDeviceSession,
  HostedStaffSession,
  HostedStaffUser,
} from '@core/fuma/auth'

const originalFetch = globalThis.fetch
const now = '2026-07-24T16:00:00.000Z'

function makeUser(overrides: Partial<HostedStaffUser> = {}): HostedStaffUser {
  return {
    id: 'staff_1',
    name: 'Sam Staff',
    email: 'sam@example.com',
    emailVerified: true,
    image: null,
    role: 'member',
    banned: false,
    twoFactorEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeSession(user = makeUser()): HostedStaffSession {
  return {
    session: {
      id: 'session_current',
      userId: user.id,
      expiresAt: '2026-08-24T16:00:00.000Z',
      createdAt: now,
      updatedAt: now,
    },
    user,
  }
}

function makeDevice(overrides: Partial<HostedStaffDeviceSession> = {}): HostedStaffDeviceSession {
  return {
    id: 'session_other',
    token: 'device-token',
    userId: 'staff_1',
    expiresAt: '2026-08-24T16:00:00.000Z',
    createdAt: now,
    updatedAt: now,
    ipAddress: '203.0.113.10',
    userAgent: 'Firefox on Linux',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url
}

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

describe('HostedStaffSecurity UI', () => {
  it('integrates with the shell and promotes a reauthenticated session to current UI state', async () => {
    const refreshed = makeSession(makeUser({ name: 'Sam Reauthenticated' }))
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/auth/list-sessions')) return jsonResponse([])
      if (url.endsWith('/api/auth/sign-in/email')) {
        return jsonResponse({ redirect: false, user: refreshed.user })
      }
      if (url.endsWith('/api/auth/get-session')) return jsonResponse(refreshed)
      return jsonResponse({ error: `Unhandled ${url}` }, 500)
    }) as typeof fetch

    render(<HostedStaffShell session={makeSession()} />)

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reauthenticate' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome, Sam Reauthenticated' })).toBeTruthy()
    })
    expect(screen.getByText('Reauthentication complete for sensitive operations.')).toBeTruthy()
  })

  it('supports a password reauth followed by the optional recovery-code challenge', async () => {
    const refreshed = makeSession(makeUser({ twoFactorEnabled: true }))
    const requested: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      requested.push(url)
      if (url.endsWith('/api/auth/list-sessions')) return jsonResponse([])
      if (url.endsWith('/api/auth/sign-in/email')) {
        return jsonResponse({ twoFactorRedirect: true, twoFactorMethods: ['totp', 'otp'] })
      }
      if (url.endsWith('/api/auth/two-factor/verify-backup-code')) {
        return jsonResponse({ user: refreshed.user })
      }
      if (url.endsWith('/api/auth/get-session')) return jsonResponse(refreshed)
      return jsonResponse({ error: `Unhandled ${url}` }, 500)
    }) as typeof fetch

    render(<HostedStaffShell session={refreshed} />)

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reauthenticate' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Use recovery code' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use recovery code' }))
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: 'backup-code-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify challenge' }))

    await waitFor(() => {
      expect(requested.some((url) => url.endsWith('/api/auth/two-factor/verify-backup-code'))).toBe(true)
    })
    expect(screen.getByText('Reauthentication complete for sensitive operations.')).toBeTruthy()
  })

  it('enrolls MFA with its own password and code fields and displays one-time recovery codes', async () => {
    const initial = makeSession()
    const enabled = makeSession(makeUser({ twoFactorEnabled: true }))
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/auth/list-sessions')) return jsonResponse([])
      if (url.endsWith('/api/auth/two-factor/enable')) {
        return jsonResponse({
          totpURI: 'otpauth://totp/Fuma:sam@example.com?secret=ABC123',
          backupCodes: ['recovery-one', 'recovery-two'],
        })
      }
      if (url.endsWith('/api/auth/two-factor/verify-totp')) {
        return jsonResponse({ user: enabled.user })
      }
      if (url.endsWith('/api/auth/get-session')) return jsonResponse(enabled)
      return jsonResponse({ error: `Unhandled ${url}` }, 500)
    }) as typeof fetch

    render(<HostedStaffShell session={initial} />)

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct horse battery staple' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))

    await waitFor(() => {
      expect(screen.getByText(/otpauth:\/\/totp\/Fuma/)).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }))

    await waitFor(() => {
      expect(screen.getByText('recovery-one')).toBeTruthy()
      expect(screen.getByText('recovery-two')).toBeTruthy()
    })
    expect(screen.getByText('Two-factor authentication is enabled. Save the recovery codes now.')).toBeTruthy()
  })

  it('rotates recovery codes and disables MFA with the dedicated password field', async () => {
    const enabled = makeSession(makeUser({ twoFactorEnabled: true }))
    const disabled = makeSession()
    const requested: string[] = []

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      requested.push(url)
      if (url.endsWith('/api/auth/list-sessions')) return jsonResponse([])
      if (url.endsWith('/api/auth/two-factor/generate-backup-codes')) {
        return jsonResponse({ status: true, backupCodes: ['rotated-one', 'rotated-two'] })
      }
      if (url.endsWith('/api/auth/two-factor/disable')) return jsonResponse({ status: true })
      if (url.endsWith('/api/auth/sign-in/email')) {
        return jsonResponse({ redirect: false, user: disabled.user })
      }
      if (url.endsWith('/api/auth/get-session')) return jsonResponse(disabled)
      return jsonResponse({ error: `Unhandled ${url}` }, 500)
    }) as typeof fetch

    render(<HostedStaffShell session={enabled} />)

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct horse battery staple' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'New recovery codes' }))

    await waitFor(() => {
      expect(screen.getByText('rotated-one')).toBeTruthy()
      expect(screen.getByText('rotated-two')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct horse battery staple' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Disable two-factor' }))

    await waitFor(() => {
      expect(screen.getByText('Two-factor authentication is disabled.')).toBeTruthy()
    })
    expect(requested.some((url) => url.endsWith('/api/auth/two-factor/disable'))).toBe(true)
    expect(screen.getByText('Not enabled')).toBeTruthy()
  })

  it('lists and revokes devices and lets an administrator suspend another staff account', async () => {
    const admin = makeUser({ role: 'admin' })
    const teammate = makeUser({ id: 'staff_2', name: 'Taylor Teammate', email: 'taylor@example.com' })
    let devices: readonly HostedStaffDeviceSession[] = [makeDevice()]
    let teammateBanned = false

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/auth/list-sessions')) return jsonResponse(devices)
      if (url.includes('/api/auth/admin/list-users')) {
        return jsonResponse({ users: [admin, { ...teammate, banned: teammateBanned }], total: 2 })
      }
      if (url.endsWith('/api/auth/revoke-session')) {
        devices = []
        return jsonResponse({ status: true })
      }
      if (url.endsWith('/api/auth/admin/ban-user')) {
        teammateBanned = true
        return jsonResponse({ user: { ...teammate, banned: true } })
      }
      return jsonResponse({ error: `Unhandled ${url}` }, 500)
    }) as typeof fetch

    render(<HostedStaffShell session={makeSession(admin)} />)

    await waitFor(() => {
      expect(screen.getByText('Firefox on Linux')).toBeTruthy()
      expect(screen.getByText('Taylor Teammate')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => {
      expect(screen.getByText('No device sessions found.')).toBeTruthy()
    })

    const teammateRow = screen.getByText('Taylor Teammate').closest('li')
    if (!teammateRow) throw new Error('Expected teammate staff row')
    fireEvent.click(within(teammateRow).getByRole('button', { name: 'Suspend' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
    })
  })
})
