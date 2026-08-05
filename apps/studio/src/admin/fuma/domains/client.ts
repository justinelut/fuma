import { apiRequest, type FetchLike } from '@core/http'
import { Type, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1, maxLength: 255 })
const Timestamp = Type.String({ format: 'date-time' })
const State = Type.Union([Type.Literal('active'), Type.Literal('transferring')])
const Scope = {
  platformId: Id,
  organizationId: Id,
  workspaceId: Id,
  siteId: Id,
  ownerKey: Id,
  generation: Type.Integer({ minimum: 1 }),
  state: State,
  transferFence: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  profileId: Id,
}
const InstructionSchema = Type.Object({
  type: Type.Union([Type.Literal('CNAME'), Type.Literal('TXT')]),
  name: Type.String({ minLength: 1, maxLength: 253 }),
  value: Type.String({ minLength: 1, maxLength: 2048 }),
  purpose: Type.Union([Type.Literal('routing'), Type.Literal('ownership'), Type.Literal('tls-validation')]),
}, Strict)
const DiagnosticSchema = Type.Object({
  code: Type.Union([
    Type.Literal('cname-missing'), Type.Literal('ownership-missing'),
    Type.Literal('tls-validation-missing'), Type.Literal('provider-blocked'),
    Type.Literal('tls-pending'), Type.Literal('tls-failed'), Type.Literal('healthy'),
  ]),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  message: Type.String({ minLength: 1, maxLength: 500 }),
  expected: Type.Union([InstructionSchema, Type.Null()]),
}, Strict)
export const CloudflareBindingWireSchema = Type.Object({
  ...Scope,
  domainId: Id,
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  providerHostnameId: Id,
  lifecycle: Type.Union([
    Type.Literal('prevalidating'), Type.Literal('awaiting-dns'), Type.Literal('awaiting-tls'),
    Type.Literal('ready'), Type.Literal('active'), Type.Literal('rolling-back'),
    Type.Literal('detached'), Type.Literal('deleting'), Type.Literal('deleted'), Type.Literal('failed'),
  ]),
  providerStatus: Type.Union([Type.Literal('pending'), Type.Literal('active'), Type.Literal('blocked'), Type.Literal('deleted')]),
  sslStatus: Type.Union([Type.Literal('pending'), Type.Literal('active'), Type.Literal('failed')]),
  ownershipVerified: Type.Boolean(),
  instructions: Type.Array(InstructionSchema, { maxItems: 20 }),
  diagnostics: Type.Array(DiagnosticSchema, { maxItems: 50 }),
  version: Type.Integer({ minimum: 1 }),
  reconcileFence: Type.Integer({ minimum: 1 }),
  lastEventSequence: Type.String({ pattern: '^[0-9]+$' }),
  lastOperationId: Id,
  lastOperationSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, Strict)
export type CloudflareBindingWire = Readonly<Static<typeof CloudflareBindingWireSchema>>

const DomainProjectionSchema = Type.Object({
  domainId: Id,
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  unicodeHostname: Type.String({ minLength: 1, maxLength: 253 }),
  kind: Type.Union([Type.Literal('customer-dns'), Type.Literal('fuma-registered')]),
  desired: Type.Union([Type.Literal('detached'), Type.Literal('validating'), Type.Literal('active'), Type.Literal('suspended'), Type.Literal('deleted')]),
  observed: Type.Union([Type.Literal('unknown'), Type.Literal('dns-pending'), Type.Literal('dns-valid'), Type.Literal('tls-pending'), Type.Literal('active'), Type.Literal('degraded'), Type.Literal('detached'), Type.Literal('deleted')]),
  certificate: Type.Union([Type.Literal('none'), Type.Literal('provisioning'), Type.Literal('active'), Type.Literal('expiring'), Type.Literal('expired'), Type.Literal('failed'), Type.Literal('revoked')]),
  version: Type.Integer({ minimum: 1 }),
  updatedAt: Timestamp,
  credential: Type.Union([Type.Object({ configured: Type.Literal(true), scope: Type.Union([Type.Literal('fuma-platform'), Type.Literal('customer-automation')]) }, Strict), Type.Null()]),
}, Strict)
const CatalogItemSchema = Type.Object({
  domain: DomainProjectionSchema,
  binding: Type.Union([CloudflareBindingWireSchema, Type.Null()]),
}, Strict)
const CatalogSchema = Type.Object({ domains: Type.Array(CatalogItemSchema, { maxItems: 100 }) }, Strict)
export type CloudflareDomainCatalogWire = Readonly<Static<typeof CatalogSchema>>

const PrevalidationSchema = Type.Object({
  binding: CloudflareBindingWireSchema,
  records: Type.Array(InstructionSchema, { maxItems: 20 }),
  customerAccountRequired: Type.Literal(false),
  customerTokenRequired: Type.Literal(false),
  authoritativeDnsRetainedByCustomer: Type.Literal(true),
}, Strict)
export type CloudflarePrevalidationWire = Readonly<Static<typeof PrevalidationSchema>>

export type ApexCapabilityWire = Readonly<{
  alias: boolean
  aname: boolean
  cnameFlattening: boolean
  registrarRedirect: boolean
  enterpriseApex: boolean
  actualQuoteApproved: boolean
  securityReviewApproved: boolean
  marginGatePassed: boolean
}>

function base(input: Readonly<{ organizationId: string; workspaceId: string; siteId: string }>): string {
  return `/api/fuma/organizations/${encodeURIComponent(input.organizationId)}`
    + `/workspaces/${encodeURIComponent(input.workspaceId)}`
    + `/sites/${encodeURIComponent(input.siteId)}/settings/domains`
}

export class CloudflareDomainsHttpClient {
  readonly #base: string
  readonly #fetch: FetchLike
  constructor(input: Readonly<{ organizationId: string; workspaceId: string; siteId: string; fetch?: FetchLike }>) {
    this.#base = base(input)
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis)
  }
  list(): Promise<CloudflareDomainCatalogWire> { return this.#request('GET', '/cloudflare', CatalogSchema) }
  create(input: Readonly<{ domainId: string; hostname: string; capability: ApexCapabilityWire }>): Promise<CloudflarePrevalidationWire> { return this.#request('POST', '/cloudflare', PrevalidationSchema, input) }
  exact(domainId: string): Promise<CloudflareBindingWire> { return this.#request('GET', `/${encodeURIComponent(domainId)}/cloudflare`, CloudflareBindingWireSchema) }
  reconcile(domainId: string): Promise<CloudflareBindingWire> { return this.#request('POST', `/${encodeURIComponent(domainId)}/cloudflare/reconcile`, CloudflareBindingWireSchema, {}) }
  cutover(domainId: string): Promise<CloudflareBindingWire> { return this.#request('POST', `/${encodeURIComponent(domainId)}/cloudflare/cutover`, CloudflareBindingWireSchema, {}) }
  rollback(domainId: string): Promise<CloudflareBindingWire> { return this.#request('POST', `/${encodeURIComponent(domainId)}/cloudflare/rollback`, CloudflareBindingWireSchema, {}) }
  remove(domainId: string): Promise<CloudflareBindingWire> { return this.#request('DELETE', `/${encodeURIComponent(domainId)}/cloudflare`, CloudflareBindingWireSchema) }
  #request<T extends TSchema>(method: string, suffix: string, schema: T, body?: unknown): Promise<Static<T>> {
    return apiRequest(`${this.#base}${suffix}`, {
      method,
      ...(body === undefined ? {} : { body }),
      schema,
      credentials: 'same-origin',
      fallbackMessage: 'Domain request could not be completed.',
      fetchImpl: this.#fetch,
    })
  }
}
