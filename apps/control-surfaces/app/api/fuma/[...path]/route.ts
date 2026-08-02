import { NextResponse } from 'next/server'
import { FUMA_CONTROL_DEPLOYMENT } from '@/lib/deployment-profile'

const Segment = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const RuntimeOrigin = 'http://runtime-web.fuma.svc.cluster.local'
const HandoffCookiePrefix = '__Host-fuma_ai_payment_setup='

type RouteKind = 'marketplace' | 'payment-proposal' | 'payment-challenge' | 'payment-confirm' | 'payment-credentials'

function controlHost(request: Request): string | null {
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase() ?? null
  if (host === FUMA_CONTROL_DEPLOYMENT.hosts.product) return host
  if (process.env.NODE_ENV !== 'production' && host === '5174.blyss.co.ke') return host
  return null
}
function expectedBrowserOrigin(host: string): string {
  return host === FUMA_CONTROL_DEPLOYMENT.hosts.product ? FUMA_CONTROL_DEPLOYMENT.origins.product : `https://${host}`
}
function routeKind(path: readonly string[], method: string): RouteKind | null {
  if (path.length < 7 || path.some((segment) => !Segment.test(segment))
    || path[0] !== 'organizations' || path[2] !== 'workspaces' || path[4] !== 'sites') return null
  if (path[6] === 'marketplace') {
    if (method === 'GET' && path.length === 8 && path[7] === 'artifacts') return 'marketplace'
    if (method === 'POST' && path.length === 10 && path[7] === 'artifacts' && path[9] === 'install') return 'marketplace'
    return null
  }
  if (path[6] !== 'ai' || path[7] !== 'payment-setup' || path[8] !== 'proposals' || path.length < 10) return null
  if (path.length === 10 && method === 'GET') return 'payment-proposal'
  if (path.length !== 11 || method !== 'POST') return null
  if (path[10] === 'challenge') return 'payment-challenge'
  if (path[10] === 'confirm') return 'payment-confirm'
  if (path[10] === 'credentials') return 'payment-credentials'
  return null
}
function safeConfirmationCookie(value: string | null): string | null {
  if (!value || /[\r\n]/.test(value) || !value.startsWith(HandoffCookiePrefix)
    || !value.includes('HttpOnly') || !value.includes('Secure') || !value.includes('SameSite=Strict')
    || !value.includes('Path=/api/fuma/')) return null
  return value
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const host = controlHost(request)
  if (!host) return NextResponse.json({ error: 'request-denied' }, { status: 403 })
  if (request.method === 'POST' && request.headers.get('origin') !== expectedBrowserOrigin(host)) {
    return NextResponse.json({ error: 'request-denied' }, { status: 403 })
  }
  const runtime = process.env.FUMA_PRIVATE_RUNTIME_ORIGIN
  if (runtime !== RuntimeOrigin) return NextResponse.json({ error: 'fuma-runtime-unavailable' }, { status: 503 })
  const path = (await context.params).path
  const kind = routeKind(path, request.method)
  if (!kind) return NextResponse.json({ error: 'route-denied' }, { status: 404 })

  const headers = new Headers({ accept: 'application/json', host: FUMA_CONTROL_DEPLOYMENT.hosts.product })
  const cookie = request.headers.get('cookie')
  if (cookie) headers.set('cookie', cookie)
  if (request.method === 'POST') {
    headers.set('content-type', 'application/json')
    // The browser origin was checked above; the private runtime accepts only its exact product origin.
    headers.set('origin', FUMA_CONTROL_DEPLOYMENT.origins.product)
  }
  const response = await fetch(`${runtime}/api/fuma/${path.map(encodeURIComponent).join('/')}`, {
    method: request.method,
    headers,
    body: request.method === 'POST' ? await request.text() : undefined,
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null)
  if (!response) return NextResponse.json({ error: 'fuma-runtime-unavailable' }, { status: 503 })
  const outputHeaders = new Headers({
    'cache-control': 'no-store',
    'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
  })
  if (kind === 'payment-confirm' && response.ok) {
    const handoff = safeConfirmationCookie(response.headers.get('set-cookie'))
    if (!handoff) return NextResponse.json({ error: 'secure-handoff-unavailable' }, { status: 502 })
    outputHeaders.set('set-cookie', handoff)
  }
  return new Response(await response.text(), { status: response.status, headers: outputHeaders })
}

export const GET = proxy
export const POST = proxy
