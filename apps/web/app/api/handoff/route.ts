import { PublicHandoffRequestSchema } from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import { issueHandoff } from '@/lib/private-bridge'
import { isSameOriginPublicRequest, NO_STORE_HEADERS, readBoundedJson } from '@/lib/public-request'

const INVALID_REQUEST = Object.freeze({
  error: { code: 'invalid_request', message: 'Invalid handoff request.' },
})
const UNAVAILABLE = Object.freeze({
  error: { code: 'temporarily_unavailable', message: 'Fuma is temporarily unavailable.' },
})

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPublicRequest(request)) {
    return new Response(null, { status: 404, headers: NO_STORE_HEADERS })
  }

  const parsed = await readBoundedJson(request, 4_096)
  if (!parsed.ok) {
    return Response.json(INVALID_REQUEST, { status: parsed.status, headers: NO_STORE_HEADERS })
  }
  if (!Value.Check(PublicHandoffRequestSchema, parsed.value)) {
    return Response.json(INVALID_REQUEST, { status: 400, headers: NO_STORE_HEADERS })
  }

  const result = await issueHandoff(parsed.value)
  if (!result) {
    return Response.json(UNAVAILABLE, {
      status: 503,
      headers: { ...NO_STORE_HEADERS, 'retry-after': '30' },
    })
  }
  return Response.json(result, { status: 201, headers: NO_STORE_HEADERS })
}
