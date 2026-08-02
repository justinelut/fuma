import { FUMA_WEB_DEPLOYMENT } from '@/lib/deployment-profile'
import { effectivePublicHost } from '@/lib/public-host'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const host = effectivePublicHost(request.headers, url.hostname)
  if (![FUMA_WEB_DEPLOYMENT.hosts.public, '3002.blyss.co.ke', 'web-internal.service'].includes(host)) {
    return new Response(null, { status: 404 })
  }
  return Response.json({
    status: 'ok',
    service: 'public-web',
    revision: process.env.FUMA_WEB_REVISION ?? 'unknown',
  }, { headers: { 'cache-control': 'no-store' } })
}
