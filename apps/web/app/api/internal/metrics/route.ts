import { publicWebMetrics } from '@/lib/metrics'
import { constantTimeEqual, NO_STORE_HEADERS } from '@/lib/public-request'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const token = process.env.FUMA_WEB_METRICS_TOKEN
  const url = new URL(request.url)
  const authorization = request.headers.get('authorization') ?? ''
  const expected = token ? `Bearer ${token}` : ''
  if (
    url.hostname !== 'web-internal.service'
    || !token
    || token.length < 32
    || !constantTimeEqual(authorization, expected)
  ) {
    return new Response(null, { status: 404, headers: NO_STORE_HEADERS })
  }

  return new Response(publicWebMetrics(process.env.FUMA_WEB_REVISION ?? 'unknown'), {
    headers: {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      ...NO_STORE_HEADERS,
    },
  })
}
