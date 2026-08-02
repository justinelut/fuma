import { PublicAcquisitionEventSchema } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import { collectAcquisition } from '@/lib/private-bridge'
import { isSameOriginPublicRequest, NO_STORE_HEADERS, readBoundedJson } from '@/lib/public-request'

const BOT_USER_AGENT = /bot|crawler|spider|headless|preview/i

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPublicRequest(request)) {
    return new Response(null, { status: 404, headers: NO_STORE_HEADERS })
  }
  const globalPrivacyControl = request.headers.get('sec-gpc') === '1'
  const doNotTrack = request.headers.get('dnt') === '1'
  const filteredTraffic = BOT_USER_AGENT.test(request.headers.get('user-agent') ?? '') || request.headers.has('x-fuma-staff')
  if (globalPrivacyControl || doNotTrack || filteredTraffic) {
    return new Response(null, { status: 202, headers: NO_STORE_HEADERS })
  }

  const parsed = await readBoundedJson(request, 4_096)
  if (!parsed.ok) {
    return Response.json({ error: 'invalid_request' }, { status: parsed.status, headers: NO_STORE_HEADERS })
  }
  if (!Value.Check(PublicAcquisitionEventSchema, parsed.value)) {
    return Response.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  await collectAcquisition(parsed.value, {
    globalPrivacyControl: false,
    doNotTrack: false,
    traffic: 'human',
  })
  return new Response(null, { status: 202, headers: NO_STORE_HEADERS })
}
