import { parseContract, SiteApplicationMutationCommandSchema, SiteRuntimeClientError, type SiteApplicationMutationCommand } from '../../../../../lib/contracts'
import { privateRuntimeClientFromEnv } from '../../../../../lib/private-runtime-client'
import { authorizeRoutedHost, siteMemberSessionToken } from '../../../../../lib/request-authority'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MAX_BODY_BYTES = 128 * 1024

function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'private, no-store', 'content-type': 'application/json; charset=utf-8', vary: 'Cookie' } })
}

export async function POST(request: Request): Promise<Response> {
  try {
    const routingToken = process.env.FUMA_SITE_RUNTIME_ROUTING_TOKEN ?? ''
    const host = authorizeRoutedHost(request.headers, routingToken)
    if (request.headers.get('origin') !== `https://${host}` || request.headers.has('authorization')) return json({ error: 'not_found' }, 404)
    const declared = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: 'invalid_request' }, 400)
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ error: 'invalid_request' }, 400)
    const command = parseContract(SiteApplicationMutationCommandSchema, JSON.parse(text) as unknown, 'browser mutation command') as SiteApplicationMutationCommand
    if (command.context.cacheIdentity.host !== host || command.context.cachePolicy !== 'private' || !command.context.member.authenticated) return json({ error: 'not_found' }, 404)
    const result = await privateRuntimeClientFromEnv().mutate({ host, memberSessionToken: siteMemberSessionToken(request.headers.get('cookie')), command })
    return json(result, 200)
  } catch (error) {
    if (error instanceof SiteRuntimeClientError && error.code === 'runtime-conflict') return json({ error: 'mutation_conflict' }, 409)
    if (error instanceof SyntaxError || (error instanceof SiteRuntimeClientError && error.code === 'invalid-response')) return json({ error: 'invalid_request' }, 400)
    return json({ error: 'temporarily_unavailable' }, 503)
  }
}
