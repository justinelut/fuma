import type { DbClient } from '../../db/client'
import { PLATFORM_ORGANIZATION_ID } from '../organizations/contracts'
import {
  type EntitlementAdminAuthority,
  type EntitlementAdminCommand,
  type EntitlementAdminEvent,
  type EntitlementAdminMutationReceipt,
  type EntitlementAdminWorkspace,
} from './adminContracts'
import { PostgresEntitlementAdminRepository } from './adminPostgres'
import type { EntitlementService } from './service'

const auditAction = Object.freeze({
  'publish-price-book': 'entitlement.price-book.published',
  'issue-offer': 'entitlement.offer.issued',
  'ensure-internal-grant': 'entitlement.internal-grant.created',
  'save-adjustment': 'entitlement.adjustment.saved',
  'withdraw-offer': 'entitlement.offer.withdrawn',
  'expire-offer': 'entitlement.offer.expired',
  'assign-grandfathered': 'entitlement.grandfathered.assigned',
} satisfies Readonly<Record<EntitlementAdminCommand['kind'], EntitlementAdminEvent['action']>>)

export class EntitlementAdminService {
  readonly #db: DbClient
  readonly #entitlementsFor: (db: DbClient) => EntitlementService
  readonly #repository: PostgresEntitlementAdminRepository
  readonly #now: () => Date

  constructor(input: Readonly<{
    db: DbClient
    entitlementsFor: (db: DbClient) => EntitlementService
    repository?: PostgresEntitlementAdminRepository
    now?: () => Date
  }>) {
    this.#db = input.db
    this.#entitlementsFor = input.entitlementsFor
    this.#now = input.now ?? (() => new Date())
    this.#repository = input.repository ?? new PostgresEntitlementAdminRepository(input.db, this.#now)
  }

  async workspace(): Promise<EntitlementAdminWorkspace> { return await this.#repository.workspace() }

  async execute(command: EntitlementAdminCommand, authority: EntitlementAdminAuthority): Promise<EntitlementAdminMutationReceipt> {
    return await this.#db.transaction(async (tx) => {
      const entitlements = this.#entitlementsFor(tx)
      const audit = new PostgresEntitlementAdminRepository(tx, this.#now)
      let resourceId: string
      let resourceVersion: number | null = null
      let state: string
      switch (command.kind) {
        case 'publish-price-book': {
          const book = await entitlements.publishPriceBook(command.draft)
          resourceId = book.version; state = 'published'; break
        }
        case 'issue-offer': {
          const issued = await entitlements.issue(await entitlements.propose(command.draft))
          resourceId = issued.offerId; resourceVersion = issued.version; state = issued.state; break
        }
        case 'ensure-internal-grant': {
          const grant = await entitlements.ensureInternalGrant(PLATFORM_ORGANIZATION_ID, command.quotas)
          resourceId = grant.grantId; state = 'active'; break
        }
        case 'save-adjustment': {
          const adjustment = await entitlements.saveAdjustment({ ...command.adjustment, approvedBy: authority.actorId })
          resourceId = adjustment.adjustmentId; state = adjustment.state; break
        }
        case 'withdraw-offer': {
          const offer = await entitlements.withdraw(command.offerId, command.version)
          resourceId = offer.offerId; resourceVersion = offer.version; state = offer.state; break
        }
        case 'expire-offer': {
          const offer = await entitlements.expire(command.offerId, command.version)
          resourceId = offer.offerId; resourceVersion = offer.version; state = offer.state; break
        }
        case 'assign-grandfathered': {
          const assignment = await entitlements.assignGrandfathered(command.assignment)
          resourceId = assignment.assignmentId; state = 'active'; break
        }
      }
      await audit.audit({
        authority, requestId: command.requestId, action: auditAction[command.kind], targetId: resourceId,
      })
      return Object.freeze({ requestId: command.requestId, operation: command.kind, resourceId, resourceVersion, state })
    })
  }
}
