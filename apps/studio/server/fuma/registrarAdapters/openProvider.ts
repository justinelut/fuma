/**
 * OpenProvider reseller adapter.
 *
 * Deliberately outside `server/fuma/registrar/`. That directory is guarded by an
 * architecture test forbidding any vendor name, so the purchase workflow stays
 * provider-neutral and swapping registrars later is an adapter change rather than a
 * rewrite. This file is the one place OpenProvider is named.
 *
 * It implements the same `AuthorizedRegistrarProvider` seam the workflow already
 * depends on, so the workflow's guarantees — idempotency keys, ambiguity
 * reconciliation, step-up confirmation, exact-amount checks — apply unchanged.
 *
 * Two responsibilities that are easy to get wrong:
 *
 *   - **Vendor codes must not leak upward.** The workflow reasons about typed
 *     outcomes, not about what a registrar's API happened to return. An adapter that
 *     passed codes through would put vendor knowledge back into the core through the
 *     error path.
 *   - **A timeout is not a failure.** Registration is not idempotent at the registry:
 *     a request that times out may well have succeeded. So a lookup by idempotency
 *     key must be able to answer "did this already happen?", and an ambiguous outcome
 *     must stay ambiguous rather than being retried into a double registration.
 */

import { safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import type { DomainCredentialAuthority } from '../domains/contracts'
import {
  RegistrarAvailabilitySchema,
  RegistrarPurchaseProviderResultSchema,
  RegistrarQuoteSchema,
  RegistrarRenewalProviderResultSchema,
  type DomainRegistration,
  type RegistrarQuote,
  type RegistrationContacts,
} from '../registrar/contracts'
import type {
  RegistrarGatewayHttpClient,
  RegistrarGatewayRequest,
} from '../registrar/productionGateway'
import type { AuthorizedRegistrarProvider } from '../registrar/workflow'

/** The vendor this adapter speaks to. Named here and nowhere else. */
export const REGISTRAR_VENDOR = 'openprovider' as const

export class OpenProviderError extends Error {
  readonly code: 'configuration' | 'authentication' | 'unavailable' | 'contract' | 'provider'
  constructor(code: OpenProviderError['code'], message: string) {
    super(message)
    this.name = 'OpenProviderError'
    this.code = code
  }
}

/**
 * Map a vendor response code to a typed outcome.
 *
 * The mapping is the adapter's real job. Each group is distinguished because the
 * workflow does something different with it — an authentication failure must not be
 * retried, an unavailable domain is a normal answer rather than an error, and an
 * unrecognised code has to stay opaque rather than being guessed at.
 */
export function classifyResponse(status: number, vendorCode?: number): OpenProviderError['code'] {
  if (status === 401 || status === 403) return 'authentication'
  // 320/399 are the vendor's "domain not available" family. Treated as a normal
  // negative answer, not a fault, so a search for a taken domain is not an incident.
  if (vendorCode === 320 || vendorCode === 399) return 'unavailable'
  if (status === 400 || status === 422) return 'contract'
  return 'provider'
}

export type OpenProviderAdapterInput = Readonly<{
  /** HTTPS origin of the reseller API. */
  origin: string
  /** Bearer credential, held as bytes so it can be zeroed on close. */
  token: Uint8Array
  http: RegistrarGatewayHttpClient
}>

/**
 * The adapter.
 *
 * Every response is validated against the registrar core's own schemas before being
 * returned, so a vendor field rename surfaces as a contract failure here rather than
 * as a malformed quote deep inside the purchase workflow.
 */
export class OpenProviderRegistrarAdapter implements AuthorizedRegistrarProvider {
  readonly #origin: string
  readonly #token: Uint8Array
  readonly #http: RegistrarGatewayHttpClient
  #closed = false

  constructor(input: OpenProviderAdapterInput) {
    const url = ((): URL => {
      try {
        return new URL(input.origin)
      } catch {
        throw new OpenProviderError('configuration', 'Registrar origin is not a valid URL.')
      }
    })()
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new OpenProviderError(
        'configuration',
        'Registrar origin must be a bare HTTPS origin with no credentials or query.',
      )
    }
    if (input.token.byteLength < 16 || input.token.byteLength > 4096) {
      throw new OpenProviderError('configuration', 'Registrar token length is implausible.')
    }
    this.#origin = url.origin
    // Copied so a caller zeroing their buffer cannot leave this adapter holding a
    // truncated credential.
    this.#token = input.token.slice()
    this.#http = input.http
  }

  /** Zero the credential. Called when the adapter is retired. */
  close(): void {
    this.#closed = true
    this.#token.fill(0)
  }

  async #call<T extends TSchema>(
    schema: T,
    path: string,
    body: unknown,
  ): Promise<Static<T>> {
    if (this.#closed) {
      throw new OpenProviderError('configuration', 'Adapter is closed.')
    }

    const request: RegistrarGatewayRequest = Object.freeze({
      method: 'POST',
      url: `${this.#origin}${path}`,
      headers: Object.freeze({
        authorization: `Bearer ${new TextDecoder().decode(this.#token)}`,
        'content-type': 'application/json',
      }),
      body,
    })

    let response: Readonly<{ status: number, body: unknown }>
    try {
      response = await this.#http.request(request)
    } catch {
      // Transport failure. Deliberately not distinguished from a provider fault: the
      // caller's recovery is the same, and the operation may still have landed.
      throw new OpenProviderError('provider', 'Registrar request did not complete.')
    }

    if (response.status < 200 || response.status >= 300) {
      const vendorCode = typeof response.body === 'object' && response.body !== null
        ? (response.body as { code?: unknown }).code
        : undefined
      const code = classifyResponse(
        response.status,
        typeof vendorCode === 'number' ? vendorCode : undefined,
      )
      // The vendor's own message is not forwarded: it would put vendor vocabulary in
      // front of a customer and vendor knowledge into the caller.
      throw new OpenProviderError(code, describeFailure(code))
    }

    const parsed = safeParseValue(schema, response.body)
    if (!parsed.ok) {
      throw new OpenProviderError(
        'contract',
        'Registrar response did not match its expected shape. The provider API may have changed.',
      )
    }
    return parsed.value
  }

  async search(authority: DomainCredentialAuthority, hostname: string) {
    return await this.#call(RegistrarAvailabilitySchema, '/v1beta/domains/check', {
      authority, hostname,
    })
  }

  async quote(authority: DomainCredentialAuthority, hostname: string, periodYears: number) {
    return await this.#call(RegistrarQuoteSchema, '/v1beta/domains/price', {
      authority, hostname, periodYears,
    })
  }

  async purchase(
    authority: DomainCredentialAuthority,
    quote: RegistrarQuote,
    contacts: RegistrationContacts,
    idempotencyKey: string,
  ) {
    return await this.#call(RegistrarPurchaseProviderResultSchema, '/v1beta/domains', {
      authority, quote, contacts, idempotencyKey,
    })
  }

  /**
   * Ask whether a purchase already happened.
   *
   * Returns null only when the provider positively reports nothing under this key.
   * A transport failure throws instead, because "we could not ask" and "it did not
   * happen" must not collapse into the same answer — that is precisely how a domain
   * gets registered twice.
   */
  async lookupPurchase(authority: DomainCredentialAuthority, idempotencyKey: string) {
    try {
      return await this.#call(
        RegistrarPurchaseProviderResultSchema,
        '/v1beta/domains/by-idempotency',
        { authority, idempotencyKey },
      )
    } catch (error) {
      if (error instanceof OpenProviderError && error.code === 'unavailable') return null
      throw error
    }
  }

  async renew(
    authority: DomainCredentialAuthority,
    registration: DomainRegistration,
    periodYears: number,
    idempotencyKey: string,
  ) {
    return await this.#call(RegistrarRenewalProviderResultSchema, '/v1beta/domains/renew', {
      authority, registration, periodYears, idempotencyKey,
    })
  }

  async lookupRenewal(authority: DomainCredentialAuthority, idempotencyKey: string) {
    try {
      return await this.#call(
        RegistrarRenewalProviderResultSchema,
        '/v1beta/domains/renew/by-idempotency',
        { authority, idempotencyKey },
      )
    } catch (error) {
      if (error instanceof OpenProviderError && error.code === 'unavailable') return null
      throw error
    }
  }
}

/**
 * Operator-facing description for a failure class.
 *
 * Written for whoever reads the log, and deliberately free of vendor vocabulary so
 * the message stays true if the registrar is ever swapped.
 */
export function describeFailure(code: OpenProviderError['code']): string {
  switch (code) {
    case 'authentication':
      return 'The registrar rejected our credentials. Registration is unavailable until they are renewed.'
    case 'unavailable':
      return 'The registrar reports this domain is not available.'
    case 'contract':
      return 'The registrar rejected the request as malformed.'
    case 'configuration':
      return 'The registrar adapter is misconfigured.'
    default:
      return 'The registrar is temporarily unreachable.'
  }
}

/** Whether a failure class is worth retrying. */
export function isRetryable(code: OpenProviderError['code']): boolean {
  // Authentication and contract failures repeat identically until something changes,
  // so retrying them only burns the rate limit.
  return code === 'provider'
}
