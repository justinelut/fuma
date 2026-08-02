import { Value } from '@core/utils/typeboxHelpers'
import {
  DomainCredentialAuthoritySchema,
  DomainScopeSchema,
  normalizeDomainHostname,
  parseDomainContract,
  sameDomainScope,
  type DomainCredentialAuthority,
  type DomainScope,
} from '../domains/contracts'
import {
  ConfirmedRegistrarPurchaseSchema,
  ConfirmedRegistrarRenewalSchema,
  DomainRegistrationSchema,
  RegistrarAvailabilitySchema,
  RegistrarDnsHandoffSchema,
  RegistrarOperationSchema,
  RegistrarPurchaseProviderResultSchema,
  RegistrarPurchaseReceiptSchema,
  RegistrarQuoteSchema,
  RegistrarRenewalProviderResultSchema,
  RegistrarRenewalReceiptSchema,
  RegistrarSearchRequestSchema,
  registrarHash,
  strictRegistrarValue,
  type ConfirmedRegistrarPurchase,
  type ConfirmedRegistrarRenewal,
  type DomainRegistration,
  type RegistrarAvailability,
  type RegistrarDnsHandoff,
  type RegistrarOperation,
  type RegistrarPurchaseProviderResult,
  type RegistrarPurchaseReceipt,
  type RegistrarQuote,
  type RegistrarRenewalProviderResult,
  type RegistrarRenewalReceipt,
  type RegistrationContacts,
} from './contracts'
import type { StepUpAuthority } from './service'
export interface AuthorizedRegistrarProvider {
  search(authority: DomainCredentialAuthority, hostname: string): Promise<RegistrarAvailability>
  quote(authority: DomainCredentialAuthority, hostname: string, periodYears: number): Promise<RegistrarQuote>
  purchase(
    authority: DomainCredentialAuthority,
    quote: RegistrarQuote,
    contacts: RegistrationContacts,
    idempotencyKey: string,
  ): Promise<RegistrarPurchaseProviderResult>
  lookupPurchase(authority: DomainCredentialAuthority, idempotencyKey: string): Promise<RegistrarPurchaseProviderResult | null>
  renew(
    authority: DomainCredentialAuthority,
    registration: DomainRegistration,
    periodYears: number,
    idempotencyKey: string,
  ): Promise<RegistrarRenewalProviderResult>
  lookupRenewal(authority: DomainCredentialAuthority, idempotencyKey: string): Promise<RegistrarRenewalProviderResult | null>
}

export interface RegistrarWorkflowRepository {
  saveQuote(scope: DomainScope, quote: RegistrarQuote, createdAt: string): Promise<RegistrarQuote>
  quote(scope: DomainScope, quoteId: string): Promise<RegistrarQuote | null>
  begin(operation: RegistrarOperation): Promise<RegistrarOperation>
  operation(scope: DomainScope, operationId: string): Promise<RegistrarOperation | null>
  recordAttempt(scope: DomainScope, operationId: string, at: string): Promise<RegistrarOperation>
  markAmbiguous(scope: DomainScope, operationId: string, at: string): Promise<void>
  registration(scope: DomainScope, registrationId: string): Promise<DomainRegistration | null>
  registrationForQuote(scope: DomainScope, quoteId: string): Promise<DomainRegistration | null>
  registrations(scope: DomainScope): Promise<readonly DomainRegistration[]>
  purchaseReceipt(scope: DomainScope, operationId: string): Promise<RegistrarPurchaseReceipt | null>
  renewalReceipt(scope: DomainScope, operationId: string): Promise<RegistrarRenewalReceipt | null>
  completePurchase(input: Readonly<{
    operation: RegistrarOperation
    registration: DomainRegistration
    receipt: RegistrarPurchaseReceipt
    handoff: RegistrarDnsHandoff
    completedAt: string
  }>): Promise<RegistrarPurchaseReceipt>
  completeRenewal(input: Readonly<{
    operation: RegistrarOperation
    registration: DomainRegistration
    receipt: RegistrarRenewalReceipt
    completedAt: string
  }>): Promise<RegistrarRenewalReceipt>
  pendingHandoff(scope: DomainScope, operationId: string): Promise<RegistrarDnsHandoff | null>
  completeHandoff(scope: DomainScope, handoffId: string, completedAt: string): Promise<void>
}

export interface FumaManagedDnsOnboarding {
  onboard(input: Readonly<{
    scope: DomainScope
    authority: DomainCredentialAuthority
    credentialId: string
    domainId: string
    registrationId: string
    hostname: string
    requestedAt: string
  }>): Promise<void>
}

export class RegistrarWorkflowError extends Error {
  readonly code: 'invalid' | 'unavailable' | 'stale-quote' | 'changed-quote' | 'step-up' | 'entitlement' | 'ambiguous' | 'conflict' | 'not-found'
  constructor(code: RegistrarWorkflowError['code'], message: string) {
    super(message)
    this.name = 'RegistrarWorkflowError'
    this.code = code
  }
}

function exactScope(input: DomainScope): DomainScope {
  return parseDomainContract(DomainScopeSchema, input, 'Registrar domain scope') as DomainScope
}
function exactAuthority(input: DomainCredentialAuthority, platformId: string): DomainCredentialAuthority {
  const authority = parseDomainContract(DomainCredentialAuthoritySchema, input, 'Registrar provider credential authority') as DomainCredentialAuthority
  if (authority.scope !== 'fuma-platform' || authority.platformId !== platformId) {
    throw new RegistrarWorkflowError('invalid', 'Registrar provider requires one explicit matching Fuma platform credential authority.')
  }
  return authority
}
function exactQuote(quote: RegistrarQuote | null, now: Date): RegistrarQuote {
  if (!quote || !Value.Check(RegistrarQuoteSchema, quote) || Date.parse(quote.expiresAt) <= now.getTime()) {
    throw new RegistrarWorkflowError('stale-quote', 'The exact registrar quote is missing, invalid, or expired.')
  }
  return quote
}
function operationId(kind: 'purchase' | 'renew', scope: DomainScope, requestId: string): string {
  return `${kind}:${registrarHash([scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, requestId]).slice(0, 48)}`
}
function key(kind: 'purchase' | 'renew', scope: DomainScope, identity: string): string {
  return `registrar-${kind}:${registrarHash([scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, identity])}`
}
function validPurchaseResult(result: RegistrarPurchaseProviderResult | null): result is RegistrarPurchaseProviderResult {
  return Boolean(result && Value.Check(RegistrarPurchaseProviderResultSchema, result)
    && Date.parse(result.expiresAt) > Date.parse(result.registeredAt))
}
function validRenewalResult(result: RegistrarRenewalProviderResult | null, priorExpiry: string): result is RegistrarRenewalProviderResult {
  return Boolean(result && Value.Check(RegistrarRenewalProviderResultSchema, result)
    && Date.parse(result.expiresAt) > Date.parse(priorExpiry))
}
function sameOperationRequest(operation: RegistrarOperation, requestHash: string, authority: DomainCredentialAuthority): boolean {
  return operation.requestHash === requestHash
    && JSON.stringify(operation.authority) === JSON.stringify(authority)
}

export class RegistrarWorkflow {
  readonly #provider: AuthorizedRegistrarProvider
  readonly #repository: RegistrarWorkflowRepository
  readonly #stepUp: StepUpAuthority
  readonly #entitled: (scope: DomainScope) => Promise<boolean>
  readonly #onboarding: FumaManagedDnsOnboarding
  readonly #authority: DomainCredentialAuthority
  readonly #credentialId: string
  readonly #now: () => Date

  constructor(input: Readonly<{
    provider: AuthorizedRegistrarProvider
    repository: RegistrarWorkflowRepository
    stepUp: StepUpAuthority
    entitled: (scope: DomainScope) => Promise<boolean>
    onboarding: FumaManagedDnsOnboarding
    authority: DomainCredentialAuthority
    credentialId: string
    now?: () => Date
  }>) {
    if (!input.credentialId) throw new RegistrarWorkflowError('invalid', 'Registrar credential identity is required.')
    if (!Value.Check(DomainCredentialAuthoritySchema, input.authority) || input.authority.scope !== 'fuma-platform') {
      throw new RegistrarWorkflowError('invalid', 'Registrar authority must be explicit Fuma platform authority.')
    }
    this.#provider = input.provider
    this.#repository = input.repository
    this.#stepUp = input.stepUp
    this.#entitled = input.entitled
    this.#onboarding = input.onboarding
    this.#authority = Object.freeze(structuredClone(input.authority))
    this.#credentialId = input.credentialId
    this.#now = input.now ?? (() => new Date())
  }

  async searchAndQuote(scopeInput: DomainScope, raw: unknown): Promise<RegistrarQuote> {
    const scope = exactScope(scopeInput)
    const authority = exactAuthority(this.#authority, scope.platformId)
    const request = strictRegistrarValue(RegistrarSearchRequestSchema, raw, 'Registrar search request')
    const hostname = normalizeDomainHostname(request.hostname).hostname
    const availability = strictRegistrarValue(RegistrarAvailabilitySchema, await this.#provider.search(authority, hostname), 'Registrar availability')
    if (availability.hostname !== hostname) throw new RegistrarWorkflowError('conflict', 'Registrar availability changed hostname identity.')
    if (!availability.available) throw new RegistrarWorkflowError('unavailable', 'Domain is unavailable.')
    const quote = strictRegistrarValue(RegistrarQuoteSchema, await this.#provider.quote(authority, hostname, request.periodYears), 'Registrar quote')
    if (quote.hostname !== hostname || quote.periodYears !== request.periodYears || quote.currency !== 'KES'
      || !quote.available || Date.parse(quote.expiresAt) <= this.#now().getTime()) {
      throw new RegistrarWorkflowError('changed-quote', 'Registrar quote does not match the exact available hostname and period.')
    }
    return await this.#repository.saveQuote(scope, quote, this.#now().toISOString())
  }

  async purchase(scopeInput: DomainScope, raw: unknown): Promise<RegistrarPurchaseReceipt> {
    const scope = exactScope(scopeInput)
    const authority = exactAuthority(this.#authority, scope.platformId)
    const request = strictRegistrarValue(ConfirmedRegistrarPurchaseSchema, raw, 'Confirmed registrar purchase') as ConfirmedRegistrarPurchase
    const id = operationId('purchase', scope, request.requestId)
    const requestHash = registrarHash(request)
    const prior = await this.#repository.operation(scope, id)
    if (prior) {
      if (!sameOperationRequest(prior, requestHash, authority)) throw new RegistrarWorkflowError('conflict', 'Purchase request identity was reused with changed evidence.')
      const receipt = await this.#repository.purchaseReceipt(scope, id)
      if (receipt) { await this.#finishHandoff(scope, id); return receipt }
    }
    const quote = exactQuote(await this.#repository.quote(scope, request.quoteId), this.#now())
    if (request.confirmation !== `PURCHASE ${quote.hostname}` || request.expectedHostname !== quote.hostname
      || request.expectedAmountMinor !== quote.registrationAmountMinor || request.currency !== quote.currency
      || request.expectedTermsHash !== quote.termsHash) {
      throw new RegistrarWorkflowError('changed-quote', 'Purchase confirmation does not match the exact quote, amount, currency, hostname, and terms.')
    }
    if (!await this.#entitled(scope)) throw new RegistrarWorkflowError('entitlement', 'Domain purchase entitlement denied.')
    if (!prior && !await this.#stepUp.consume(request.stepUpProof, `registrar-purchase:${quote.quoteId}:${quote.termsHash}`)) {
      throw new RegistrarWorkflowError('step-up', 'Fresh step-up confirmation is required for this exact purchase quote.')
    }
    const operation = prior ?? await this.#repository.begin(strictRegistrarValue(RegistrarOperationSchema, {
      operationId: id, kind: 'purchase', scope, authority, requestHash, request,
      quoteId: quote.quoteId, registrationId: null, idempotencyKey: key('purchase', scope, quote.quoteId),
      state: 'pending', attempts: 0, createdAt: this.#now().toISOString(), updatedAt: this.#now().toISOString(),
    }, 'Registrar purchase operation'))
    return await this.#executePurchase(operation, quote, request)
  }

  async renew(scopeInput: DomainScope, raw: unknown): Promise<RegistrarRenewalReceipt> {
    const scope = exactScope(scopeInput)
    const authority = exactAuthority(this.#authority, scope.platformId)
    const request = strictRegistrarValue(ConfirmedRegistrarRenewalSchema, raw, 'Confirmed registrar renewal') as ConfirmedRegistrarRenewal
    const id = operationId('renew', scope, request.requestId)
    const requestHash = registrarHash(request)
    const prior = await this.#repository.operation(scope, id)
    if (prior) {
      if (!sameOperationRequest(prior, requestHash, authority)) throw new RegistrarWorkflowError('conflict', 'Renewal request identity was reused with changed evidence.')
      const receipt = await this.#repository.renewalReceipt(scope, id)
      if (receipt) return receipt
    }
    const registration = await this.#repository.registration(scope, request.registrationId)
    if (!registration || registration.state === 'ambiguous') throw new RegistrarWorkflowError('not-found', 'Exact active registration is unavailable.')
    const quote = exactQuote(await this.#repository.quote(scope, request.quoteId), this.#now())
    if (request.confirmation !== `RENEW ${registration.hostname}` || request.expectedHostname !== registration.hostname
      || request.expectedPreviousExpiresAt !== registration.expiresAt || quote.hostname !== registration.hostname
      || request.expectedAmountMinor !== quote.renewalAmountMinor || request.currency !== quote.currency
      || request.periodYears !== quote.periodYears || request.expectedTermsHash !== quote.termsHash) {
      throw new RegistrarWorkflowError('changed-quote', 'Renewal confirmation changed hostname, quote version, prior expiry, amount, currency, or period.')
    }
    if (!await this.#entitled(scope)) throw new RegistrarWorkflowError('entitlement', 'Domain renewal entitlement denied.')
    if (!prior && !await this.#stepUp.consume(request.stepUpProof, `registrar-renew:${registration.registrationId}:${registration.expiresAt}:${quote.termsHash}`)) {
      throw new RegistrarWorkflowError('step-up', 'Fresh step-up confirmation is required for this exact renewal quote.')
    }
    const operation = prior ?? await this.#repository.begin(strictRegistrarValue(RegistrarOperationSchema, {
      operationId: id, kind: 'renew', scope, authority, requestHash, request,
      quoteId: quote.quoteId, registrationId: registration.registrationId,
      idempotencyKey: key('renew', scope, `${registration.registrationId}:${registration.expiresAt}`),
      state: 'pending', attempts: 0, createdAt: this.#now().toISOString(), updatedAt: this.#now().toISOString(),
    }, 'Registrar renewal operation'))
    return await this.#executeRenewal(operation, quote, registration, request)
  }

  async reconcile(scopeInput: DomainScope, operationIdValue: string): Promise<RegistrarPurchaseReceipt | RegistrarRenewalReceipt> {
    const scope = exactScope(scopeInput)
    const operation = await this.#repository.operation(scope, operationIdValue)
    if (!operation || !sameDomainScope(scope, operation.scope)) throw new RegistrarWorkflowError('not-found', 'Registrar operation is unavailable.')
    if (operation.kind === 'purchase') {
      const receipt = await this.#repository.purchaseReceipt(scope, operation.operationId)
      if (receipt) { await this.#finishHandoff(scope, operation.operationId); return receipt }
      const request = strictRegistrarValue(ConfirmedRegistrarPurchaseSchema, operation.request, 'Stored registrar purchase') as ConfirmedRegistrarPurchase
      return await this.#executePurchase(operation, exactQuote(await this.#repository.quote(scope, operation.quoteId), this.#now()), request)
    }
    const receipt = await this.#repository.renewalReceipt(scope, operation.operationId)
    if (receipt) return receipt
    const request = strictRegistrarValue(ConfirmedRegistrarRenewalSchema, operation.request, 'Stored registrar renewal') as ConfirmedRegistrarRenewal
    const registration = operation.registrationId ? await this.#repository.registration(scope, operation.registrationId) : null
    if (!registration) throw new RegistrarWorkflowError('not-found', 'Renewal registration is unavailable.')
    return await this.#executeRenewal(operation, exactQuote(await this.#repository.quote(scope, operation.quoteId), this.#now()), registration, request)
  }

  async #executePurchase(operation: RegistrarOperation, quote: RegistrarQuote, request: ConfirmedRegistrarPurchase): Promise<RegistrarPurchaseReceipt> {
    const authority = exactAuthority(operation.authority, operation.scope.platformId)
    const attempted = await this.#repository.recordAttempt(operation.scope, operation.operationId, this.#now().toISOString())
    let result: RegistrarPurchaseProviderResult | null
    try {
      result = attempted.attempts > 1
        ? await this.#provider.lookupPurchase(authority, operation.idempotencyKey)
        : await this.#provider.purchase(authority, quote, request.contacts, operation.idempotencyKey)
    } catch {
      result = await this.#provider.lookupPurchase(authority, operation.idempotencyKey)
    }
    if (!validPurchaseResult(result)) {
      await this.#repository.markAmbiguous(operation.scope, operation.operationId, this.#now().toISOString())
      throw new RegistrarWorkflowError('ambiguous', 'Registrar purchase outcome is ambiguous; exact provider lookup must reconcile it before retry.')
    }
    const registrationId = `registration:${registrarHash([
      operation.scope.platformId, operation.scope.organizationId, operation.scope.workspaceId,
      operation.scope.siteId, operation.scope.ownerKey, operation.scope.generation, quote.quoteId,
    ]).slice(0, 40)}`
    const receiptId = `receipt:${registrarHash([operation.operationId, operation.idempotencyKey]).slice(0, 40)}`
    const registration = strictRegistrarValue(DomainRegistrationSchema, {
      registrationId, quoteId: quote.quoteId, hostname: quote.hostname, providerReference: result.providerReference,
      registeredAt: result.registeredAt, expiresAt: result.expiresAt, state: 'active', receiptId,
    }, 'Domain registration')
    const receipt = strictRegistrarValue(RegistrarPurchaseReceiptSchema, {
      receiptId, operationId: operation.operationId, registrationId, quoteId: quote.quoteId,
      idempotencyKey: operation.idempotencyKey, providerReference: result.providerReference,
      hostname: quote.hostname, amountMinor: quote.registrationAmountMinor, currency: quote.currency,
      periodYears: quote.periodYears, registeredAt: result.registeredAt, expiresAt: result.expiresAt,
    }, 'Registrar purchase receipt')
    const domainId = `domain:${registrarHash([
      operation.scope.platformId, operation.scope.organizationId, operation.scope.workspaceId,
      operation.scope.siteId, operation.scope.ownerKey, operation.scope.generation, quote.hostname,
    ]).slice(0, 40)}`
    const handoff = strictRegistrarValue(RegistrarDnsHandoffSchema, {
      handoffId: `handoff:${registrarHash([operation.operationId, domainId]).slice(0, 40)}`,
      scope: operation.scope, authority, credentialId: this.#credentialId, domainId,
      registrationId, hostname: quote.hostname, state: 'pending', createdAt: this.#now().toISOString(), completedAt: null,
    }, 'Registrar DNS handoff')
    const saved = await this.#repository.completePurchase({ operation, registration, receipt, handoff, completedAt: this.#now().toISOString() })
    await this.#finishHandoff(operation.scope, operation.operationId)
    return saved
  }

  async #executeRenewal(operation: RegistrarOperation, quote: RegistrarQuote, registration: DomainRegistration, request: ConfirmedRegistrarRenewal): Promise<RegistrarRenewalReceipt> {
    const authority = exactAuthority(operation.authority, operation.scope.platformId)
    const attempted = await this.#repository.recordAttempt(operation.scope, operation.operationId, this.#now().toISOString())
    let result: RegistrarRenewalProviderResult | null
    try {
      result = attempted.attempts > 1
        ? await this.#provider.lookupRenewal(authority, operation.idempotencyKey)
        : await this.#provider.renew(authority, registration, request.periodYears, operation.idempotencyKey)
    } catch {
      result = await this.#provider.lookupRenewal(authority, operation.idempotencyKey)
    }
    if (!validRenewalResult(result, request.expectedPreviousExpiresAt)) {
      await this.#repository.markAmbiguous(operation.scope, operation.operationId, this.#now().toISOString())
      throw new RegistrarWorkflowError('ambiguous', 'Registrar renewal outcome is ambiguous; exact provider lookup must reconcile it before retry.')
    }
    const receipt = strictRegistrarValue(RegistrarRenewalReceiptSchema, {
      receiptId: `renewal-receipt:${registrarHash([operation.operationId, request.expectedPreviousExpiresAt]).slice(0, 40)}`,
      registrationId: registration.registrationId, quoteId: quote.quoteId, idempotencyKey: operation.idempotencyKey,
      providerReference: result.providerReference, previousExpiresAt: request.expectedPreviousExpiresAt,
      expiresAt: result.expiresAt, amountMinor: request.expectedAmountMinor, currency: request.currency,
      periodYears: request.periodYears,
    }, 'Registrar renewal receipt')
    return await this.#repository.completeRenewal({
      operation,
      registration: strictRegistrarValue(DomainRegistrationSchema, { ...registration, expiresAt: result.expiresAt, state: 'active' }, 'Renewed registration'),
      receipt,
      completedAt: this.#now().toISOString(),
    })
  }

  async #finishHandoff(scope: DomainScope, operationIdValue: string): Promise<void> {
    const handoff = await this.#repository.pendingHandoff(scope, operationIdValue)
    if (!handoff) return
    await this.#onboarding.onboard({
      scope: handoff.scope, authority: handoff.authority, credentialId: handoff.credentialId,
      domainId: handoff.domainId, registrationId: handoff.registrationId,
      hostname: handoff.hostname, requestedAt: handoff.createdAt,
    })
    await this.#repository.completeHandoff(scope, handoff.handoffId, this.#now().toISOString())
  }
}
