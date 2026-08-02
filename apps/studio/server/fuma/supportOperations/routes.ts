import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput, FumaSiteAuthorizationAuthority } from '../context'
import { SupportJsonValueSchema, SupportOperationsError } from './contracts'
import type { SupportOperationsService, TrustedSupportRequest } from './service'

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 1_000 }) }, { additionalProperties: false })
const ResultSchema = Type.Object({ result: SupportJsonValueSchema }, { additionalProperties: false })
type RouteResult = Readonly<{ value: unknown; setCookies: readonly string[] }>

function response(schema: TSchema, value: unknown, status = 200, setCookies: readonly string[] = []): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Support operations response failed strict validation.')
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  for (const cookie of setCookies) headers.append('set-cookie', cookie)
  if (setCookies.length > 0) headers.set('x-fuma-auth-cookie-mutations', String(setCookies.length))
  return new Response(JSON.stringify(parsed.value), { status, headers })
}
function failure(error: unknown): Response {
  const status = error instanceof SupportOperationsError
    ? ['authority-denied','scope-denied','protected-owner-denied','nested-impersonation-denied','step-up-required','evidence-denied'].includes(error.code) ? 403
      : error.code === 'expired' ? 410 : ['conflict','invalid-transition'].includes(error.code) ? 409 : 400
    : 500
  return response(ErrorSchema, { error: error instanceof SupportOperationsError ? error.message : 'Support operation failed.' }, status)
}
function trusted(input: FumaScopedRouteHandlerInput): TrustedSupportRequest {
  return Object.freeze({ context: input.context, scope: input.repositoryScope, requestHeaders: new Headers(input.request.headers) })
}
async function body(input: FumaScopedRouteHandlerInput): Promise<unknown> { return await input.request.json().catch(() => null) }
function plain(value: unknown): RouteResult { return Object.freeze({ value, setCookies: [] }) }

export function createSupportOperationsScopedRoutes(service: SupportOperationsService, authorization?: FumaSiteAuthorizationAuthority): readonly FumaScopedRouteDeclaration[] {
  const route = (method: FumaScopedRouteDeclaration['method'], path: string, handler: (input: FumaScopedRouteHandlerInput) => Promise<RouteResult>, status = 200): FumaScopedRouteDeclaration => Object.freeze({
    method, path, permission: 'site.read',
    ...(authorization ? { authorization } : {}),
    handler: async (input: FumaScopedRouteHandlerInput) => {
      try {
        const result = await handler(input)
        return response(ResultSchema, { result: result.value }, status, result.setCookies)
      } catch (error) { return failure(error) }
    },
  }) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('POST', '/support/sessions', async (input) => await service.beginSupport(trusted(input), await body(input)), 201),
    route('GET', '/support/sessions/current', async (input) => plain(await service.currentSupportSession(trusted(input)))),
    route('POST', '/support/sessions/end', async (input) => await service.endSupport(trusted(input), await body(input))),
    route('POST', '/support/actions', async (input) => plain(await service.authorizeSupportAction(trusted(input), await body(input)))),
    route('POST', '/support/moderation', async (input) => plain(await service.recordModeration(trusted(input), await body(input))), 201),
    route('GET', '/support/moderation/queues/:queue', async (input) => {
      const url = new URL(input.request.url)
      return plain(await service.listModerationQueue(trusted(input), { queue: input.params.queue, afterEvidenceId: url.searchParams.get('afterEvidenceId'), limit: Number(url.searchParams.get('limit') ?? '50') }))
    }),
    route('POST', '/support/break-glass/requests', async (input) => plain(await service.createBreakGlass(trusted(input), await body(input))), 201),
    route('POST', '/support/break-glass/approvals', async (input) => plain(await service.approveBreakGlass(trusted(input), await body(input))), 201),
    route('POST', '/support/break-glass/executions', async (input) => plain(await service.executeBreakGlass(trusted(input), await body(input))), 201),
  ])
}
