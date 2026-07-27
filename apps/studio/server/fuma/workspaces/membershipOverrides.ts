import type { OrganizationMembershipRecord } from '../organizations/contracts'
import type {
  WorkspaceId,
  WorkspaceMembershipOverrideInput,
  WorkspaceMembershipOverrideRecord,
  WorkspaceOrganizationId,
  WorkspaceRecord,
  WorkspaceUserId,
} from './contracts'
import {
  authorizeWorkspaceMembershipOverrideWrite,
  type WorkspaceAccessPolicyConfiguration,
} from './accessPolicy'

export interface WorkspaceMembershipOverrideTransaction {
  findWorkspaceById(workspaceId: WorkspaceId): Promise<WorkspaceRecord | null>
  findOrganizationMembership(
    userId: WorkspaceUserId,
  ): Promise<OrganizationMembershipRecord | null>
  findWorkspaceMembershipOverride(
    workspaceId: WorkspaceId,
    userId: WorkspaceUserId,
  ): Promise<WorkspaceMembershipOverrideRecord | null>
  saveWorkspaceMembershipOverride(record: WorkspaceMembershipOverrideRecord): Promise<void>
}

export interface WorkspaceMembershipOverrideRepository {
  transaction<T>(
    organizationId: WorkspaceOrganizationId,
    work: (transaction: WorkspaceMembershipOverrideTransaction) => Promise<T>,
  ): Promise<T>
}

export interface WorkspaceMembershipOverrideWriteRequest {
  actorUserId: WorkspaceUserId
  override: WorkspaceMembershipOverrideInput
  now: Date
}

export async function writeWorkspaceMembershipOverride(
  repository: WorkspaceMembershipOverrideRepository,
  configuration: WorkspaceAccessPolicyConfiguration,
  request: WorkspaceMembershipOverrideWriteRequest,
): Promise<WorkspaceMembershipOverrideRecord> {
  return repository.transaction(request.override.organizationId, async (transaction) => {
    const workspace = await transaction.findWorkspaceById(request.override.workspaceId)
    const actorMembership = await transaction.findOrganizationMembership(request.actorUserId)
    const targetMembership = await transaction.findOrganizationMembership(request.override.userId)

    const authorized = authorizeWorkspaceMembershipOverrideWrite({
      configuration,
      actorUserId: request.actorUserId,
      override: request.override,
      workspace,
      actorMembership,
      targetMembership,
    })
    const existing = await transaction.findWorkspaceMembershipOverride(
      authorized.workspaceId,
      authorized.userId,
    )
    const timestamp = request.now.toISOString()
    const record: WorkspaceMembershipOverrideRecord = {
      ...authorized,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }

    await transaction.saveWorkspaceMembershipOverride(record)
    return record
  })
}
