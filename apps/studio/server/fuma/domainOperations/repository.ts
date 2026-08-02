import type { DomainScope } from '../domains/contracts'
import type { TransferReceipt } from '../transfers/contracts'
import { canonicalDomainOperation, DomainOperationError, type CustomerDnsSettings, type RegistrarTransfer, type SiteTransferDomainChoice, type SiteTransferDomainState } from './contracts'

export interface DomainOperationsRepository {
  settings(scope: DomainScope, domainId: string): Promise<CustomerDnsSettings | null>
  saveSettings(scope: DomainScope, settings: CustomerDnsSettings, expectedVersion: number | null): Promise<CustomerDnsSettings>
  registrarTransfer(scope: DomainScope, id: string): Promise<RegistrarTransfer | null>
  activeRegistrarTransfer(scope: DomainScope, domainId: string): Promise<RegistrarTransfer | null>
  saveRegistrarTransfer(scope: DomainScope, value: RegistrarTransfer, expectedVersion: number | null): Promise<RegistrarTransfer>
  recordDomainChoice(choice: SiteTransferDomainChoice, settings: CustomerDnsSettings): Promise<SiteTransferDomainState>
  domainChoice(transferId: string, domainId?: string): Promise<SiteTransferDomainState | null>
  applyDomainChoice(transferId: string, domainId: string, fence: number, settings: CustomerDnsSettings, receipt: TransferReceipt): Promise<SiteTransferDomainState>
  compensateDomainChoice(transferId: string, domainId: string, fence: number, settings: CustomerDnsSettings, receipt: TransferReceipt): Promise<SiteTransferDomainState>
}

const scopeKey = (scope: DomainScope): string => [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, scope.state, scope.transferFence ?? '-', scope.profileId].join(':')
const clone = <T>(value: T): T => structuredClone(value)
const same = (left: unknown, right: unknown): boolean => canonicalDomainOperation(left) === canonicalDomainOperation(right)

/** Serialized deterministic authority used only by focused tests and demos. */
export class MemoryDomainOperationsRepository implements DomainOperationsRepository {
  readonly #settings = new Map<string, CustomerDnsSettings>()
  readonly #transfers = new Map<string, RegistrarTransfer>()
  readonly #choices = new Map<string, SiteTransferDomainState>()
  #queue: Promise<void> = Promise.resolve()
  async #serial<T>(work: () => T | Promise<T>): Promise<T> {
    const prior = this.#queue
    let release!: () => void
    this.#queue = new Promise<void>((resolve) => { release = resolve })
    await prior
    try { return await work() } finally { release() }
  }
  async settings(scope: DomainScope, domainId: string) { return clone(this.#settings.get(`${scopeKey(scope)}:${domainId}`) ?? null) }
  async saveSettings(scope: DomainScope, settings: CustomerDnsSettings, expectedVersion: number | null) {
    return this.#serial(() => {
      const key = `${scopeKey(scope)}:${settings.domainId}`
      const prior = this.#settings.get(key)
      if (prior && expectedVersion === null && same(prior, settings)) return clone(prior)
      if ((prior?.version ?? null) !== expectedVersion) throw new DomainOperationError('conflict', 'Domain settings version is stale.')
      this.#settings.set(key, clone(settings)); return clone(settings)
    })
  }
  async registrarTransfer(scope: DomainScope, id: string) { return clone(this.#transfers.get(`${scopeKey(scope)}:${id}`) ?? null) }
  async activeRegistrarTransfer(scope: DomainScope, domainId: string) {
    const prefix = `${scopeKey(scope)}:`
    const active = [...this.#transfers.entries()].filter(([key, value]) => key.startsWith(prefix) && value.domainId === domainId && ['requested','awaiting-unlock','awaiting-auth-code','submitted','rolling-back'].includes(value.lifecycle)).map(([, value]) => value)
    if (active.length > 1) throw new DomainOperationError('conflict', 'Multiple active registrar transfers exist for one domain.')
    return clone(active[0] ?? null)
  }
  async saveRegistrarTransfer(scope: DomainScope, value: RegistrarTransfer, expectedVersion: number | null) {
    return this.#serial(() => {
      const key = `${scopeKey(scope)}:${value.transferOperationId}`
      const prior = this.#transfers.get(key)
      if (prior && expectedVersion === null && prior.operationSha256 === value.operationSha256) return clone(prior)
      if ((prior?.version ?? null) !== expectedVersion) throw new DomainOperationError('conflict', 'Registrar transfer fence is stale.')
      this.#transfers.set(key, clone(value)); return clone(value)
    })
  }
  async recordDomainChoice(choice: SiteTransferDomainChoice, settings: CustomerDnsSettings) {
    return this.#serial(() => {
      const key = `${choice.transferId}:${choice.domainId}`
      const prior = this.#choices.get(key)
      if (prior) {
        if (!same(prior.choice, choice)) throw new DomainOperationError('conflict', 'Site-transfer domain choice changed on replay.')
        return clone(prior)
      }
      const state: SiteTransferDomainState = { choice: clone(choice), sourceSettings: clone(settings), currentSettings: clone(settings), automationCredentialMoved: false, appliedFence: null, applyReceipt: null, compensatedFence: null, compensationReceipt: null }
      this.#choices.set(key, state); return clone(state)
    })
  }
  async domainChoice(transferId: string, domainId?: string) {
    if (domainId) return clone(this.#choices.get(`${transferId}:${domainId}`) ?? null)
    const matches = [...this.#choices.entries()].filter(([key]) => key.startsWith(`${transferId}:`))
    if (matches.length !== 1) return null
    return clone(matches[0][1])
  }
  async applyDomainChoice(transferId: string, domainId: string, fence: number, settings: CustomerDnsSettings, receipt: TransferReceipt) {
    return this.#serial(() => {
      const key = `${transferId}:${domainId}`; const prior = this.#choices.get(key)
      if (!prior) throw new DomainOperationError('not-found', 'Site-transfer domain choice is missing.')
      if (prior.appliedFence !== null) {
        if (prior.appliedFence !== fence || !same(prior.applyReceipt, receipt)) throw new DomainOperationError('conflict', 'Site-transfer domain receipt changed.')
        return clone(prior)
      }
      const next: SiteTransferDomainState = { ...prior, currentSettings: clone(settings), automationCredentialMoved: false, appliedFence: fence, applyReceipt: clone(receipt) }
      this.#choices.set(key, next); return clone(next)
    })
  }
  async compensateDomainChoice(transferId: string, domainId: string, fence: number, settings: CustomerDnsSettings, receipt: TransferReceipt) {
    return this.#serial(() => {
      const key = `${transferId}:${domainId}`; const prior = this.#choices.get(key)
      if (!prior || prior.appliedFence !== fence) throw new DomainOperationError('conflict', 'Domain compensation is stale or unapplied.')
      if (prior.compensatedFence !== null) return clone(prior)
      const next: SiteTransferDomainState = { ...prior, currentSettings: clone(settings), compensatedFence: fence, compensationReceipt: clone(receipt) }
      this.#choices.set(key, next); return clone(next)
    })
  }
}
