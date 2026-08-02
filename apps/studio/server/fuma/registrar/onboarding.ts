import {
  DomainCredentialAuthoritySchema,
  parseDomainContract,
  type DomainCredentialAuthority,
  type DomainScope,
  type DomainService,
} from '../domains/service'
import type { FumaManagedDnsOnboarding } from './workflow'

/**
 * Hands a completed registration to the finalized domain authority as `fuma-registered`.
 * This adapter names no DNS vendor and performs no DNS/TLS mutation itself.
 */
export class DomainServiceRegistrarOnboarding implements FumaManagedDnsOnboarding {
  readonly #domains: Pick<DomainService, 'create'>
  readonly #authority: DomainCredentialAuthority
  readonly #credentialId: string
  constructor(domains: Pick<DomainService, 'create'>, authority: DomainCredentialAuthority, credentialId: string) {
    const exact = parseDomainContract(DomainCredentialAuthoritySchema, authority, 'Registrar onboarding authority') as DomainCredentialAuthority
    if (exact.scope !== 'fuma-platform' || !credentialId) throw new TypeError('Registrar onboarding requires explicit Fuma platform credential authority.')
    this.#domains = domains
    this.#authority = exact
    this.#credentialId = credentialId
  }
  async onboard(input: Readonly<{
    scope: DomainScope; authority: DomainCredentialAuthority; credentialId: string; domainId: string
    registrationId: string; hostname: string; requestedAt: string
  }>): Promise<void> {
    if (JSON.stringify(input.authority) !== JSON.stringify(this.#authority) || input.credentialId !== this.#credentialId) {
      throw new TypeError('Registrar onboarding authority substitution denied.')
    }
    await this.#domains.create(input.scope, {
      domainId: input.domainId,
      hostname: input.hostname,
      kind: 'fuma-registered',
      credentialId: input.credentialId,
      requestedAt: input.requestedAt,
    })
  }
}
