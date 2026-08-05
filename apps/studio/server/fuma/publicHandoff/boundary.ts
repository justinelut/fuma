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
const AUTH_GOOGLE_PATH = '/handoff/google'
const AUTH_TWO_FACTOR_PATH = '/handoff/two-factor'
const AUTH_CANCEL_PATH = '/handoff/cancel'
const APP_RESUME_PATH = '/resume'
const APP_EXCHANGE_PATH = '/resume/exchange'
const APP_CANCEL_PATH = '/resume/cancel'
const PUBLIC_IDENTITY_PATHS = new Set([
  '/api/auth/sign-up/email',
  '/api/auth/sign-in/email',
  '/api/auth/sign-in/social',
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


const SocialAuthorizationSchema = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 4_096 }),
  redirect: Type.Optional(Type.Boolean()),
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
  googleAuthEnabled?: boolean
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

const HANDOFF_STYLES = String.raw`
:root{color-scheme:dark;--bg:#090909;--fg:#f5f5f2;--card:#111;--inset:#171717;--muted:#aaa9a3;--line:#30302d;--line-strong:#55544f;--accent:#ffd43b;--control:#181818;--control-hover:#222;--error:#ff9c9c}
@media(prefers-color-scheme:light){:root{color-scheme:light;--bg:#f3f2ed;--fg:#171714;--card:#fff;--inset:#f7f6f1;--muted:#66645c;--line:#d8d6ce;--line-strong:#aaa79d;--accent:#7a5d00;--control:#f3f2ed;--control-hover:#e9e7df;--error:#9f2727}}
*{box-sizing:border-box}html{min-height:100%;background:var(--bg)}body{min-height:100vh;margin:0;padding:1rem;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(100%,32rem);border:1px solid var(--line);border-radius:.75rem;background:var(--card)}.panel{padding:clamp(1.5rem,6vw,3rem)}.brand{display:flex;align-items:center;gap:.7rem;margin-bottom:2.75rem;font-weight:700;letter-spacing:-.02em}.mark{display:grid;width:1.9rem;height:1.9rem;place-items:center;border:1px solid var(--line-strong);border-radius:.35rem;color:var(--fg);font:700 .72rem/1 ui-monospace,SFMono-Regular,monospace}.eyebrow{margin:0 0 .7rem;color:var(--muted);font:700 .7rem/1.2 ui-monospace,SFMono-Regular,monospace;text-transform:uppercase;letter-spacing:.11em}h1{margin:0;font-size:clamp(2rem,8vw,3rem);font-weight:560;line-height:1;letter-spacing:-.045em}.lede{margin:1rem 0 2rem;color:var(--muted)}.alert{margin:0 0 1rem;padding:.8rem .9rem;border:1px solid var(--error);border-radius:.45rem;color:var(--error)}form{margin:0}.fields{display:grid;gap:1rem}label{display:grid;gap:.4rem;color:var(--muted);font-size:.78rem;font-weight:650}input{width:100%;min-height:3rem;padding:.7rem .85rem;border:1px solid var(--line);border-radius:.45rem;outline:none;background:var(--inset);color:var(--fg);font:inherit}input:focus{border-color:var(--accent);outline:2px solid var(--accent);outline-offset:1px}button,.social{display:flex;width:100%;min-height:3rem;align-items:center;justify-content:center;gap:.65rem;border:1px solid var(--line-strong);border-radius:.45rem;padding:.72rem 1rem;background:var(--control);color:var(--fg);font:650 .92rem/1 inherit;text-decoration:none;cursor:pointer}.primary{margin-top:1.2rem;border-color:var(--fg);background:var(--fg);color:var(--bg)}.secondary{margin-top:.7rem;color:var(--muted)}button:hover,.social:hover{background:var(--control-hover)}.primary:hover{background:var(--fg)}button:focus-visible,.social:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.googleMark{width:1rem;height:1rem}.divider{display:flex;align-items:center;gap:.8rem;margin:1.3rem 0;color:var(--muted);font-size:.72rem}.divider:before,.divider:after{content:"";height:1px;flex:1;background:var(--line)}.privacy{margin:1.4rem 0 0;color:var(--muted);font-size:.75rem}.privacy strong{color:var(--fg)}
@media(max-width:32rem){body{padding:0}.shell{min-height:100vh;border:0;border-radius:0}.panel{padding:1.5rem}.brand{margin-bottom:2.25rem}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`

function html(value: string, status = 200, extra?: HeadersInit): Response {
  const headers = noStoreHeaders()
  if (extra) for (const [key, item] of new Headers(extra)) headers.append(key, item)
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Continue to Fuma</title><style>${HANDOFF_STYLES}</style></head><body><div class="shell"><main class="panel"><div class="brand"><span class="mark" aria-hidden="true">F</span><span>Fuma</span></div>${value}</main></div></body></html>`, { status, headers })
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

function loginPage(query: AppHandoffStartQuery, mode: 'sign-in' | 'sign-up', message = '', googleAuthEnabled = false): Response {
  const label = mode === 'sign-up' ? 'Create account' : 'Sign in'
  const title = mode === 'sign-up' ? 'Create your Fuma account' : 'Welcome back'
  const introduction = mode === 'sign-up'
    ? 'One account for your sites, content, publishing, and team.'
    : 'Sign in to continue exactly where you left off.'
  const passwordAutocomplete = mode === 'sign-up' ? 'new-password' : 'current-password'
  const googleUrl = fixedUrl('https://placeholder.invalid', AUTH_GOOGLE_PATH, { intent: query.intent, correlation: query.correlation }).replace('https://placeholder.invalid', '')
  const google = googleAuthEnabled
    ? `<a class="social" href="${escaped(googleUrl)}"><svg class="googleMark" aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.5H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.5l3.3-2.6Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6A6 6 0 0 1 12 6Z"/></svg>Continue with Google</a><div class="divider"><span>or continue with email</span></div>`
    : ''
  return html(`<p class="eyebrow">Account access</p><h1>${title}</h1><p class="lede">${introduction}</p>${message ? `<p class="alert" role="alert">${escaped(message)}</p>` : ''}${google}<form method="post" action="${AUTH_SIGN_IN_PATH}"><input type="hidden" name="mode" value="${mode}"><input type="hidden" name="intent" value="${escaped(query.intent)}"><input type="hidden" name="correlation" value="${escaped(query.correlation)}"><div class="fields">${mode === 'sign-up' ? '<label><span>Name</span><input required autocomplete="name" name="displayName" maxlength="100"></label>' : ''}<label><span>Email</span><input required type="email" autocomplete="email" name="email"></label><label><span>Password</span><input required type="password" autocomplete="${passwordAutocomplete}" minlength="8" maxlength="128" name="password"></label></div><button class="primary" type="submit">${label}</button></form><form method="post" action="${AUTH_CANCEL_PATH}"><input type="hidden" name="kind" value="intent"><input type="hidden" name="intent" value="${escaped(query.intent)}"><input type="hidden" name="correlation" value="${escaped(query.correlation)}"><button class="secondary" type="submit">Back to Fuma</button></form><p class="privacy"><strong>Private by default.</strong> Sessions stay host-only and your original selection remains opaque.</p>`)
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
    return PUBLIC_IDENTITY_PATHS.has(path)
      || /^\/api\/auth\/callback\/(?:google|github)$/.test(path)
      || /^\/api\/auth\/reset-password\/[^/]+$/.test(path)
  }

  function handles(request: Request): boolean {
    const path = new URL(request.url).pathname
    return (exactHost(request, input.appOrigin) && [APP_RESUME_PATH, APP_EXCHANGE_PATH, APP_CANCEL_PATH].includes(path))
      || (exactHost(request, input.authOrigin) && (path === AUTH_AUTHORIZE_PATH || path === AUTH_SIGN_IN_PATH || (input.googleAuthEnabled && path === AUTH_GOOGLE_PATH) || path === AUTH_TWO_FACTOR_PATH || path === AUTH_CANCEL_PATH || publicIdentityPath(path)))
  }

  async function handle(request: Request): Promise<Response | null> {
    if (!handles(request)) return null
    const url = new URL(request.url)
    try {
      if (exactHost(request, input.authOrigin) && publicIdentityPath(url.pathname)) return await input.identityAuth.handle(request)
      if (request.method === 'GET' && url.pathname === AUTH_GOOGLE_PATH && input.googleAuthEnabled) {
        const value = queryValue(url, AppHandoffStartQuerySchema) as AppHandoffStartQuery | null
        if (!value) return safeFailure(null)
        const callbackURL = fixedUrl(input.authOrigin, AUTH_AUTHORIZE_PATH, {
          intent: value.intent,
          correlation: value.correlation,
        })
        const authorization = await input.identityAuth.handle(new Request(new URL('/api/auth/sign-in/social', input.authOrigin), {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: input.authOrigin, host: auth.host },
          body: JSON.stringify({ provider: 'google', callbackURL }),
        }))
        let envelope: unknown = null
        try { envelope = await authorization?.clone().json() } catch { envelope = null }
        if (!authorization?.ok || !Value.Check(SocialAuthorizationSchema, envelope)) {
          return loginPage(value, 'sign-in', 'Google sign-in is temporarily unavailable. Continue with email.', true)
        }
        const providerUrl = new URL(envelope.url)
        if (providerUrl.protocol !== 'https:' || providerUrl.hostname !== 'accounts.google.com'
          || providerUrl.username || providerUrl.password || providerUrl.pathname !== '/o/oauth2/v2/auth') {
          return safeFailure(null)
        }
        const response = redirect(providerUrl.toString())
        for (const cookie of responseSetCookies(authorization.headers)) response.headers.append('set-cookie', cookie)
        return response
      }
      if (request.method === 'GET' && url.pathname === AUTH_AUTHORIZE_PATH) {
        const value = queryValue(url, AppHandoffStartQuerySchema) as AppHandoffStartQuery | null
        if (!value) return safeFailure(null)
        const session = await input.resolveIdentitySession(request.headers)
        if (!session) return loginPage(value, await input.service.loginMode(value), '', input.googleAuthEnabled ?? false)
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
        if (!authenticated?.ok) return loginPage({ intent: form.intent, correlation: form.correlation }, form.mode, 'Authentication was not accepted. Check your details and try again.', input.googleAuthEnabled ?? false)
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
