import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import {
  ExpertDiscoveryError,
  ExpertInquiryReceiptSchema,
  ExpertManagementProjectionSchema,
  ExpertPluginLinkSchema,
  ExpertProfileRecordSchema,
  ExpertSearchResultSchema,
} from './contracts'
import type { ExpertDiscoveryService, TrustedExpertRequest } from './service'

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })
function response(schema: TSchema, value: unknown, status = 200): Response { const parsed = safeParseValue(schema, value); if (!parsed.ok) throw new Error('Expert discovery response failed strict validation.'); return new Response(JSON.stringify(parsed.value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } }) }
function failure(error: unknown): Response {
  const status = error instanceof ExpertDiscoveryError ? error.code === 'not-found' || error.code === 'hidden' ? 404 : error.code === 'conflict' ? 409 : error.code === 'storage-denied' ? 503 : error.code === 'invalid-contract' ? 400 : 403 : 500
  return response(ErrorSchema, { error: error instanceof ExpertDiscoveryError ? error.message : 'Expert operation failed.' }, status)
}
function trusted(input: FumaScopedRouteHandlerInput): TrustedExpertRequest { return Object.freeze({ context: input.context, scope: input.repositoryScope, requestHeaders: new Headers(input.request.headers) }) }
async function body(input: FumaScopedRouteHandlerInput): Promise<unknown> { return await input.request.json().catch(() => null) }
function route(method: FumaScopedRouteDeclaration['method'], path: string, schema: TSchema, handler: (input: FumaScopedRouteHandlerInput) => Promise<unknown>, status = 200, authorization?: import('../context').FumaSiteAuthorizationAuthority): FumaScopedRouteDeclaration {
  return Object.freeze({ method, path, permission: 'site.read', ...(authorization ? { authorization } : {}), handler: async (input) => { try { return response(Type.Object({ result: schema }, { additionalProperties: false }), { result: await handler(input) }, status) } catch (error) { return failure(error) } } }) as FumaScopedRouteDeclaration
}
export function createExpertDiscoveryScopedRoutes(service: ExpertDiscoveryService, approvalAuthorization?: import('../context').FumaSiteAuthorizationAuthority): readonly FumaScopedRouteDeclaration[] {
  return Object.freeze([
    route('POST', '/experts/releases/approve', ExpertProfileRecordSchema, async (input) => await service.approveRelease(trusted(input), await body(input)), 201, approvalAuthorization),
    route('POST', '/experts/visibility', ExpertProfileRecordSchema, async (input) => await service.setVisibility(trusted(input), await body(input))),
    route('POST', '/experts/inquiries', ExpertInquiryReceiptSchema, async (input) => await service.submitInquiry(trusted(input), await body(input)), 202),
    route('POST', '/experts/plugins', ExpertPluginLinkSchema, async (input) => await service.linkPlugin(trusted(input), await body(input)), 201),
    route('POST', '/experts/transfers', ExpertProfileRecordSchema, async (input) => await service.transfer(trusted(input), await body(input))),
    route('GET', '/experts/:expertId/management', ExpertManagementProjectionSchema, async (input) => await service.management(trusted(input), input.params.expertId)),
    route('GET', '/experts', ExpertSearchResultSchema, async (input) => { const query = new URL(input.request.url).searchParams; return await service.search({ profile: query.get('profile') ?? undefined, expertType: query.get('expertType') ?? undefined, skill: query.get('skill') ?? undefined, location: query.get('location') ?? undefined, limit: Number(query.get('limit') ?? '24') }) }),
  ])
}
