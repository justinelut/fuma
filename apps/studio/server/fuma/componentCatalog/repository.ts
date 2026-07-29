import type {
  ComponentCatalogAuditFact,
  ComponentCatalogRelease,
  ComponentCatalogScope,
  ComponentInstallation,
  ComponentSourceDraftRecord,
  ComponentUpgradeReceipt,
  ComponentUsage,
} from './contracts'

export interface ComponentCatalogRepository {
  putRelease(release: ComponentCatalogRelease): Promise<'inserted' | 'replay' | 'conflict'>
  release(scope: ComponentCatalogScope, coordinate: string): Promise<ComponentCatalogRelease | null>
  listReleases(scope: ComponentCatalogScope): Promise<readonly ComponentCatalogRelease[]>
  putDraft(draft: ComponentSourceDraftRecord): Promise<'inserted' | 'replay' | 'conflict'>
  draft(scope: ComponentCatalogScope, draftId: string): Promise<ComponentSourceDraftRecord | null>
  confirmDraft(scope: ComponentCatalogScope, draftId: string, at: string): Promise<boolean>
  putInstallation(installation: ComponentInstallation, expectedVersion: number | null): Promise<boolean>
  installation(scope: ComponentCatalogScope, installationId: string): Promise<ComponentInstallation | null>
  listInstallations(scope: ComponentCatalogScope): Promise<readonly ComponentInstallation[]>
  removeInstallation(scope: ComponentCatalogScope, installationId: string, expectedVersion: number): Promise<boolean>
  putUsage(usage: ComponentUsage): Promise<'inserted' | 'replay' | 'conflict'>
  listUsage(scope: ComponentCatalogScope, coordinate?: string): Promise<readonly ComponentUsage[]>
  putUpgradeReceipt(receipt: ComponentUpgradeReceipt): Promise<'inserted' | 'replay' | 'conflict'>
  appendAudit(fact: ComponentCatalogAuditFact): Promise<void>
}

export class ComponentCatalogRepositoryError extends Error {
  override readonly name = 'ComponentCatalogRepositoryError'
  readonly code: 'conflict' | 'not-found'
  constructor(code: 'conflict' | 'not-found', message: string) { super(message); this.code = code }
}
