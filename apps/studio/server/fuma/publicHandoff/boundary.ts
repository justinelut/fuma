import { PublicHandoffEnvelopeSchema, PublicHandoffRequestSchema } from '@fuma/public-contracts'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { HostedStaffAuthBoundary } from '../../auth/hosted/routes'
import {
  APP_HANDOFF_SESSION_COOKIE,
  AppHandoffCancelRequestSchema,
  AppHandoffExchangeRequestSchema,
  AppHandoffStartQuerySchema,
  type AppHandoffCancelRequest,
  type AppHandoffExchangeRequest,
  type AppHandoffStartQuery,
} from './contracts'
import { PublicHandoffAuthorityError } from './authority'
import { PublicHandoffStoreError } from './repository'
import type { PublicHandoffService } from './service'

const PRIVATE_HANDOFF_PATH = '/_fuma/private/public/v1/handoff'
const AUTH_AUTHORIZE_PATH = '/handoff/authorize'
const AUTH_SIGN_IN_PATH = '/handoff/sign-in'
const AUTH_TWO_FACTOR_PATH = '/handoff/two-factor'
const AUTH_CANCEL_PATH = '/handoff/cancel'
const APP_RESUME_PATH = '/resume'
const APP_EXCHANGE_PATH = '/resume/exchange'
const APP_CANCEL_PATH = '/resume/cancel'
const PUBLIC_IDENTITY_PATHS = new Set([
  '/api/auth/sign-up/email',
  '/api/auth/sign-in/email',
  '/api/auth/send-verification-email',
  '/api/auth/verify-email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/two-factor/verify-totp',
  '/api/auth/two-factor/verify-backup-code',
])
const MAX_BODY_BYTES = 4_096

const LoginFormSchema = Type.Object({
  mode: Type.Union([Type.Literal('sign-in'), Type.Literal('sign-up')]),
  email: Type.String({ minLength: 3, maxLength: 320, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 100, pattern: '^[^\\u0000-\\u001F\\u007F]+$' })),
  intent: Type.String({ minLength: 32, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  correlation: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
}, { additionalProperties: false })

type LoginForm = typeof LoginFormSchema.static

const AuthContinuationSchema = Type.Object({
  twoFactorRedirect: Type.Optional(Type.Boolean()),
}, { additionalProperties: true })

const TwoFactorFormSchema = Type.Object({
  code: Type.String({ pattern: '^[0-9]{6}$' }),
  intent: Type.String({ minLength: 32, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  correlation: Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
}, { additionalProperties: false })
type TwoFactorForm = typeof TwoFactorFormSchema.static

export interface PublicHandoffIssuer {
  issue(value: unknown): Promise<Response>
}

export interface PublicHandoffAppBoundary {
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}

export type PublicHandoffAppBoundaryInput = Readonly<{
  service: PublicHandoffService
  appOrigin: string
  authOrigin: string
  marketingOrigin: string
  secureCookies: boolean
  identityAuth: HostedStaffAuthBoundary
  resolveIdentitySession(headers: Headers): Promise<HostedResolvedSession | null>
}>

function noStoreHeaders(contentType = 'text/html; charset=utf-8'): Headers {
  return new Headers({
    'cache-control': 'no-store, max-age=0',
    'content-type': contentType,
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
}

function html(value: string, status = 200, extra?: HeadersInit): Response {
  const headers = noStoreHeaders()
  if (extra) for (const [key, item] of new Headers(extra)) headers.append(key, item)
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Continue to Fuma</title><style>body{font:16px/1.5 system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#171717}main{border:1px solid #ddd;border-radius:16px;padding:2rem}label{display:block;margin:.8rem 0}input,button{font:inherit;padding:.7rem;width:100%;box-sizing:border-box}button{margin-top:.7rem;cursor:pointer}.secondary{background:#fff}p{overflow-wrap:anywhere}</style><main>${value}</main></html>`, { status, headers })
}

function escaped(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function redirect(target: string, headers?: HeadersInit): Response {
  const output = noStoreHeaders('text/plain; charset=utf-8')
  output.set('location', target)
  const cookies: string[] = []
  if (headers) {
    for (const [key, value] of new Headers(headers)) {
      if (key.toLowerCase() === 'set-cookie') cookies.push(value)
      else output.append(key, value)
    }
  }
  const response = new Response(null, { status: 303, headers: output })
  for (const cookie of cookies) response.headers.append('set-cookie', cookie)
  return response
}

function responseSetCookies(headers: Headers): readonly string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const separate = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : []
  if (separate.length > 0) return separate
  const combined = headers.get('set-cookie')
  return combined ? [combined] : []
}

function fixedUrl(origin: string, path: string, values: Readonly<Record<string, string>>): string {
  const url = new URL(path, origin)
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value)
  return url.toString()
}

function exactHost(request: Request, origin: string): boolean {
  const expected = new URL(origin)
  const url = new URL(request.url)
  const hostHeader = request.headers.get('host')
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim().toLowerCase()
  const effectiveProtocol = forwardedProtocol === 'https' || forwardedProtocol === 'http'
    ? `${forwardedProtocol}:`
    : url.protocol
  return effectiveProtocol === expected.protocol
    && url.host.toLowerCase() === expected.host.toLowerCase()
    && (hostHeader === null || hostHeader.toLowerCase() === expected.host.toLowerCase())
}

function queryValue(url: URL, schema: typeof AppHandoffStartQuerySchema | typeof AppHandoffExchangeRequestSchema): AppHandoffStartQuery | AppHandoffExchangeRequest | null {
  const value = Object.fromEntries(url.searchParams)
  if ([...url.searchParams.keys()].length !== Object.keys(value).length || !Value.Check(schema, value)) return null
  return value as AppHandoffStartQuery | AppHandoffExchangeRequest
}

async function formValue(request: Request, schema: typeof LoginFormSchema): Promise<LoginForm | null>
async function formValue(request: Request, schema: typeof TwoFactorFormSchema): Promise<TwoFactorForm | null>
async function formValue(request: Request, schema: typeof AppHandoffExchangeRequestSchema): Promise<AppHandoffExchangeRequest | null>
async function formValue(request: Request, schema: typeof AppHandoffCancelRequestSchema): Promise<AppHandoffCancelRequest | null>
async function formValue(request: Request, schema: typeof LoginFormSchema | typeof TwoFactorFormSchema | typeof AppHandoffExchangeRequestSchema | typeof AppHandoffCancelRequestSchema): Promise<LoginForm | TwoFactorForm | AppHandoffExchangeRequest | AppHandoffCancelRequest | null> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') return null
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  let text: string
  try { text = await request.text() } catch { return null }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null
  const params = new URLSearchParams(text)
  const value = Object.fromEntries(params)
  if ([...params.keys()].length !== Object.keys(value).length || !Value.Check(schema, value)) return null
  return value as LoginForm | TwoFactorForm | AppHandoffExchangeRequest | AppHandoffCancelRequest
}

function cookie(request: Request, name: string): string | null {
  const matches: string[] = []
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try { matches.push(decodeURIComponent(part.slice(separator + 1).trim())) } catch { return null }
  }
  return matches.length === 1 ? matches[0]! : null
}

function appCookie(name: string, token: string, maxAge: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

function loginPage(query: AppHandoffStartQuery, mode: 'sign-in' | 'sign-up', message = ''): Response {
  const label = mode === 'sign-up' ? 'Create account' : 'Sign in'
  const introduction = mode === 'sign-up'
    ? 'Create your account to start using Fuma.'
    : 'Welcome back. Sign in to continue.'
  const passwordAutocomplete = mode === 'sign-up' ? 'new-password' : 'current-password'
  return html(`<h1>${label} to Fuma</h1>${message ? `<p role="alert">${escaped(message)}</p>` : ''}<p>${introduction}</p><form method="post" action="${AUTH_SIGN_IN_PATH}"><input type="hidden" name="mode" value="${mode}"><input type="hidden" name="intent" value="${escaped(query.intent)}"><input type="hidden" name="correlation" value="${escaped(query.correlation)}">${mode === 'sign-up' ? '<label>Name<input required autocomplete="name" name="displayName" maxlength="100"></label>' : ''}<label>Email<input required type="email" autocomplete="email" name="email"></label><label>Password<input required type="password" autocomplete="${passwordAutocomplete}" minlength="8" maxlength="128" name="password"></label><button type="submit">${label}</button></form><form method="post" action="${AUTH_CANCEL_PATH}"><input type="hidden" name="kind" value="intent"><input type="hidden" name="intent" value="${escaped(query.intent)}"><input type="hidden" name="correlation" value="${escaped(query.correlation)}"><button class="secondary" type="submit">Cancel</button></form>`)
}

function twoFactorPage(query: AppHandoffStartQuery, message = '', cookies: readonly string[] = []): Response {
  const response = html(`<h1>Verify it’s you</h1>${message ? `<p role="alert">${escaped(message)}</p>` : ''}<p>Enter the six-digit code from your authenticator app.</p><form method="post" action="${AUTH_TWO_FACTOR_PATH}"><input type="hidden" name="intent" value="${escaped(query.intent)}"><input type="hidden" name="correlation" value="${escaped(query.correlation)}"><label>Authentication code<input required inputmode="numeric" autocomplete="one-time-code" name="code" pattern="[0-9]{6}" maxlength="6"></label><button type="submit">Verify</button></form>`)
  for (const cookie of cookies) response.headers.append('set-cookie', cookie)
  return response
}

function exchangePage(value: AppHandoffExchangeRequest): Response {
  return html(`<h1>Continue to Fuma</h1><p>You’re signed in. Continue to finish what you started.</p><form method="post" action="${APP_EXCHANGE_PATH}"><input type="hidden" name="code" value="${escaped(value.code)}"><input type="hidden" name="state" value="${escaped(value.state)}"><button type="submit">Continue</button></form><form method="post" action="${APP_CANCEL_PATH}"><input type="hidden" name="kind" value="code"><input type="hidden" name="code" value="${escaped(value.code)}"><input type="hidden" name="state" value="${escaped(value.state)}"><button class="secondary" type="submit">Cancel</button></form>`)
}

function safeFailure(error: unknown): Response {
  const status = error instanceof PublicHandoffStoreError && (error.code === 'expired' || error.code === 'replayed' || error.code === 'cancelled') ? 410 : 400
  return html('<h1>This link no longer works</h1><p>Return to Fuma and try again.</p>', status)
}

export function createPublicHandoffIssuer(service: PublicHandoffService): PublicHandoffIssuer {
  return Object.freeze({
    async issue(value: unknown): Promise<Response> {
      if (!Value.Check(PublicHandoffRequestSchema, value)) return new Response(null, { status: 400, headers: noStoreHeaders('application/json; charset=utf-8') })
      try {
        const issued = await service.issue(value)
        const envelope = {
          data: issued,
          meta: { schemaVersion: 1, datasetVersion: 'public-handoff:v1', etag: `"${issued.correlation}"` },
        }
        if (!Value.Check(PublicHandoffEnvelopeSchema, envelope)) throw new TypeError('Invalid handoff envelope.')
        return new Response(JSON.stringify(envelope), { status: 201, headers: noStoreHeaders('application/json; charset=utf-8') })
      } catch {
        return new Response(null, { status: 503, headers: noStoreHeaders('application/json; charset=utf-8') })
      }
    },
  })
}

export function createPublicHandoffAppBoundary(input: PublicHandoffAppBoundaryInput): PublicHandoffAppBoundary {
  const app = new URL(input.appOrigin)
  const auth = new URL(input.authOrigin)
  if (app.pathname !== '/' || auth.pathname !== '/' || app.origin === auth.origin || new URL(input.marketingOrigin).pathname !== '/') throw new TypeError('Public handoff origins must be distinct origins without paths.')

  const appCookieName = input.secureCookies ? APP_HANDOFF_SESSION_COOKIE : 'fuma_app'

  function publicIdentityPath(path: string): boolean {
    return PUBLIC_IDENTITY_PATHS.has(path) || /^\/api\/auth\/reset-password\/[^/]+$/.test(path)
  }

  function handles(request: Request): boolean {
    const path = new URL(request.url).pathname
    return (exactHost(request, input.appOrigin) && [APP_RESUME_PATH, APP_EXCHANGE_PATH, APP_CANCEL_PATH].includes(path))
      || (exactHost(request, input.authOrigin) && (path === AUTH_AUTHORIZE_PATH || path === AUTH_SIGN_IN_PATH || path === AUTH_TWO_FACTOR_PATH || path === AUTH_CANCEL_PATH || publicIdentityPath(path)))
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const url = new URL(request.url)
    try {
      if (exactHost(request, input.authOrigin) && publicIdentityPath(url.pathname)) return await input.identityAuth.handle(request)
      if (request.method === 'GET' && url.pathname === AUTH_AUTHORIZE_PATH) {
        const value = queryValue(url, AppHandoffStartQuerySchema) as AppHandoffStartQuery | null
        if (!value) return safeFailure(null)
        const session = await input.resolveIdentitySession(request.headers)
        if (!session) return loginPage(value, 'sign-in')
        if (session.impersonatedBy !== null) return safeFailure(null)
        const code = await input.service.authorize(value, session.userId, session.sessionId)
        return redirect(fixedUrl(input.appOrigin, APP_RESUME_PATH, { code: code.code, state: code.state }))
      }
      if (request.method === 'POST' && url.pathname === AUTH_SIGN_IN_PATH) {
        if (request.headers.get('origin') !== input.authOrigin || url.search) return safeFailure(null)
        const form = await formValue(request, LoginFormSchema)
        if (!form || (form.mode === 'sign-up' && !form.displayName) || (form.mode === 'sign-in' && form.displayName !== undefined)) return safeFailure(null)
        const endpoint = form.mode === 'sign-up' ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email'
        const authRequest = new Request(new URL(endpoint, input.authOrigin), {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: input.authOrigin, host: auth.host, cookie: request.headers.get('cookie') ?? '' },
          body: JSON.stringify({
            email: form.email,
            password: form.password,
            callbackURL: fixedUrl(input.authOrigin, AUTH_AUTHORIZE_PATH, { intent: form.intent, correlation: form.correlation }),
            ...(form.displayName ? { name: form.displayName } : {}),
          }),
        })
        const authenticated = await input.identityAuth.handle(authRequest)
        if (!authenticated?.ok) return loginPage({ intent: form.intent, correlation: form.correlation }, form.mode, 'Authentication was not accepted. Check your details and try again.')
        const headers = new Headers()
        const setCookies = responseSetCookies(authenticated.headers)
        for (const value of setCookies) headers.append('set-cookie', value)
        let authResult: unknown = null
        try { authResult = await authenticated.clone().json() } catch { authResult = null }
        if (Value.Check(AuthContinuationSchema, authResult) && authResult.twoFactorRedirect === true) {
          return twoFactorPage({ intent: form.intent, correlation: form.correlation }, '', setCookies)
        }
        return redirect(fixedUrl(input.authOrigin, AUTH_AUTHORIZE_PATH, { intent: form.intent, correlation: form.correlation }), headers)
      }
      if (request.method === 'POST' && url.pathname === AUTH_TWO_FACTOR_PATH) {
        if (request.headers.get('origin') !== input.authOrigin || url.search) return safeFailure(null)
        const form = await formValue(request, TwoFactorFormSchema)
        if (!form) return safeFailure(null)
        const verification = await input.identityAuth.handle(new Request(new URL('/api/auth/two-factor/verify-totp', input.authOrigin), {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: input.authOrigin, host: auth.host, cookie: request.headers.get('cookie') ?? '' },
          body: JSON.stringify({ code: form.code, trustDevice: false }),
        }))
        if (!verification?.ok) return twoFactorPage({ intent: form.intent, correlation: form.correlation }, 'The verification code was not accepted.')
        const headers = new Headers()
        const setCookies = responseSetCookies(verification.headers)
        for (const value of setCookies) headers.append('set-cookie', value)
        return redirect(fixedUrl(input.authOrigin, AUTH_AUTHORIZE_PATH, { intent: form.intent, correlation: form.correlation }), headers)
      }
      if (request.method === 'GET' && url.pathname === APP_RESUME_PATH) {
        if (url.searchParams.has('intent')) {
          const value = queryValue(url, AppHandoffStartQuerySchema) as AppHandoffStartQuery | null
          if (!value) return safeFailure(null)
          const appSession = await input.service.resolveSession(cookie(request, appCookieName))
          if (appSession) {
            const code = await input.service.authorize(value, appSession.userId, appSession.identitySessionId)
            return redirect(fixedUrl(input.appOrigin, APP_RESUME_PATH, { code: code.code, state: code.state }))
          }
          return redirect(fixedUrl(input.authOrigin, AUTH_AUTHORIZE_PATH, { intent: value.intent, correlation: value.correlation }))
        }
        const value = queryValue(url, AppHandoffExchangeRequestSchema) as AppHandoffExchangeRequest | null
        if (!value) return safeFailure(null)
        await input.service.inspectCode(value)
        return exchangePage(value)
      }
      if (request.method === 'POST' && url.pathname === APP_EXCHANGE_PATH) {
        if (request.headers.get('origin') !== input.appOrigin || url.search) return safeFailure(null)
        const value = await formValue(request, AppHandoffExchangeRequestSchema)
        if (!value) return safeFailure(null)
        const result = await input.service.exchange(value)
        const maxAge = Math.max(1, Math.floor((Date.parse(result.session.expiresAt) - Date.now()) / 1_000))
        const response = redirect(new URL('/admin', input.appOrigin).toString())
        response.headers.append('set-cookie', appCookie(appCookieName, result.session.token, maxAge, input.secureCookies))
        return response
      }
      if (request.method === 'POST' && (url.pathname === APP_CANCEL_PATH || url.pathname === AUTH_CANCEL_PATH)) {
        const expectedOrigin = url.pathname === APP_CANCEL_PATH ? input.appOrigin : input.authOrigin
        if (request.headers.get('origin') !== expectedOrigin || url.search) return safeFailure(null)
        const value = await formValue(request, AppHandoffCancelRequestSchema)
        if (!value) return safeFailure(null)
        await input.service.cancel(value)
        return redirect(input.marketingOrigin)
      }
      return new Response(null, { status: 405, headers: noStoreHeaders('text/plain; charset=utf-8') })
    } catch (error) {
      if (error instanceof PublicHandoffAuthorityError || error instanceof PublicHandoffStoreError || error instanceof TypeError) return safeFailure(error)
      return html('<h1>Fuma is temporarily unavailable</h1><p>Try again in a moment.</p>', 503)
    }
  }

  return Object.freeze({ handles, handle })
}

export { PRIVATE_HANDOFF_PATH }
