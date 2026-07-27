import { Value } from '@sinclair/typebox/value'
import { recordWebVital } from '@/lib/metrics'
import { PublicWebVitalSchema, type PublicWebVital } from '@/lib/public-web-contracts'
import { isSameOriginPublicRequest, NO_STORE_HEADERS, readBoundedJson } from '@/lib/public-request'

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPublicRequest(request)) {
    return new Response(null, { status: 404, headers: NO_STORE_HEADERS })
  }

  const parsed = await readBoundedJson(request, 1_024)
  if (!parsed.ok || !Value.Check(PublicWebVitalSchema, parsed.value)) {
    return new Response(null, { status: parsed.ok ? 400 : parsed.status, headers: NO_STORE_HEADERS })
  }

  const vital = parsed.value as PublicWebVital
  recordWebVital(vital)
  console.info(JSON.stringify({ level: 'info', event: 'public_web_vital', ...vital }))
  return new Response(null, { status: 202, headers: NO_STORE_HEADERS })
}
