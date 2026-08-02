import type { DbClient } from '../../db/client'
import type { DomainScope } from '../domains/contracts'
import type { TransferReceipt } from '../transfers/contracts'
import { CustomerDnsSettingsSchema, DomainOperationError, RegistrarTransferSchema, SiteTransferDomainChoiceSchema, SiteTransferDomainStateSchema, canonicalDomainOperation, parseDomainOperations, type CustomerDnsSettings, type RegistrarTransfer, type SiteTransferDomainChoice, type SiteTransferDomainState } from './contracts'
import type { DomainOperationsRepository } from './repository'

type JsonRow = Readonly<{ value_json: unknown }>
type ChoiceRow = Readonly<{ choice_json: unknown; source_settings_json: unknown; current_settings_json: unknown; applied_fence: number | string | null; apply_receipt_json: unknown; compensated_fence: number | string | null; compensation_receipt_json: unknown }>
const json = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value
const integer = (value: number | string | null): number | null => value === null ? null : Number(value)
const same = (left: unknown, right: unknown): boolean => canonicalDomainOperation(left) === canonicalDomainOperation(right)
const WHERE = `platform_id=$1 and organization_id=$2 and workspace_id=$3 and site_id=$4 and owner_key=$5 and owner_generation=$6 and owner_state=$7 and transfer_fence is not distinct from $8 and profile_id=$9`
const args = (scope: DomainScope): readonly unknown[] => [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, scope.state, scope.transferFence, scope.profileId]
function choiceState(row: ChoiceRow): SiteTransferDomainState {
  return parseDomainOperations(SiteTransferDomainStateSchema, {
    choice: json(row.choice_json), sourceSettings: json(row.source_settings_json), currentSettings: json(row.current_settings_json), automationCredentialMoved: false,
    appliedFence: integer(row.applied_fence), applyReceipt: json(row.apply_receipt_json), compensatedFence: integer(row.compensated_fence), compensationReceipt: json(row.compensation_receipt_json),
  }, 'Stored site-transfer domain state') as SiteTransferDomainState
}

export class PostgresDomainOperationsRepository implements DomainOperationsRepository {
  readonly #db: DbClient
  constructor(db: DbClient) { if (db.dialect !== 'postgres') throw new TypeError('Domain operations require PostgreSQL authority.'); this.#db = db }
  async settings(scope: DomainScope, domainId: string) {
    const result = await this.#db.unsafe<JsonRow>(`select settings_json value_json from fuma_domain_operation_settings_v2 where ${WHERE} and domain_id=$10`, [...args(scope), domainId])
    return result.rows[0] ? parseDomainOperations(CustomerDnsSettingsSchema, json(result.rows[0].value_json), 'Stored domain settings') as CustomerDnsSettings : null
  }
  async saveSettings(scope: DomainScope, value: CustomerDnsSettings, expectedVersion: number | null) {
    parseDomainOperations(CustomerDnsSettingsSchema, value, 'Domain settings')
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:domain-settings:${scope.platformId}:${scope.ownerKey}:${value.domainId}`},0))`
      const prior = await tx.unsafe<JsonRow>(`select settings_json value_json from fuma_domain_operation_settings_v2 where ${WHERE} and domain_id=$10 for update`, [...args(scope), value.domainId])
      if (prior.rows[0]) {
        const stored = parseDomainOperations(CustomerDnsSettingsSchema, json(prior.rows[0].value_json), 'Stored domain settings') as CustomerDnsSettings
        if (expectedVersion === null && same(stored, value)) return stored
        if (stored.version !== expectedVersion) throw new DomainOperationError('conflict', 'Domain settings version is stale.')
        const updated = await tx.unsafe(`update fuma_domain_operation_settings_v2 set settings_json=$11::jsonb,version=$12,operation_fence=$13,updated_at=$14 where ${WHERE} and domain_id=$10 and version=$15`, [...args(scope), value.domainId, JSON.stringify(value), value.version, value.operationFence, value.updatedAt, expectedVersion])
        if (updated.rowCount !== 1) throw new DomainOperationError('conflict', 'Domain settings changed concurrently.')
      } else {
        if (expectedVersion !== null) throw new DomainOperationError('conflict', 'Domain settings do not exist at the expected version.')
        await tx.unsafe(`insert into fuma_domain_operation_settings_v2(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,owner_state,transfer_fence,profile_id,domain_id,settings_json,version,operation_fence,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`, [...args(scope), value.domainId, JSON.stringify(value), value.version, value.operationFence, value.updatedAt])
      }
      return structuredClone(value)
    })
  }
  async registrarTransfer(scope: DomainScope, id: string) {
    const result = await this.#db.unsafe<JsonRow>(`select transfer_json value_json from fuma_registrar_transfer_authority_v2 where ${WHERE} and transfer_operation_id=$10`, [...args(scope), id])
    return result.rows[0] ? parseDomainOperations(RegistrarTransferSchema, json(result.rows[0].value_json), 'Stored registrar transfer') as RegistrarTransfer : null
  }
  async activeRegistrarTransfer(scope: DomainScope, domainId: string) {
    const result = await this.#db.unsafe<JsonRow>(`select transfer_json value_json from fuma_registrar_transfer_authority_v2 where ${WHERE} and domain_id=$10 and state in ('requested','awaiting-unlock','awaiting-auth-code','submitted','rolling-back') order by updated_at desc limit 2`, [...args(scope), domainId])
    if (result.rows.length > 1) throw new DomainOperationError('conflict', 'Multiple active registrar transfers exist for one domain.')
    return result.rows[0] ? parseDomainOperations(RegistrarTransferSchema, json(result.rows[0].value_json), 'Stored active registrar transfer') as RegistrarTransfer : null
  }
  async saveRegistrarTransfer(scope: DomainScope, value: RegistrarTransfer, expectedVersion: number | null) {
    parseDomainOperations(RegistrarTransferSchema, value, 'Registrar transfer')
    return this.#db.transaction(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`fuma:registrar-transfer:${value.transferOperationId}`},0))`
      const prior = await tx<JsonRow>`select transfer_json value_json from fuma_registrar_transfer_authority_v2 where transfer_operation_id=${value.transferOperationId} for update`
      if (prior.rows[0]) {
        const stored = parseDomainOperations(RegistrarTransferSchema, json(prior.rows[0].value_json), 'Stored registrar transfer') as RegistrarTransfer
        if (expectedVersion === null && stored.operationSha256 === value.operationSha256) return stored
        if (stored.version !== expectedVersion || !same(args(scope), args(stored))) throw new DomainOperationError('conflict', 'Registrar transfer authority changed.')
        const updated = await tx.unsafe(`update fuma_registrar_transfer_authority_v2 set state=$2,transfer_json=$3::jsonb,version=$4,fence=$5,operation_sha256=$6,updated_at=$7 where transfer_operation_id=$1 and version=$8`, [value.transferOperationId,value.lifecycle,JSON.stringify(value),value.version,value.fence,value.operationSha256,value.updatedAt,expectedVersion])
        if (updated.rowCount !== 1) throw new DomainOperationError('conflict', 'Registrar transfer changed concurrently.')
      } else {
        if (expectedVersion !== null) throw new DomainOperationError('conflict', 'Registrar transfer does not exist at the expected version.')
        await tx.unsafe(`insert into fuma_registrar_transfer_authority_v2(transfer_operation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,owner_state,transfer_fence,profile_id,domain_id,hostname,direction,state,transfer_json,version,fence,operation_sha256,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20)`, [value.transferOperationId,...args(scope),value.domainId,value.hostname,value.direction,value.lifecycle,JSON.stringify(value),value.version,value.fence,value.operationSha256,value.createdAt,value.updatedAt])
      }
      return structuredClone(value)
    })
  }
  async recordDomainChoice(choice: SiteTransferDomainChoice, settings: CustomerDnsSettings) {
    parseDomainOperations(SiteTransferDomainChoiceSchema, choice, 'Site-transfer domain choice')
    await this.#db.unsafe(`insert into fuma_site_transfer_domain_choices_v2(transfer_id,domain_id,choice_json,source_settings_json,current_settings_json,decided_at) values($1,$2,$3::jsonb,$4::jsonb,$4::jsonb,$5) on conflict(transfer_id,domain_id) do nothing`, [choice.transferId,choice.domainId,JSON.stringify(choice),JSON.stringify(settings),choice.decidedAt])
    const state = await this.domainChoice(choice.transferId, choice.domainId)
    if (!state || !same(state.choice, choice)) throw new DomainOperationError('conflict', 'Site-transfer domain choice changed on replay.')
    return state
  }
  async domainChoice(transferId: string, domainId?: string) {
    const result = domainId
      ? await this.#db.unsafe<ChoiceRow>('select * from fuma_site_transfer_domain_choices_v2 where transfer_id=$1 and domain_id=$2', [transferId,domainId])
      : await this.#db.unsafe<ChoiceRow>('select * from fuma_site_transfer_domain_choices_v2 where transfer_id=$1 order by domain_id limit 2', [transferId])
    if (!domainId && result.rows.length !== 1) return null
    return result.rows[0] ? choiceState(result.rows[0]) : null
  }
  async applyDomainChoice(transferId: string, domainId: string, fence: number, settings: CustomerDnsSettings, receipt: TransferReceipt) { return this.#updateChoice('apply',transferId,domainId,fence,settings,receipt) }
  async compensateDomainChoice(transferId: string, domainId: string, fence: number, settings: CustomerDnsSettings, receipt: TransferReceipt) { return this.#updateChoice('compensate',transferId,domainId,fence,settings,receipt) }
  async #updateChoice(kind: 'apply'|'compensate', transferId: string, domainId: string, fence: number, settings: CustomerDnsSettings, receipt: TransferReceipt) {
    return this.#db.transaction(async (tx) => {
      const result = await tx.unsafe<ChoiceRow>('select * from fuma_site_transfer_domain_choices_v2 where transfer_id=$1 and domain_id=$2 for update', [transferId,domainId])
      if (!result.rows[0]) throw new DomainOperationError('not-found', 'Site-transfer domain choice is missing.')
      const prior = choiceState(result.rows[0])
      if (kind === 'apply' && prior.appliedFence !== null) { if (prior.appliedFence !== fence || !same(prior.applyReceipt,receipt)) throw new DomainOperationError('conflict','Domain apply receipt changed.'); return prior }
      if (kind === 'compensate' && prior.appliedFence !== fence) throw new DomainOperationError('conflict','Domain compensation is stale.')
      const columns = kind === 'apply' ? 'current_settings_json=$4::jsonb,applied_fence=$3,apply_receipt_json=$5::jsonb' : 'current_settings_json=$4::jsonb,compensated_fence=$3,compensation_receipt_json=$5::jsonb'
      await tx.unsafe(`update fuma_site_transfer_domain_choices_v2 set ${columns} where transfer_id=$1 and domain_id=$2`, [transferId,domainId,fence,JSON.stringify(settings),JSON.stringify(receipt)])
      const after = await tx.unsafe<ChoiceRow>('select * from fuma_site_transfer_domain_choices_v2 where transfer_id=$1 and domain_id=$2', [transferId,domainId])
      return choiceState(after.rows[0]!)
    })
  }
}
