import { NextResponse, type NextRequest } from 'next/server'
import { effectivePublicHost, isKnownPublicHost, normalizedPublicHost } from '@/lib/public-host'

const INTERNAL_HOST = 'web-internal.service'

export function proxy(request: NextRequest) {
  const host = effectivePublicHost(request.headers)
  const path = request.nextUrl.pathname

  if (host === 'www.fuma.co.ke') {
    const target = request.nextUrl.clone()
    target.hostname = 'fuma.co.ke'
    target.protocol = 'https:'
    target.port = ''
    return NextResponse.redirect(target, 308)
  }
  if (host === INTERNAL_HOST) {
    if (path === '/api/health' || path === '/api/internal/metrics') return NextResponse.next()
    return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } })
  }

  const preview = normalizedPublicHost(process.env.FUMA_PUBLIC_PREVIEW_HOST ?? '')
  if (preview && host === preview) {
    const response = NextResponse.next()
    response.headers.set('x-robots-tag', 'noindex, nofollow')
    return response
  }
  if (!isKnownPublicHost(host)) {
    return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } })
  }
  return NextResponse.next()
}

export const config = { matcher: '/:path*' }
