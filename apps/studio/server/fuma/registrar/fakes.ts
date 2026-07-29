import { credentialAuthorityKey, type DomainCredentialAuthority } from '../domains/contracts'
import type {
  DomainRegistration,
  RegistrarAvailability,
  RegistrarQuote,
  RegistrationContacts,
} from './contracts'
import type { AuthorizedRegistrarProvider, FumaManagedDnsOnboarding } from './workflow'

export class FakeRegistrarClock {
  #value: Date
  constructor(at = '2026-07-28T12:00:00.000Z') { this.#value = new Date(at) }
  now = (): Date => new Date(this.#value)
  advance(milliseconds: number): void { this.#value = new Date(this.#value.getTime() + milliseconds) }
}

/** Deterministic, network-free provider. Fault modes model timeout-before/after-commit. */
export class DeterministicFakeRegistrarProvider implements AuthorizedRegistrarProvider {
  readonly purchases = new Map<string, Readonly<{ providerReference: string; registeredAt: string; expiresAt: string }>>()
  readonly renewals = new Map<string, Readonly<{ providerReference: string; expiresAt: string }>>()
  readonly calls: string[] = []
  available = true
  purchaseFault: 'none' | 'before-commit' | 'after-commit' = 'none'
  renewalFault: 'none' | 'before-commit' | 'after-commit' = 'none'
  readonly #now: () => Date
  readonly #authorityKey: string

  constructor(authority: DomainCredentialAuthority, now: () => Date = () => new Date('2026-07-28T12:00:00.000Z')) {
    this.#authorityKey = credentialAuthorityKey(authority)
    this.#now = now
  }
  #assert(authority: DomainCredentialAuthority): void {
    if (credentialAuthorityKey(authority) !== this.#authorityKey) throw new Error('fake registrar credential authority denied')
  }
  async search(authority: DomainCredentialAuthority, hostname: string): Promise<RegistrarAvailability> {
    this.#assert(authority); this.calls.push(`search:${hostname}`); return { hostname, available: this.available }
  }
  async quote(authority: DomainCredentialAuthority, hostname: string, periodYears: number): Promise<RegistrarQuote> {
    this.#assert(authority); this.calls.push(`quote:${hostname}:${periodYears}`)
    const expiresAt = new Date(this.#now().getTime() + 15 * 60_000).toISOString()
    return {
      quoteId: `quote:${new Bun.CryptoHasher('sha256').update(`${hostname}:${periodYears}:${expiresAt}`).digest('hex').slice(0, 32)}`,
      provider: 'deterministic-fake', hostname, available: true, currency: 'KES',
      registrationAmountMinor: 120_000 * periodYears, renewalAmountMinor: 130_000 * periodYears,
      periodYears, expiresAt, providerQuoteReference: `provider-quote:${hostname}:${periodYears}`,
      termsHash: new Bun.CryptoHasher('sha256').update(`fake-terms:${hostname}:${periodYears}:${expiresAt}`).digest('hex'),
    }
  }
  async purchase(authority: DomainCredentialAuthority, quote: RegistrarQuote, _contacts: RegistrationContacts, idempotencyKey: string) {
    this.#assert(authority); this.calls.push(`purchase:${idempotencyKey}`)
    const prior = this.purchases.get(idempotencyKey); if (prior) return prior
    if (this.purchaseFault === 'before-commit') throw new Error('deterministic timeout before purchase commit')
    const registeredAt = this.#now().toISOString()
    const value = Object.freeze({
      providerReference: `provider-registration:${new Bun.CryptoHasher('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`,
      registeredAt,
      expiresAt: new Date(Date.parse(registeredAt) + quote.periodYears * 365 * 86_400_000).toISOString(),
    })
    this.purchases.set(idempotencyKey, value)
    if (this.purchaseFault === 'after-commit') throw new Error('deterministic timeout after purchase commit')
    return value
  }
  async lookupPurchase(authority: DomainCredentialAuthority, idempotencyKey: string) {
    this.#assert(authority); this.calls.push(`lookup-purchase:${idempotencyKey}`); return this.purchases.get(idempotencyKey) ?? null
  }
  async renew(authority: DomainCredentialAuthority, registration: DomainRegistration, periodYears: number, idempotencyKey: string) {
    this.#assert(authority); this.calls.push(`renew:${idempotencyKey}`)
    const prior = this.renewals.get(idempotencyKey); if (prior) return prior
    if (this.renewalFault === 'before-commit') throw new Error('deterministic timeout before renewal commit')
    const value = Object.freeze({
      providerReference: `provider-renewal:${new Bun.CryptoHasher('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`,
      expiresAt: new Date(Date.parse(registration.expiresAt) + periodYears * 365 * 86_400_000).toISOString(),
    })
    this.renewals.set(idempotencyKey, value)
    if (this.renewalFault === 'after-commit') throw new Error('deterministic timeout after renewal commit')
    return value
  }
  async lookupRenewal(authority: DomainCredentialAuthority, idempotencyKey: string) {
    this.#assert(authority); this.calls.push(`lookup-renewal:${idempotencyKey}`); return this.renewals.get(idempotencyKey) ?? null
  }
}

export class FakeFumaManagedDnsOnboarding implements FumaManagedDnsOnboarding {
  readonly handoffs: Parameters<FumaManagedDnsOnboarding['onboard']>[0][] = []
  fail = false
  async onboard(input: Parameters<FumaManagedDnsOnboarding['onboard']>[0]): Promise<void> {
    if (this.fail) throw new Error('deterministic DNS onboarding interruption')
    const prior = this.handoffs.find((candidate) => candidate.domainId === input.domainId)
    if (prior && JSON.stringify(prior) !== JSON.stringify(input)) throw new Error('DNS onboarding identity changed')
    if (!prior) this.handoffs.push(structuredClone(input))
  }
}
