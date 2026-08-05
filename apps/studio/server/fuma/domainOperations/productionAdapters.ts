import { Resolver } from 'node:dns/promises'
import type { DbClient } from '../../db/client'
import type { CloudflareSaasReconciler } from '../cloudflare/reconciler'
import type { PostgresDomainRepository } from '../domains/postgres'
import type { DomainCredentialAuthority } from '../domains/contracts'
import type { TransferSagaFence } from '../transfers/stepRegistry'
import { DnsObservationSchema, parseDomainOperations, type CustomerDnsSettings, type DnsObservation, type SiteTransferDomainState } from './contracts'
import type { OciEmailDeliveryProvider } from '../publication/servicePorts'
import type {
  CustomerDnsDetachPort,
  DomainAutomationCredentialPort,
  DomainDnsObservationPort,
  RegistrarAuthCodeDeliveryPort,
} from './service'
import type { DomainOutcomeEffectPort, DomainOutcomeOwnerAuthority } from './transferStep'
import type { PostgresDomainOperationsRepository } from './postgres'

export interface DnsResolverPort {
  resolveCname(hostname: string): Promise<readonly string[]>
  resolveTxt(hostname: string): Promise<readonly (readonly string[])[]>
  resolve4(hostname: string): Promise<readonly string[]>
}

class NodeDnsResolver implements DnsResolverPort {
  readonly #resolver = new Resolver()
  resolveCname(hostname: string) { return this.#resolver.resolveCname(hostname) }
  resolveTxt(hostname: string) { return this.#resolver.resolveTxt(hostname) }
  resolve4(hostname: string) { return this.#resolver.resolve4(hostname) }
}

/** Reads public DNS independently while Cloudflare remains the TLS-state authority. */
export class ProductionDomainDnsObserver implements DomainDnsObservationPort {
  readonly #dns: DnsResolverPort
  readonly #cloudflare: Pick<CloudflareSaasReconciler, 'exact'>
  readonly #now: () => Date
  constructor(input: Readonly<{ dns?: DnsResolverPort; cloudflare: Pick<CloudflareSaasReconciler, 'exact'>; now?: () => Date }>) {
    this.#dns = input.dns ?? new NodeDnsResolver()
    this.#cloudflare = input.cloudflare
    this.#now = input.now ?? (() => new Date())
  }
  async observe(settings: CustomerDnsSettings): Promise<DnsObservation> {
    const records = [] as Array<CustomerDnsSettings['records'][number]>
    for (const expected of settings.records) {
      try {
        const values = expected.type === 'CNAME'
          ? await this.#dns.resolveCname(expected.name)
          : expected.type === 'TXT'
            ? (await this.#dns.resolveTxt(expected.name)).map((parts) => parts.join(''))
            : await this.#dns.resolve4(expected.name)
        for (const value of values.slice(0, 20)) records.push(Object.freeze({ ...expected, value: value.replace(/\.$/, '') }))
      } catch {
        // NXDOMAIN and absent record types are represented by omission; diagnostics remain non-oracular.
      }
    }
    const binding = await this.#cloudflare.exact(settings, settings.domainId)
    const observedAt = this.#now()
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) throw new TypeError('DNS observation clock is invalid.')
    return parseDomainOperations(DnsObservationSchema, {
      records,
      tls: binding?.sslStatus ?? 'pending',
      observedAt: observedAt.toISOString(),
    }, 'Production DNS observation') as DnsObservation
  }
}

export class PostgresDomainAutomationCredentialPort implements DomainAutomationCredentialPort {
  readonly #domains: Pick<PostgresDomainRepository, 'credentialExact'>
  constructor(domains: Pick<PostgresDomainRepository, 'credentialExact'>) { this.#domains = domains }
  async state(authority: DomainCredentialAuthority, credentialId: string) {
    const value = await this.#domains.credentialExact(authority, credentialId)
    return value?.state ?? 'missing'
  }
}

export class CloudflareCustomerDnsDetachPort implements CustomerDnsDetachPort {
  readonly #cloudflare: Pick<CloudflareSaasReconciler, 'exact' | 'rollback'>
  readonly #domains: Pick<PostgresDomainRepository, 'exact'>
  constructor(input: Readonly<{ cloudflare: Pick<CloudflareSaasReconciler, 'exact' | 'rollback'>; domains: Pick<PostgresDomainRepository, 'exact'> }>) {
    this.#cloudflare = input.cloudflare
    this.#domains = input.domains
  }
  async detach(settings: CustomerDnsSettings, _operationId: string): Promise<'detached'> {
    const [binding, domain] = await Promise.all([
      this.#cloudflare.exact(settings, settings.domainId),
      this.#domains.exact(settings, settings.domainId),
    ])
    if (!binding || binding.lifecycle === 'detached' || binding.lifecycle === 'deleted') return 'detached'
    if (!domain) throw new TypeError('Domain detach authority is unavailable.')
    await this.#cloudflare.rollback(settings, domain)
    return 'detached'
  }
}

export class PostgresDomainOutcomeOwnerAuthority implements DomainOutcomeOwnerAuthority {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }
  async assertCurrent(state: SiteTransferDomainState, saga: TransferSagaFence, _phase: 'apply' | 'verify' | 'compensate'): Promise<void> {
    const source = state.choice.source
    const destination = state.choice.destination
    const result = await this.#db<{ source_ok: boolean; destination_ok: boolean }>`
      select
        exists(select 1 from fuma_tenant_owner_keys where platform_id=${source.platformId}
          and organization_id=${source.organizationId} and workspace_id=${source.workspaceId}
          and site_id=${source.siteId} and owner_key=${source.ownerKey} and generation=${source.generation}
          and transfer_id=${saga.transferId} and transfer_fence=${saga.fence}) source_ok,
        exists(select 1 from fuma_tenant_owner_keys where platform_id=${destination.platformId}
          and organization_id=${destination.organizationId} and workspace_id=${destination.workspaceId}
          and site_id=${destination.siteId} and owner_key=${destination.ownerKey} and generation=${destination.generation}
          and state='active') destination_ok
    `
    if (!result.rows[0]?.source_ok || !result.rows[0]?.destination_ok) {
      throw new TypeError('Domain outcome owner authority changed.')
    }
  }
}

/** External effects are intentionally credential-free; durable settings are the transfer receipt authority. */
export class PostgresDomainOutcomeEffects implements DomainOutcomeEffectPort {
  readonly #repository: Pick<PostgresDomainOperationsRepository, 'settings'>
  constructor(repository: Pick<PostgresDomainOperationsRepository, 'settings'>) { this.#repository = repository }
  async apply(_state: SiteTransferDomainState, _settings: CustomerDnsSettings, _saga: TransferSagaFence): Promise<void> {}
  async inspect(state: SiteTransferDomainState, _saga: TransferSagaFence): Promise<CustomerDnsSettings> {
    const scope = state.choice.outcome === 'move-with-site' ? state.choice.destination : state.choice.source
    const value = await this.#repository.settings(scope, state.choice.domainId)
    if (!value) throw new TypeError('Domain outcome settings are unavailable.')
    return value
  }
  async restore(_state: SiteTransferDomainState, _saga: TransferSagaFence): Promise<void> {}
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export class OciRegistrarAuthCodeDelivery implements RegistrarAuthCodeDeliveryPort {
  readonly #db: DbClient
  readonly #oci: OciEmailDeliveryProvider
  readonly #senderEmail: string
  constructor(input: Readonly<{ db: DbClient; oci: OciEmailDeliveryProvider; senderEmail: string }>) {
    this.#db = input.db
    this.#oci = input.oci
    this.#senderEmail = input.senderEmail
  }
  async deliver(hostname: string, authCode: Uint8Array, expiresAt: string, idempotencyKey: string): Promise<void> {
    const recipients = await this.#db<{ email: string }>`
      select distinct staff.email
      from fuma_domain_operation_settings_v2 settings
      join auth_members member on member.organization_id=settings.organization_id and member.role='owner'
      join auth_users staff on staff.id=member.user_id
      where settings.settings_json->>'hostname'=${hostname} and coalesce(staff.banned,false)=false
      order by staff.email limit 10
    `
    if (recipients.rows.length < 1) throw new TypeError('Registrar auth-code owner recipient is unavailable.')
    const code = new TextDecoder('utf-8', { fatal: true }).decode(authCode)
    if (code.length < 1 || code.length > 4096) throw new TypeError('Registrar auth code is invalid.')
    const safeHostname = escapeHtml(hostname)
    const safeCode = escapeHtml(code)
    for (const [index, recipient] of recipients.rows.entries()) {
      await this.#oci.submit({
        idempotencyKey: `${idempotencyKey}:${index}`,
        recipient: recipient.email,
        senderEmail: this.#senderEmail,
        senderName: 'Fuma domains',
        replyToEmail: this.#senderEmail,
        subject: `Transfer authorization for ${hostname}`,
        html: `<p>Your outbound registrar transfer for <strong>${safeHostname}</strong> is ready.</p><p>Authorization code: <code>${safeCode}</code></p><p>Expires: ${escapeHtml(expiresAt)}</p>`,
        text: `Outbound registrar transfer for ${hostname}\nAuthorization code: ${code}\nExpires: ${expiresAt}`,
        headers: Object.freeze({ 'X-Fuma-Purpose': 'registrar-transfer-auth-code' }),
      })
    }
  }
}
