import { CapabilityOverridesSchema } from '@core/fuma'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import {
  type TransferCollaboratorIntent,
  TransferCollaboratorIntentSchema,
  type TransferCollaboratorState,
  type TransferManifest,
  TransferManifestSchema,
  assertTransferManifest,
} from './contracts'
import {
  type BaseOwnershipAdapter,
  type BaseOwnershipAtomicResult,
  type BaseOwnershipInspection,
  type BaseOwnershipOperationInput,
  type BaseOwnershipSite,
  type BaseOwnershipWorkspace,
  type CapturedCollaboratorIntent,
  createBaseOwnershipReceipt,
  sameOwnershipCoordinate,
  sameTransferValue,
} from './baseOwnershipStep'

interface ProposalRow {
  manifest_json: unknown
}

interface LockRow {
  id: string
}

interface WorkspaceRow {
  organization_id: string
  id: string
  status: string
}

interface SiteRow {
  organization_id: string
  workspace_id: string
  id: string
  profile_id: string
  capability_overrides_json: unknown
}

interface OwnerKeyRow {
  owner_key: string
  organization_id: string
  workspace_id: string
  site_id: string
  state: string
  generation: number | bigint
  transfer_id: string | null
  transfer_lock_id: string | null
  transfer_fence: number | bigint | null
}

interface CollaboratorIntentRow {
  user_id: string
  source_role: string
  intent: string
  destination_role: string | null
  state: string
}

type OwnerKeyInspection = Readonly<{
  ownerKey: string
  coordinate: TransferManifest['source']
  state: 'active' | 'transferring'
  generation: number
  transferId: string | null
  transferLockId: string | null
  transferFence: number | null
}>

type LockedBaseOwnershipInspection = Readonly<{
  inspection: BaseOwnershipInspection
  ownerKeys: readonly OwnerKeyInspection[]
}>

function storedManifest(row: ProposalRow | undefined): TransferManifest | null {
  if (!row) return null
  const parsed = safeParseValue(TransferManifestSchema, row.manifest_json)
  if (!parsed.ok) throw new Error('Stored transfer manifest failed schema validation.')
  assertTransferManifest(parsed.value)
  return parsed.value
}

function storedWorkspace(
  row: WorkspaceRow | undefined,
  platformId: string,
): BaseOwnershipWorkspace | null {
  if (!row) return null
  if (row.status !== 'active' && row.status !== 'archived') {
    throw new Error('Stored destination workspace status failed schema validation.')
  }
  return {
    platformId,
    organizationId: row.organization_id,
    workspaceId: row.id,
    status: row.status,
  }
}

function safePositiveInteger(value: number | bigint, field: string): number {
  const numeric = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    throw new Error(`Stored tenant owner-key ${field} is invalid.`)
  }
  return numeric
}

function storedOwnerKey(
  row: OwnerKeyRow,
  platformId: string,
): OwnerKeyInspection {
  if (row.state !== 'active' && row.state !== 'transferring') {
    throw new Error(`Stored tenant owner-key state for ${row.owner_key} is invalid.`)
  }
  const transferFence = row.transfer_fence === null
    ? null
    : safePositiveInteger(row.transfer_fence, 'transfer fence')
  const activeShape = row.state === 'active'
    && row.transfer_id === null
    && row.transfer_lock_id === null
    && transferFence === null
  const transferringShape = row.state === 'transferring'
    && row.transfer_id !== null
    && row.transfer_lock_id !== null
    && transferFence !== null
  if (!activeShape && !transferringShape) {
    throw new Error(`Stored tenant owner-key transfer shape for ${row.owner_key} is invalid.`)
  }
  return {
    ownerKey: row.owner_key,
    coordinate: {
      platformId,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
    },
    state: row.state,
    generation: safePositiveInteger(row.generation, 'generation'),
    transferId: row.transfer_id,
    transferLockId: row.transfer_lock_id,
    transferFence,
  }
}

function ownerCarriesReceipt(
  ownerKey: OwnerKeyInspection | undefined,
  input: BaseOwnershipOperationInput,
): boolean {
  return ownerKey !== undefined
    && ownerKey.state === 'transferring'
    && sameOwnershipCoordinate(ownerKey.coordinate, input.manifest.destination)
    && ownerKey.transferId === input.saga.transferId
    && ownerKey.transferLockId === input.saga.lockId
    && ownerKey.transferFence === input.saga.fence
}

function storedSite(
  row: SiteRow,
  input: BaseOwnershipOperationInput,
  ownerKey: OwnerKeyInspection | undefined,
): BaseOwnershipSite {
  const overrides = safeParseValue(CapabilityOverridesSchema, row.capability_overrides_json)
  if (!overrides.ok) {
    throw new Error(`Stored capability overrides for site ${row.id} failed schema validation.`)
  }
  const coordinate = {
    platformId: input.manifest.source.platformId,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.id,
  }
  return {
    coordinate,
    profileId: row.profile_id,
    capabilityOverrides: overrides.value,
    ownershipReceipt: ownerCarriesReceipt(ownerKey, input)
      ? createBaseOwnershipReceipt(input.manifest, input.saga)
      : null,
  }
}

function storedCollaboratorState(userId: string, value: string): TransferCollaboratorState {
  if (value === 'pending'
    || value === 'applying'
    || value === 'applied'
    || value === 'skipped'
    || value === 'failed') {
    return value
  }
  throw new Error(`Stored collaborator intent state for user ${userId} is invalid.`)
}

function storedCollaboratorIntent(row: CollaboratorIntentRow): CapturedCollaboratorIntent {
  const collaborator = safeParseValue(TransferCollaboratorIntentSchema, {
    userId: row.user_id,
    sourceRole: row.source_role,
    intent: row.intent,
    destinationRole: row.destination_role,
  })
  if (!collaborator.ok) {
    throw new Error(`Stored collaborator intent for user ${row.user_id} failed schema validation.`)
  }
  return {
    collaborator: collaborator.value,
    state: storedCollaboratorState(row.user_id, row.state),
  }
}

function expectedIntents(
  collaborators: readonly TransferCollaboratorIntent[],
): readonly CapturedCollaboratorIntent[] {
  return collaborators
    .map((collaborator) => ({ collaborator, state: 'pending' as const }))
    .toSorted((left, right) => left.collaborator.userId.localeCompare(right.collaborator.userId))
}

function exactPendingIntents(
  actual: readonly CapturedCollaboratorIntent[],
  expected: readonly TransferCollaboratorIntent[],
): boolean {
  const sorted = actual.toSorted((left, right) => (
    left.collaborator.userId.localeCompare(right.collaborator.userId)
  ))
  return sameTransferValue(sorted, expectedIntents(expected))
}

function atomicResult(
  status: BaseOwnershipAtomicResult['status'],
  inspection: BaseOwnershipInspection,
): BaseOwnershipAtomicResult {
  return { status, inspection }
}

function validateOperation(input: BaseOwnershipOperationInput): void {
  assertTransferManifest(input.manifest)
  if (input.saga.transferId !== input.manifest.transferId
    || !input.saga.lockId
    || !Number.isSafeInteger(input.saga.fence)
    || input.saga.fence < 1) {
    throw new Error('Base ownership operation uses an invalid saga fence.')
  }
}

function ownerForCurrentSite(
  locked: LockedBaseOwnershipInspection,
): OwnerKeyInspection | null {
  const site = locked.inspection.sites[0]
  if (!site) return null
  const matches = locked.ownerKeys.filter((ownerKey) => (
    sameOwnershipCoordinate(ownerKey.coordinate, site.coordinate)
  ))
  return matches.length === 1 && locked.ownerKeys.length === locked.inspection.sites.length
    ? matches[0] ?? null
    : null
}

function commonConflict(
  locked: LockedBaseOwnershipInspection,
  input: BaseOwnershipOperationInput,
  requireActiveDestination: boolean,
): BaseOwnershipAtomicResult['status'] | null {
  const inspection = locked.inspection
  if (!inspection.proposalMatches) return 'ancestry-conflict'
  if (!inspection.fenceMatches) return 'stale-fence'
  const workspace = inspection.destinationWorkspace
  if (!workspace
    || workspace.platformId !== input.manifest.destination.platformId
    || workspace.organizationId !== input.manifest.destination.organizationId
    || workspace.workspaceId !== input.manifest.destination.workspaceId
    || (requireActiveDestination && workspace.status !== 'active')) {
    return 'ancestry-conflict'
  }
  if (inspection.sites.length !== 1) return 'ownership-conflict'
  const site = inspection.sites[0]
  if (!site
    || site.profileId !== input.manifest.siteProfileId
    || !sameTransferValue(site.capabilityOverrides, input.manifest.siteCapabilityOverrides)) {
    return 'ownership-conflict'
  }
  const ownerKey = ownerForCurrentSite(locked)
  if (!ownerKey) return 'ownership-conflict'
  if (ownerKey.state === 'transferring'
    && ownerKey.transferId === input.saga.transferId
    && (ownerKey.transferLockId !== input.saga.lockId
      || ownerKey.transferFence !== input.saga.fence)) {
    return 'stale-fence'
  }
  return null
}

function exactTransferFence(
  ownerKey: OwnerKeyInspection,
  input: BaseOwnershipOperationInput,
): boolean {
  return ownerKey.state === 'transferring'
    && ownerKey.transferId === input.saga.transferId
    && ownerKey.transferLockId === input.saga.lockId
    && ownerKey.transferFence === input.saga.fence
}

/** PostgreSQL authority for atomic FUMA-024 site, owner-key, and intent transfer. */
export class PostgresBaseOwnershipAdapter implements BaseOwnershipAdapter {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') {
      throw new Error('Fuma base ownership transfers require PostgreSQL authority.')
    }
    this.#db = db
  }

  inspectBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipInspection> {
    validateOperation(input)
    return this.#db.transaction(async (db) => (await this.#inspect(db, input)).inspection)
  }

  publishBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipAtomicResult> {
    validateOperation(input)
    return this.#db.transaction(async (db) => {
      const before = await this.#inspect(db, input)
      const conflict = commonConflict(before, input, true)
      if (conflict) return atomicResult(conflict, before.inspection)
      const site = before.inspection.sites[0]
      const ownerKey = ownerForCurrentSite(before)
      if (!site || !ownerKey) return atomicResult('ownership-conflict', before.inspection)

      if (sameOwnershipCoordinate(site.coordinate, input.manifest.destination)) {
        const exactReplay = exactTransferFence(ownerKey, input)
          && exactPendingIntents(
            before.inspection.collaboratorIntents,
            input.manifest.collaborators,
          )
        return atomicResult(
          exactReplay ? 'replayed' : 'intent-conflict',
          before.inspection,
        )
      }
      if (!sameOwnershipCoordinate(site.coordinate, input.manifest.source)
        || ownerKey.state !== 'active') {
        return atomicResult('ownership-conflict', before.inspection)
      }
      if (before.inspection.collaboratorIntents.length > 0) {
        return atomicResult('intent-conflict', before.inspection)
      }

      for (const [index, collaborator] of input.manifest.collaborators.entries()) {
        await this.#insertIntent(db, input, collaborator, index)
      }
      const { rowCount: ownerKeysRebound } = await db`
        update fuma_tenant_owner_keys
        set organization_id = ${input.manifest.destination.organizationId},
          workspace_id = ${input.manifest.destination.workspaceId},
          state = 'transferring',
          generation = generation + 1,
          transfer_id = ${input.saga.transferId},
          transfer_lock_id = ${input.saga.lockId},
          transfer_fence = ${input.saga.fence},
          updated_at = current_timestamp
        where platform_id = ${input.manifest.source.platformId}
          and owner_key = ${ownerKey.ownerKey}
          and organization_id = ${input.manifest.source.organizationId}
          and workspace_id = ${input.manifest.source.workspaceId}
          and site_id = ${input.manifest.source.siteId}
          and state = 'active'
          and generation = ${ownerKey.generation}
          and transfer_id is null
          and transfer_lock_id is null
          and transfer_fence is null
      `
      if (ownerKeysRebound !== 1) {
        throw new Error('Fenced base ownership publish lost its owner-key generation.')
      }
      const { rowCount } = await db`
        update fuma_sites
        set organization_id = ${input.manifest.destination.organizationId},
          workspace_id = ${input.manifest.destination.workspaceId},
          updated_at = current_timestamp
        where organization_id = ${input.manifest.source.organizationId}
          and workspace_id = ${input.manifest.source.workspaceId}
          and id = ${input.manifest.source.siteId}
          and profile_id = ${input.manifest.siteProfileId}
      `
      if (rowCount !== 1) {
        throw new Error('Fenced base ownership publish lost its locked source site.')
      }
      return atomicResult('applied', (await this.#inspect(db, input)).inspection)
    })
  }

  restoreBaseOwnership(input: BaseOwnershipOperationInput): Promise<BaseOwnershipAtomicResult> {
    validateOperation(input)
    return this.#db.transaction(async (db) => {
      const before = await this.#inspect(db, input)
      const conflict = commonConflict(before, input, false)
      if (conflict) return atomicResult(conflict, before.inspection)
      const site = before.inspection.sites[0]
      const ownerKey = ownerForCurrentSite(before)
      if (!site || !ownerKey) return atomicResult('ownership-conflict', before.inspection)

      if (sameOwnershipCoordinate(site.coordinate, input.manifest.source)) {
        const exactReplay = ownerKey.state === 'active'
          && before.inspection.collaboratorIntents.length === 0
        return atomicResult(
          exactReplay ? 'replayed' : 'intent-conflict',
          before.inspection,
        )
      }
      if (!sameOwnershipCoordinate(site.coordinate, input.manifest.destination)
        || !exactTransferFence(ownerKey, input)) {
        return atomicResult('ownership-conflict', before.inspection)
      }
      if (!exactPendingIntents(
        before.inspection.collaboratorIntents,
        input.manifest.collaborators,
      )) {
        return atomicResult('intent-conflict', before.inspection)
      }

      const { rowCount: discarded } = await db`
        delete from fuma_site_transfer_collaborator_intents
        where platform_id = ${input.manifest.source.platformId}
          and transfer_id = ${input.manifest.transferId}
          and state = 'pending'
      `
      if (discarded !== input.manifest.collaborators.length) {
        throw new Error('Fenced base ownership compensation lost locked collaborator intent.')
      }
      const { rowCount: ownerKeysRestored } = await db`
        update fuma_tenant_owner_keys
        set organization_id = ${input.manifest.source.organizationId},
          workspace_id = ${input.manifest.source.workspaceId},
          state = 'active',
          generation = generation + 1,
          transfer_id = null,
          transfer_lock_id = null,
          transfer_fence = null,
          updated_at = current_timestamp
        where platform_id = ${input.manifest.source.platformId}
          and owner_key = ${ownerKey.ownerKey}
          and organization_id = ${input.manifest.destination.organizationId}
          and workspace_id = ${input.manifest.destination.workspaceId}
          and site_id = ${input.manifest.destination.siteId}
          and state = 'transferring'
          and transfer_id = ${input.saga.transferId}
          and transfer_lock_id = ${input.saga.lockId}
          and transfer_fence = ${input.saga.fence}
          and generation = ${ownerKey.generation}
      `
      if (ownerKeysRestored !== 1) {
        throw new Error('Fenced base ownership compensation lost its owner-key generation.')
      }
      const { rowCount } = await db`
        update fuma_sites
        set organization_id = ${input.manifest.source.organizationId},
          workspace_id = ${input.manifest.source.workspaceId},
          updated_at = current_timestamp
        where organization_id = ${input.manifest.destination.organizationId}
          and workspace_id = ${input.manifest.destination.workspaceId}
          and id = ${input.manifest.destination.siteId}
          and profile_id = ${input.manifest.siteProfileId}
      `
      if (rowCount !== 1) {
        throw new Error('Fenced base ownership compensation lost its locked destination site.')
      }
      return atomicResult('compensated', (await this.#inspect(db, input)).inspection)
    })
  }

  async #inspect(
    db: DbClient,
    input: BaseOwnershipOperationInput,
  ): Promise<LockedBaseOwnershipInspection> {
    const source = input.manifest.source
    const destination = input.manifest.destination
    const proposalResult = await db<ProposalRow>`
      select manifest_json
      from fuma_site_transfer_proposals
      where platform_id = ${source.platformId}
        and id = ${input.manifest.transferId}
        and source_organization_id = ${source.organizationId}
        and source_workspace_id = ${source.workspaceId}
        and source_site_id = ${source.siteId}
        and destination_organization_id = ${destination.organizationId}
        and destination_workspace_id = ${destination.workspaceId}
        and destination_site_id = ${destination.siteId}
      for update
    `
    const proposal = storedManifest(proposalResult.rows[0])
    const proposalMatches = proposal !== null && sameTransferValue(proposal, input.manifest)

    const lockResult = await db<LockRow>`
      select id
      from fuma_site_transfer_locks
      where platform_id = ${source.platformId}
        and id = ${input.saga.lockId}
        and transfer_id = ${input.saga.transferId}
        and organization_id = ${source.organizationId}
        and workspace_id = ${source.workspaceId}
        and site_id = ${source.siteId}
        and fence = ${input.saga.fence}
        and state = 'active'
      for update
    `
    const workspaceResult = await db<WorkspaceRow>`
      select organization_id, id, status
      from fuma_workspaces
      where organization_id = ${destination.organizationId}
        and id = ${destination.workspaceId}
      for update
    `
    const siteResult = await db<SiteRow>`
      select organization_id, workspace_id, id, profile_id, capability_overrides_json
      from fuma_sites
      where id = ${source.siteId}
      order by organization_id, workspace_id, id
      for update
    `
    const ownerKeyResult = await db<OwnerKeyRow>`
      select owner_key, organization_id, workspace_id, site_id, state, generation,
        transfer_id, transfer_lock_id, transfer_fence
      from fuma_tenant_owner_keys
      where platform_id = ${source.platformId}
        and site_id = ${source.siteId}
      order by owner_key
      for update
    `
    const ownerKeys = ownerKeyResult.rows.map((row) => storedOwnerKey(row, source.platformId))
    const intentResult = await db<CollaboratorIntentRow>`
      select user_id, source_role, intent, destination_role, state
      from fuma_site_transfer_collaborator_intents
      where platform_id = ${source.platformId}
        and transfer_id = ${input.manifest.transferId}
      order by user_id, id
      for update
    `
    const fenceMatches = proposalMatches && lockResult.rows.length === 1
    const inspection: BaseOwnershipInspection = {
      proposalMatches,
      fenceMatches,
      destinationWorkspace: storedWorkspace(workspaceResult.rows[0], source.platformId),
      sites: siteResult.rows.map((row) => {
        const coordinate = {
          platformId: source.platformId,
          organizationId: row.organization_id,
          workspaceId: row.workspace_id,
          siteId: row.id,
        }
        const ownerKey = ownerKeys.find((candidate) => (
          sameOwnershipCoordinate(candidate.coordinate, coordinate)
        ))
        return storedSite(row, input, ownerKey)
      }),
      collaboratorIntents: intentResult.rows.map(storedCollaboratorIntent),
    }
    return { inspection, ownerKeys }
  }

  async #insertIntent(
    db: DbClient,
    input: BaseOwnershipOperationInput,
    collaborator: TransferCollaboratorIntent,
    index: number,
  ): Promise<void> {
    const intentId = `base-ownership:${input.manifest.transferId}:${index}:${collaborator.userId}`
    const { rowCount } = await db`
      insert into fuma_site_transfer_collaborator_intents (
        platform_id, id, transfer_id, user_id, source_role, intent,
        destination_role, state, receipt_json, error_json, applied_at
      ) values (
        ${input.manifest.source.platformId}, ${intentId}, ${input.manifest.transferId},
        ${collaborator.userId}, ${collaborator.sourceRole}, ${collaborator.intent},
        ${collaborator.destinationRole}, 'pending', null, null, null
      )
    `
    if (rowCount !== 1) {
      throw new Error(`Failed to persist pending collaborator intent for ${collaborator.userId}.`)
    }
  }
}
