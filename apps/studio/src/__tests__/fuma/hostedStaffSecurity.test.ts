import { describe, expect, it } from 'bun:test'
import type { DbClient } from '../../../server/db/client'
import {
  LEGACY_STAFF_SESSION_COOKIE,
  isLegacyHostedAuthPath,
} from '../../../server/auth/hosted/cutover'
import { createHostedStaffAuthBoundary } from '../../../server/auth/hosted/routes'
import { handleServerRequest } from '../../../server/router'

const STUDIO_ROOT = new URL('../../../', import.meta.url)

async function runNativeProbe(): Promise<string> {
  const child = Bun.spawn({
    cmd: [process.execPath, 'server/auth/hosted/hostedStaffSecurityProbe.ts'],
    cwd: STUDIO_ROOT.pathname,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Native hosted security probe failed: ${stderr || stdout}`)
  return stdout
}

function requestWithHost(
  url: string,
  init: RequestInit,
  host: string,
): Request {
  const NativeResponse = (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for('instatic.test.nativeResponse')
  ] as typeof Response
  const nativeHeaders = new NativeResponse(null, { headers: init.headers }).headers
  nativeHeaders.set('host', host)
  const request = new Request(url, init)
  Object.defineProperty(request, 'headers', { value: nativeHeaders })
  return request
}

describe('FUMA-013 hosted staff security and cutover', () => {
  it('proves MFA, recovery replay denial, lockout, sessions, bans, protected owner, and step-up', async () => {
    const evidence = await runNativeProbe()
    for (const marker of [
      '"passed":true',
      '"totp":true',
      '"recoveryReplayDenied":true',
      '"lockout":true',
      '"sessions":true',
      '"banAndRevoke":true',
      '"protectedOwner":true',
      '"stepUp":true',
      '"tokenBodiesOmitted":true',
      '"exactHostOriginPolicy":true',
      '"legacyCookieInvalidated":true',
      '"legacyAuthRemoved":true',
    ]) expect(evidence).toContain(marker)
  }, 30_000)

  it('cuts over only legacy identity paths and leaves content APIs reachable', () => {
    for (const path of [
      '/admin/api/cms/login',
      '/admin/api/cms/logout',
      '/admin/api/cms/setup/status',
      '/admin/api/cms/auth/step-up',
      '/admin/api/cms/me/mfa/totp/start',
      '/admin/api/cms/users/legacy-user',
      '/admin/api/cms/roles/owner',
    ]) expect(isLegacyHostedAuthPath(path)).toBe(true)

    for (const path of [
      '/admin/api/cms/media',
      '/admin/api/cms/media/folders',
      '/admin/api/cms/site-document',
      '/admin/api/cms/publish',
    ]) expect(isLegacyHostedAuthPath(path)).toBe(false)
  })

  it('enforces hosted policy before CMS call paths while leaving hosted-off routing untouched', async () => {
    const origin = 'https://app.trimly.co.ke'
    const hostedStaffAuth = createHostedStaffAuthBoundary({
      auth: {
        handler: async () => new Response(JSON.stringify({
          session: { token: 'raw-session-bearer', userId: 'staff-1' },
          user: { id: 'staff-1', email: 'staff@fuma.example' },
        }), { headers: { 'content-type': 'application/json' } }),
      },
      origin,
      cookieName: '__Host-fuma_staff',
      secureCookies: true,
    })
    const db = {} as DbClient

    const wrongHost = await handleServerRequest(requestWithHost(
      `${origin}/admin/api/cms/media`,
      {},
      'customer.example',
    ), { db, hostedStaffAuth })
    expect(wrongHost.status).toBe(404)
    expect(wrongHost.headers.getSetCookie()).toHaveLength(0)

    const hostileOrigin = await handleServerRequest(requestWithHost(
      `${origin}/admin/api/cms/media`,
      {
        method: 'POST',
        headers: {
          cookie: `${LEGACY_STAFF_SESSION_COOKIE}=old-bearer`,
          origin: 'https://evil.example',
        },
      },
      'app.trimly.co.ke',
    ), { db, hostedStaffAuth })
    expect(hostileOrigin.status).toBe(403)
    expect(hostileOrigin.headers.getSetCookie()[0]).toContain('Max-Age=0')

    const legacy = await handleServerRequest(requestWithHost(
      `${origin}/admin/api/cms/logout`,
      {
        method: 'POST',
        headers: {
          cookie: `${LEGACY_STAFF_SESSION_COOKIE}=old-bearer`,
        },
      },
      'app.trimly.co.ke',
    ), { db, hostedStaffAuth })
    expect(legacy.status).toBe(401)
    expect(legacy.headers.getSetCookie()).toHaveLength(1)
    expect(legacy.headers.getSetCookie()[0]).toContain('Max-Age=0')

    const session = await handleServerRequest(requestWithHost(
      `${origin}/api/auth/get-session`,
      {
        headers: {
          cookie: `${LEGACY_STAFF_SESSION_COOKIE}=old-bearer`,
        },
      },
      'app.trimly.co.ke',
    ), { db, hostedStaffAuth })
    expect(session.status).toBe(200)
    expect(await session.text()).not.toContain('raw-session-bearer')
    expect(session.headers.getSetCookie()[0]).toContain('Max-Age=0')

    const selfHosted = await handleServerRequest(new Request('http://localhost/health', {
      headers: { cookie: `${LEGACY_STAFF_SESSION_COOKIE}=self-hosted-bearer` },
    }), { db })
    expect(selfHosted.status).toBe(200)
    expect(selfHosted.headers.getSetCookie()).toHaveLength(0)
  })

  it('does not import legacy CMS auth into the hosted boundary', async () => {
    const hostedSources = await Promise.all([
      'server/auth/hosted/auth.ts',
      'server/auth/hosted/routes.ts',
      'server/auth/hosted/runtime.ts',
      'server/auth/hosted/cutover.ts',
    ].map(async (path) => await Bun.file(new URL(path, STUDIO_ROOT)).text()))
    const source = hostedSources.join('\n')
    expect(source).not.toContain('handlers/cms/auth')
    expect(source).not.toContain('SESSION_COOKIE_NAME')
    expect(source).not.toContain('/admin/api/cms/auth')

    const router = await Bun.file(new URL('server/router.ts', STUDIO_ROOT)).text()
    expect(router.indexOf('tryServeHostedStaffAuth')).toBeLessThan(router.indexOf('tryServeCmsApi'))
    expect(router.indexOf('tryRejectHostedLegacyAuth')).toBeLessThan(router.indexOf('tryServeCmsApi'))
    expect(router).toContain('invalidateLegacyStaffCookie(req, response)')
  })
})
