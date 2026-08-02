import { canonicalJson } from '../../../../../tooling/component-packs/contracts'
import type {
  ComponentCatalogAuditFact,
  ComponentCatalogRelease,
  ComponentCatalogScope,
  ComponentInstallation,
  ComponentSourceDraftRecord,
  ComponentUpgradeReceipt,
  ComponentUsage,
} from './contracts'
import { sameComponentScope } from './contracts'
import type { ComponentCatalogRepository } from './repository'

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const scopeKey = (scope: ComponentCatalogScope) => [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.ownerGeneration, scope.profileId].join('\u0000')
const key = (scope: ComponentCatalogScope, id: string) => `${scopeKey(scope)}\u0000${id}`

export class MemoryComponentCatalogRepository implements ComponentCatalogRepository {
  readonly releases = new Map<string, ComponentCatalogRelease>()
  readonly drafts = new Map<string, ComponentSourceDraftRecord>()
  readonly installations = new Map<string, ComponentInstallation>()
  readonly usages = new Map<string, ComponentUsage>()
  readonly upgrades = new Map<string, ComponentUpgradeReceipt>()
  readonly audits: ComponentCatalogAuditFact[] = []

  async putRelease(value: ComponentCatalogRelease) { const k = key(value.scope, value.coordinate); const prior = this.releases.get(k); if (prior) return same(prior, value) ? 'replay' as const : 'conflict' as const; this.releases.set(k, structuredClone(value)); return 'inserted' as const }
  async release(scope: ComponentCatalogScope, coordinate: string) { const value = this.releases.get(key(scope, coordinate)); return value ? structuredClone(value) : null }
  async listReleases(scope: ComponentCatalogScope) { return [...this.releases.values()].filter((item) => sameComponentScope(item.scope, scope)).map((item) => structuredClone(item)) }
  async putDraft(value: ComponentSourceDraftRecord) { const k = key(value.scope, value.draft.draftId); const prior = this.drafts.get(k); if (prior) return same(prior, value) ? 'replay' as const : 'conflict' as const; this.drafts.set(k, structuredClone(value)); return 'inserted' as const }
  async draft(scope: ComponentCatalogScope, draftId: string) { const value = this.drafts.get(key(scope, draftId)); return value ? structuredClone(value) : null }
  async confirmDraft(scope: ComponentCatalogScope, draftId: string, at: string) { const k = key(scope, draftId); const prior = this.drafts.get(k); if (!prior || prior.state !== 'validated') return false; this.drafts.set(k, { ...prior, state: 'confirmed', confirmedAt: at }); return true }
  async putInstallation(value: ComponentInstallation, expectedVersion: number | null) { const k = key(value.scope, value.installationId); const prior = this.installations.get(k); if (expectedVersion === null) { if (prior) return same(prior, value); this.installations.set(k, structuredClone(value)); return true } if (!prior || prior.version !== expectedVersion) return false; this.installations.set(k, structuredClone(value)); return true }
  async installation(scope: ComponentCatalogScope, installationId: string) { const value = this.installations.get(key(scope, installationId)); return value ? structuredClone(value) : null }
  async listInstallations(scope: ComponentCatalogScope) { return [...this.installations.values()].filter((item) => sameComponentScope(item.scope, scope)).map((item) => structuredClone(item)) }
  async removeInstallation(scope: ComponentCatalogScope, installationId: string, expectedVersion: number) { const k = key(scope, installationId); const prior = this.installations.get(k); if (!prior || prior.version !== expectedVersion) return false; this.installations.delete(k); return true }
  async putUsage(value: ComponentUsage) { const k = key(value.scope, value.usageId); const prior = this.usages.get(k); if (prior) return same(prior, value) ? 'replay' as const : 'conflict' as const; this.usages.set(k, structuredClone(value)); return 'inserted' as const }
  async listUsage(scope: ComponentCatalogScope, coordinate?: string) { return [...this.usages.values()].filter((item) => sameComponentScope(item.scope, scope) && (!coordinate || item.coordinate === coordinate)).map((item) => structuredClone(item)) }
  async putUpgradeReceipt(value: ComponentUpgradeReceipt) { const k = key(value.scope, value.receiptId); const prior = this.upgrades.get(k); if (prior) return same(prior, value) ? 'replay' as const : 'conflict' as const; this.upgrades.set(k, structuredClone(value)); return 'inserted' as const }
  async appendAudit(value: ComponentCatalogAuditFact) { if (this.audits.some((item) => item.auditId === value.auditId)) throw new Error('Duplicate component audit identity.'); this.audits.push(structuredClone(value)) }
}
