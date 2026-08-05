import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import {
  domainScopeFromRepository,
  DomainPublicProjectionSchema,
  type DomainPublicProjection,
  type DomainRecord,
  type DomainScope,
} from '../domains/contracts'
import { DomainError } from '../domains/service'
import { CloudflareTransportError } from './adapter'
import {
  ApexCapabilitySchema, CloudflareBindingSchema, CloudflareObservedDnsSchema, CloudflarePrevalidationSchema,
  type ApexCapability,
} from './contracts'
import { CloudflareReconcileError, type CloudflareSaasReconciler } from './reconciler'

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }), alternatives: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 10 }) }, { additionalProperties: false })
const EmptySchema = Type.Object({}, { additionalProperties: false })
const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const CreateCloudflareDomainSchema = Type.Object({
  domainId: IdSchema,
  hostname: Type.String({ minLength: 1, maxLength: 1024 }),
  capability: ApexCapabilitySchema,
}, { additionalProperties: false })
const CloudflareDomainCatalogItemSchema = Type.Object({
  domain: DomainPublicProjectionSchema,
  binding: Type.Union([CloudflareBindingSchema, Type.Null()]),
}, { additionalProperties: false })
const CloudflareDomainCatalogSchema = Type.Object({
  domains: Type.Array(CloudflareDomainCatalogItemSchema, { maxItems: 100 }),
}, { additionalProperties: false })
export interface CloudflareDomainAuthority { exact(scope: DomainScope, domainId: string): Promise<DomainRecord | null> }
export interface CloudflareDomainCatalog {
  list(scope: DomainScope): Promise<readonly DomainPublicProjection[]>
  create(scope: DomainScope, command: unknown): Promise<DomainPublicProjection>
}

function json<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Cloudflare route response failed strict validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } })
}
function failure(error: unknown): Response {
  if (error instanceof DomainError) {
    if (error.code === 'scope' || error.code === 'secret' || error.code === 'revoked') {
      return json(ErrorSchema, { error: 'Domain authority is unavailable.', alternatives: [] }, 403)
    }
    if (error.code === 'collision' || error.code === 'stale' || error.code === 'transition') {
      return json(ErrorSchema, { error: error.message, alternatives: [] }, 409)
    }
    return json(ErrorSchema, { error: 'Domain request is invalid.', alternatives: [] }, 400)
  }
  if (error instanceof CloudflareTransportError && error.code === 'provider') return json(ErrorSchema, { error: 'Cloudflare is temporarily unavailable.', alternatives: [] }, 502)
  if (!(error instanceof CloudflareReconcileError)) return json(ErrorSchema, { error: 'Internal server error.', alternatives: [] }, 500)
  if (error.code === 'unsupported-apex') return json(ErrorSchema, { error: error.message, alternatives: [...error.alternatives] }, 422)
  if (error.code === 'tls-pending' || error.code === 'state' || error.code === 'stale') return json(ErrorSchema, { error: error.message, alternatives: [] }, 409)
  if (error.code === 'provider') return json(ErrorSchema, { error: 'Cloudflare is temporarily unavailable.', alternatives: [] }, 502)
  return json(ErrorSchema, { error: 'Resource not found.', alternatives: [] }, 404)
}
function scope(input: FumaScopedRouteHandlerInput): DomainScope {
  return domainScopeFromRepository(input.repositoryScope, input.context.profile.id)
}
async function domain(input: FumaScopedRouteHandlerInput, authority: CloudflareDomainAuthority): Promise<Readonly<{ scope: DomainScope; domain: DomainRecord }>> {
  const exactScope = scope(input)
  const value = await authority.exact(exactScope, input.params.domainId ?? '')
  if (!value) throw new CloudflareReconcileError('scope', 'Domain is unavailable.')
  return Object.freeze({ scope: exactScope, domain: value })
}
async function body<T extends TSchema>(input: FumaScopedRouteHandlerInput, schema: T) {
  const value = await readValidatedBody(input.request, schema)
  if (value === null) throw new CloudflareReconcileError('state', 'Request contract is invalid.')
  return value
}

/** Ticket-local declarations. The conductor decides whether and where to mount them. */
export function createCloudflareRouteDeclarations(input: Readonly<{
  reconciler: CloudflareSaasReconciler
  domains: CloudflareDomainAuthority
  catalog?: CloudflareDomainCatalog
  onboard?: (scope: DomainScope, domainId: string, prevalidation: unknown, capability: ApexCapability) => Promise<void>
  now?: () => Date
}>): readonly FumaScopedRouteDeclaration[] {
  const catalogRoutes: readonly FumaScopedRouteDeclaration[] = input.catalog ? [
    Object.freeze({ method: 'GET' as const, path: '/settings/domains/cloudflare' as const, permission: 'site.settings.read' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try {
        const exactScope = scope(request)
        const domains = await input.catalog!.list(exactScope)
        const values = await Promise.all(domains.map(async (value) => Object.freeze({
          domain: value,
          binding: await input.reconciler.exact(exactScope, value.domainId),
        })))
        return json(CloudflareDomainCatalogSchema, { domains: values })
      } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/cloudflare' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try {
        if (request.context.actor.kind !== 'staff' || request.context.actor.impersonator !== null) {
          throw new CloudflareReconcileError('scope', 'Direct staff authority is required.')
        }
        const exactScope = scope(request)
        const command = await body(request, CreateCloudflareDomainSchema)
        input.reconciler.assertApex(command.hostname.toLowerCase(), command.capability as ApexCapability)
        const at = (input.now ?? (() => new Date()))()
        if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new CloudflareReconcileError('state', 'Domain clock is invalid.')
        await input.catalog!.create(exactScope, {
          domainId: command.domainId,
          hostname: command.hostname,
          kind: 'customer-dns',
          credentialId: null,
          requestedAt: at.toISOString(),
        })
        const authority = await domain({ ...request, params: { ...request.params, domainId: command.domainId } }, input.domains)
        const prevalidation = await input.reconciler.prevalidate(authority.scope, authority.domain, command.capability as ApexCapability)
        await input.onboard?.(authority.scope, command.domainId, prevalidation, command.capability as ApexCapability)
        return json(CloudflarePrevalidationSchema, prevalidation, 201)
      } catch (error) { return failure(error) }
    } }),
  ] : []
  return Object.freeze([
    ...catalogRoutes,
    Object.freeze({ method: 'GET' as const, path: '/settings/domains/:domainId/cloudflare' as const, permission: 'site.settings.read' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try {
        const exactScope = scope(request)
        const value = await input.reconciler.exact(exactScope, request.params.domainId ?? '')
        if (!value) throw new CloudflareReconcileError('scope', 'Domain is unavailable.')
        return json(CloudflareBindingSchema, value)
      } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/prevalidate' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try {
        const authority = await domain(request, input.domains)
        const capability = await body(request, ApexCapabilitySchema) as ApexCapability
        return json(CloudflarePrevalidationSchema, await input.reconciler.prevalidate(authority.scope, authority.domain, capability), 201)
      } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/reconcile' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { await body(request, EmptySchema); const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.reconcile(authority.scope, authority.domain)) } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/cutover' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { await body(request, EmptySchema); const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.cutover(authority.scope, authority.domain)) } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/rollback' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { await body(request, EmptySchema); const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.rollback(authority.scope, authority.domain)) } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'POST' as const, path: '/settings/domains/:domainId/cloudflare/diagnose' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { const observed = await body(request, CloudflareObservedDnsSchema); const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.diagnose(authority.scope, authority.domain, observed)) } catch (error) { return failure(error) }
    } }),
    Object.freeze({ method: 'DELETE' as const, path: '/settings/domains/:domainId/cloudflare' as const, permission: 'site.settings.write' as const, handler: async (request: FumaScopedRouteHandlerInput) => {
      try { const authority = await domain(request, input.domains); return json(CloudflareBindingSchema, await input.reconciler.remove(authority.scope, authority.domain)) } catch (error) { return failure(error) }
    } }),
  ])
}
