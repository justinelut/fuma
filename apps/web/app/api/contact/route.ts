import { Value } from '@sinclair/typebox/value'
import { ContactRequestSchema } from '@/lib/public-web-contracts'
import { forwardContact } from '@/lib/private-bridge'
import { isSameOriginPublicRequest, NO_STORE_HEADERS, readBoundedJson } from '@/lib/public-request'

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPublicRequest(request)) {
    return Response.json({ error: 'not_found' }, { status: 404, headers: NO_STORE_HEADERS })
  }

  const parsed = await readBoundedJson(request, 8_192)
  if (!parsed.ok) {
    return Response.json({ error: 'invalid_request' }, { status: parsed.status, headers: NO_STORE_HEADERS })
  }
  if (!Value.Check(ContactRequestSchema, parsed.value)) {
    return Response.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const accepted = await forwardContact(parsed.value)
  return accepted
    ? new Response(null, { status: 202, headers: NO_STORE_HEADERS })
    : Response.json({ error: 'temporarily_unavailable' }, {
        status: 503,
        headers: { ...NO_STORE_HEADERS, 'retry-after': '30' },
      })
}
