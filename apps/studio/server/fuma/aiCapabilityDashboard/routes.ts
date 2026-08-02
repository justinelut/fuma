import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput, FumaSiteAuthorizationAuthority } from '../context'
import {
  PlatformCapabilityDashboardSchema,
  RevokeCapabilityGrantResultSchema,
  SiteCapabilityDashboardSchema,
  CapabilityDashboardError,
} from './contracts'
import type { CapabilityDashboardService } from './service'

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })
function response(schema: TSchema, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Capability dashboard response failed strict TypeBox validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } })
}
function failure(error: unknown): Response {
  const status = error instanceof CapabilityDashboardError
    ? error.code === 'invalid-contract' ? 400 : error.code === 'not-found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'unavailable' ? 503 : 403
    : 500
  return response(ErrorSchema, { error: error instanceof CapabilityDashboardError ? error.message : 'Capability dashboard request failed.' }, status)
}
function query(input: FumaScopedRouteHandlerInput): unknown {
  const params = new URL(input.request.url).searchParams
  return { limit: Number(params.get('limit') ?? '20'), ...(params.get('cursor') ? { cursor: params.get('cursor') } : {}) }
}
async function body(input: FumaScopedRouteHandlerInput): Promise<unknown> { return await input.request.json().catch(() => null) }

export function createCapabilityDashboardScopedRoutes(service: CapabilityDashboardService, platformAuthorization: FumaSiteAuthorizationAuthority): readonly FumaScopedRouteDeclaration[] {
  const route = (method: FumaScopedRouteDeclaration['method'], path: string, permission: string, schema: TSchema, handler: (input: FumaScopedRouteHandlerInput) => Promise<unknown>, authorization?: FumaSiteAuthorizationAuthority): FumaScopedRouteDeclaration => Object.freeze({
    method, path, permission, ...(authorization ? { authorization } : {}),
    handler: async (input: FumaScopedRouteHandlerInput) => { try { return response(Type.Object({ result: schema }, { additionalProperties: false }), { result: await handler(input) }) } catch (error) { return failure(error) } },
  }) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('GET', '/ai/backend-capabilities', 'site.read', SiteCapabilityDashboardSchema, async (input) => await service.site(input, query(input))),
    route('POST', '/ai/backend-capabilities/revocations', 'ai.providers.manage', RevokeCapabilityGrantResultSchema, async (input) => await service.revoke(input, await body(input))),
    route('GET', '/internal/ai-capabilities', 'site.read', PlatformCapabilityDashboardSchema, async (input) => await service.platform(input, query(input)), platformAuthorization),
  ])
}
