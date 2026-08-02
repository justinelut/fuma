import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import {
  AttachCustomerMerchantCredentialRequestSchema,
  CustomerMerchantCredentialViewSchema,
  MembershipInitializationSchema,
  MembershipPurchaseRequestSchema,
  PaidMembershipSchema,
  ReconcileRequestSchema,
  type CustomerMerchantCredential,
  type PublicationMerchantScope,
  type PublicationPayerAuthority,
} from './contracts'
import { CustomerMerchantPaymentService, CustomerPaymentError } from './service'

const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })
const CUSTOMER_MEMBER_PAYMENT_PREFIX = '/__fuma/publication/payments/'

function json<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Customer payment route response failed strict validation.')
  return new Response(JSON.stringify(parsed.value), {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
  })
}

function failure(error: unknown): Response {
  if (error instanceof TypeError) return json(ErrorSchema, { error: 'Request contract is invalid.' }, 400)
  if (!(error instanceof CustomerPaymentError)) return json(ErrorSchema, { error: 'Internal server error.' }, 500)
  if (error.code === 'invalid') return json(ErrorSchema, { error: error.message }, 400)
  if (error.code === 'unsupported') return json(ErrorSchema, { error: error.message }, 422)
  if (error.code === 'provider') return json(ErrorSchema, { error: 'Payment provider is temporarily unavailable.' }, 502)
  if (error.code === 'conflict') return json(ErrorSchema, { error: error.message }, 409)
  return json(ErrorSchema, { error: 'Resource not found.' }, 404)
}

function scope(input: FumaScopedRouteHandlerInput): PublicationMerchantScope {
  const repository = input.repositoryScope
  if (!input.context.capabilities.includes('publication.members')
    || repository.platformId !== input.context.scope.platform.id
    || repository.organizationId !== input.context.scope.organization.id
    || repository.workspaceId !== input.context.scope.workspace.id
    || repository.siteId !== input.context.scope.site.id) {
    throw new CustomerPaymentError('scope', 'Publication merchant route authority denied.')
  }
  return Object.freeze({
    platformId: repository.platformId,
    organizationId: repository.organizationId,
    workspaceId: repository.workspaceId,
    siteId: repository.siteId,
    ownerKey: repository.ownerKey,
    ownerGeneration: repository.generation,
  })
}

function view(credential: CustomerMerchantCredential) {
  return Object.freeze({
    credentialId: credential.credentialId,
    scope: credential.scope,
    merchantScope: credential.merchantScope,
    version: credential.version,
    state: credential.state,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  })
}

export function createCustomerMerchantCredentialRouteDeclarations(
  service: CustomerMerchantPaymentService,
): readonly FumaScopedRouteDeclaration[] {
  return Object.freeze([
    Object.freeze({
      method: 'POST' as const,
      path: '/publication/payments/merchant-credentials' as const,
      permission: 'site.settings.write' as const,
      handler: async (input: FumaScopedRouteHandlerInput) => {
        try {
          if (input.context.actor.kind !== 'staff' || input.context.actor.impersonator !== null) {
            throw new CustomerPaymentError('scope', 'Direct staff authority is required.')
          }
          const request = await readValidatedBody(input.request, AttachCustomerMerchantCredentialRequestSchema)
          if (!request) return json(ErrorSchema, { error: 'Merchant credential request is invalid.' }, 400)
          const credential = await service.attachCredential(scope(input), request.secret, request.credentialId)
          return json(CustomerMerchantCredentialViewSchema, view(credential), 201)
        } catch (error) {
          return failure(error)
        }
      },
    }),
  ])
}

export interface PublicationPayerAuthorityResolver {
  resolve(request: Request): Promise<PublicationPayerAuthority | null>
}

export class CustomerMemberPaymentBoundary {
  readonly #service: CustomerMerchantPaymentService
  readonly #authority: PublicationPayerAuthorityResolver

  constructor(service: CustomerMerchantPaymentService, authority: PublicationPayerAuthorityResolver) {
    this.#service = service
    this.#authority = authority
  }

  handles(request: Request): boolean {
    return new URL(request.url).pathname.startsWith(CUSTOMER_MEMBER_PAYMENT_PREFIX)
  }

  async handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname
    if (!path.startsWith(CUSTOMER_MEMBER_PAYMENT_PREFIX)) return null
    if (request.method !== 'POST') return json(ErrorSchema, { error: 'Resource not found.' }, 404)
    try {
      const authority = await this.#authority.resolve(request)
      if (!authority) throw new CustomerPaymentError('scope', 'Member payment authority denied.')
      if (path === `${CUSTOMER_MEMBER_PAYMENT_PREFIX}initialize`) {
        const body = await readValidatedBody(request, MembershipPurchaseRequestSchema)
        if (!body) return json(ErrorSchema, { error: 'Membership purchase request is invalid.' }, 400)
        return json(MembershipInitializationSchema, await this.#service.initialize(authority, body), 201)
      }
      if (path === `${CUSTOMER_MEMBER_PAYMENT_PREFIX}reconcile`) {
        const body = await readValidatedBody(request, ReconcileRequestSchema)
        if (!body) return json(ErrorSchema, { error: 'Reconciliation request is invalid.' }, 400)
        return json(PaidMembershipSchema, await this.#service.reconcile(authority, body.purchaseId, body.reference))
      }
      return json(ErrorSchema, { error: 'Resource not found.' }, 404)
    } catch (error) {
      return failure(error)
    }
  }
}

const CUSTOMER_MERCHANT_WEBHOOK_PREFIX = '/_fuma/paystack/webhooks/customer-merchant/'
const MAX_WEBHOOK_BYTES = 1_048_576

async function boundedRawBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_WEBHOOK_BYTES) {
      throw new TypeError('Customer merchant webhook body is outside the bounded size.')
    }
  }
  const raw = new Uint8Array(await request.arrayBuffer())
  if (raw.byteLength > MAX_WEBHOOK_BYTES) throw new TypeError('Customer merchant webhook body is outside the bounded size.')
  return raw
}

/** Selects one explicit customer credential before signature verification; all outcomes are non-oracular. */
export class CustomerMerchantWebhookBoundary {
  readonly #service: CustomerMerchantPaymentService
  constructor(service: CustomerMerchantPaymentService) { this.#service = service }

  handles(request: Request): boolean {
    return new URL(request.url).pathname.startsWith(CUSTOMER_MERCHANT_WEBHOOK_PREFIX)
  }

  async handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname
    if (!path.startsWith(CUSTOMER_MERCHANT_WEBHOOK_PREFIX)) return null
    let credentialId = ''
    try {
      credentialId = decodeURIComponent(path.slice(CUSTOMER_MERCHANT_WEBHOOK_PREFIX.length))
    } catch {
      // Malformed paths are indistinguishable from unknown credentials.
    }
    if (request.method === 'POST' && credentialId.length > 0 && !credentialId.includes('/')) {
      try {
        await this.#service.ingestWebhook(
          credentialId,
          await boundedRawBody(request),
          request.headers.get('x-paystack-signature') ?? '',
        )
      } catch {
        // Accepted, duplicate, unknown credential and invalid signature are deliberately indistinguishable.
      }
    }
    return json(Type.Object({ accepted: Type.Literal(true) }, { additionalProperties: false }), { accepted: true }, 202)
  }
}
