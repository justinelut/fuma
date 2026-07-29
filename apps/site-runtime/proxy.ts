import { NextResponse, type NextRequest } from 'next/server'

function nonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64')
}

function contentSecurityPolicy(value: string): string {
  return [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${value}' 'strict-dynamic'`,
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

export function proxy(request: NextRequest) {
  const requestNonce = nonce()
  const policy = contentSecurityPolicy(requestNonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('content-security-policy', policy)
  requestHeaders.set('x-nonce', requestNonce)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy', policy)
  const carriesMemberCookie = (request.headers.get('cookie') ?? '').split(';').some((item) => item.trimStart().startsWith('__Host-fuma_member_session='))
  if (carriesMemberCookie || request.nextUrl.pathname.startsWith('/__fuma/runtime/')) {
    response.headers.set('cache-control', 'private, no-store')
    response.headers.set('vary', 'Cookie')
  } else {
    response.headers.set('cache-control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=90')
  }
  return response
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }],
}
