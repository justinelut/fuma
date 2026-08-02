import type { EntitlementService } from '../entitlements'
import type { MeteringService } from '../metering'
import type { QuotaService } from '../quotas'
import type { CreateDomainCommand, DomainScope } from './contracts'
import { DomainError, type DomainCommercialAuthority } from './service'

function reservationKey(scope: DomainScope, command: CreateDomainCommand): string {
  return [
    'fuma-domain-create-v1', scope.platformId, scope.organizationId, scope.workspaceId,
    scope.siteId, scope.ownerKey, scope.generation, scope.profileId, command.domainId,
  ].join(':')
}

/**
 * Exact FUMA-054/FUMA-057/FUMA-052 adapter. Admission reserves one pooled custom
 * domain, commit settles it and writes one immutable custom_hostnames meter row.
 */
export class DomainCommercialIntegration implements DomainCommercialAuthority {
  readonly #entitlements: Pick<EntitlementService, 'evaluate'>
  readonly #quotas: Pick<QuotaService, 'admit' | 'settleReservation' | 'releaseReservation'>
  readonly #metering: Pick<MeteringService, 'adjust'>

  constructor(input: Readonly<{
    entitlements: Pick<EntitlementService, 'evaluate'>
    quotas: Pick<QuotaService, 'admit' | 'settleReservation' | 'releaseReservation'>
    metering: Pick<MeteringService, 'adjust'>
  }>) {
    this.#entitlements = input.entitlements
    this.#quotas = input.quotas
    this.#metering = input.metering
  }

  async admitCreate(scope: DomainScope, command: CreateDomainCommand): Promise<void> {
    const entitlement = await this.#entitlements.evaluate(scope.organizationId)
    if (!entitlement.quotas || entitlement.quotas.customDomains < 1 || entitlement.source === 'none') {
      throw new DomainError('scope', 'Current entitlement does not authorize a custom hostname.')
    }
    await this.#quotas.admit({
      idempotencyKey: reservationKey(scope, command),
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      siteId: scope.siteId,
      quotaClass: 'customDomains',
      units: 1,
      operation: 'domain',
    })
  }

  async commitCreate(scope: DomainScope, command: CreateDomainCommand): Promise<void> {
    const idempotencyKey = reservationKey(scope, command)
    await this.#quotas.settleReservation({
      idempotencyKey,
      actual: [{ quotaClass: 'customDomains', units: 1 }],
    })
    const entitlement = await this.#entitlements.evaluate(scope.organizationId)
    await this.#metering.adjust({
      idempotencyKey: `${idempotencyKey}:meter`,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      siteId: scope.siteId,
      meter: 'custom_hostnames',
      logicalUnits: 1,
      physicalUnits: 1,
      occurredAt: command.requestedAt,
      internalWorkload: entitlement.source === 'platform-internal',
    })
  }

  async releaseCreate(scope: DomainScope, command: CreateDomainCommand): Promise<void> {
    await this.#quotas.releaseReservation(reservationKey(scope, command))
  }
}
