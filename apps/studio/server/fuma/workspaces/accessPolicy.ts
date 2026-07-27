import type {
  OrganizationMembershipRecord,
  OrganizationRole,
} from '../organizations/contracts'
import type {
  WorkspaceMembershipOverrideInput,
  WorkspaceMembershipOverrideRecord,
  WorkspaceOrganizationId,
  WorkspaceRecord,
  WorkspaceRole,
  WorkspaceUserId,
} from './contracts'

export const INHERITED_WORKSPACE_ROLES: Readonly<Record<OrganizationRole, WorkspaceRole>> = Object.freeze({
  owner: 'owner',
  admin: 'admin',
  member: 'editor',
})

export type WorkspaceAccessOperation = 'read-metadata' | 'mutate'
export type WorkspaceAccessSource = 'organization-membership' | 'workspace-override'
export type WorkspaceAccessDenialReason =
  | 'scope-mismatch'
  | 'organization-membership-required'
  | 'explicit-deny'
  | 'archived-workspace-mutation'
  | 'archived-workspace-metadata-restricted'

export type WorkspaceAccessDecision =
  | Readonly<{
    authorized: true
    role: WorkspaceRole
    source: WorkspaceAccessSource
  }>
  | Readonly<{
    authorized: false
    role: WorkspaceRole | null
    reason: WorkspaceAccessDenialReason
  }>

export interface WorkspaceAccessResolutionInput {
  workspace: Pick<WorkspaceRecord, 'id' | 'organizationId' | 'status'>
  userId: WorkspaceUserId
  organizationMembership: OrganizationMembershipRecord | null
  membershipOverride: WorkspaceMembershipOverrideRecord | null
  operation: WorkspaceAccessOperation
}

function denied(
  reason: WorkspaceAccessDenialReason,
  role: WorkspaceRole | null = null,
): WorkspaceAccessDecision {
  return Object.freeze({ authorized: false, role, reason })
}

export function resolveWorkspaceAccess(
  input: WorkspaceAccessResolutionInput,
): WorkspaceAccessDecision {
  const { workspace, userId, organizationMembership, membershipOverride } = input

  if (
    membershipOverride
    && (
      membershipOverride.workspaceId !== workspace.id
      || membershipOverride.userId !== userId
    )
  ) {
    return denied('scope-mismatch')
  }

  if (membershipOverride?.access === 'deny') {
    return denied('explicit-deny')
  }

  if (!organizationMembership) {
    return denied('organization-membership-required')
  }

  if (
    organizationMembership.organizationId !== workspace.organizationId
    || organizationMembership.userId !== userId
  ) {
    return denied('scope-mismatch')
  }

  const role = membershipOverride?.access === 'grant'
    ? membershipOverride.role
    : INHERITED_WORKSPACE_ROLES[organizationMembership.role]
  const source: WorkspaceAccessSource = membershipOverride?.access === 'grant'
    ? 'workspace-override'
    : 'organization-membership'

  if (workspace.status === 'archived') {
    if (input.operation === 'mutate') {
      return denied('archived-workspace-mutation', role)
    }
    if (role !== 'owner' && role !== 'admin') {
      return denied('archived-workspace-metadata-restricted', role)
    }
  }

  return Object.freeze({ authorized: true, role, source })
}

export interface WorkspaceAccessPolicyConfiguration {
  platformOrganizationId: WorkspaceOrganizationId
  protectedOwnerUserId: WorkspaceUserId
}

export type WorkspaceOverridePolicyErrorCode =
  | 'workspace-required'
  | 'scope-mismatch'
  | 'actor-membership-required'
  | 'target-membership-required'
  | 'authorization-required'
  | 'archived-workspace-mutation'
  | 'protected-owner-override'

export class WorkspaceOverridePolicyError extends Error {
  readonly code: WorkspaceOverridePolicyErrorCode
  readonly path: string

  constructor(code: WorkspaceOverridePolicyErrorCode, message: string, path: string) {
    super(message)
    this.name = 'WorkspaceOverridePolicyError'
    this.code = code
    this.path = path
  }
}

export interface WorkspaceMembershipOverrideWritePolicyInput {
  configuration: WorkspaceAccessPolicyConfiguration
  actorUserId: WorkspaceUserId
  override: WorkspaceMembershipOverrideInput
  workspace: WorkspaceRecord | null
  actorMembership: OrganizationMembershipRecord | null
  targetMembership: OrganizationMembershipRecord | null
}

type AuthorizedOverrideFields<T extends WorkspaceMembershipOverrideRecord> =
  T extends WorkspaceMembershipOverrideRecord
    ? Readonly<Pick<T, 'workspaceId' | 'userId' | 'access' | 'role'>>
    : never

export type AuthorizedWorkspaceMembershipOverride =
  AuthorizedOverrideFields<WorkspaceMembershipOverrideRecord>

function requireScopedMembership(
  membership: OrganizationMembershipRecord | null,
  expectedOrganizationId: WorkspaceOrganizationId,
  expectedUserId: WorkspaceUserId,
  kind: 'actor' | 'target',
): OrganizationMembershipRecord {
  if (!membership) {
    throw new WorkspaceOverridePolicyError(
      kind === 'actor' ? 'actor-membership-required' : 'target-membership-required',
      `Workspace override writes require ${kind} organization membership.`,
      `${kind}Membership`,
    )
  }
  if (
    membership.organizationId !== expectedOrganizationId
    || membership.userId !== expectedUserId
  ) {
    throw new WorkspaceOverridePolicyError(
      'scope-mismatch',
      `Workspace override ${kind} membership is outside the requested organization scope.`,
      `${kind}Membership`,
    )
  }
  return membership
}

export function authorizeWorkspaceMembershipOverrideWrite(
  input: WorkspaceMembershipOverrideWritePolicyInput,
): AuthorizedWorkspaceMembershipOverride {
  const { configuration, override, workspace } = input

  if (!workspace) {
    throw new WorkspaceOverridePolicyError(
      'workspace-required',
      'Workspace override writes require an existing workspace.',
      'workspace',
    )
  }
  if (
    workspace.id !== override.workspaceId
    || workspace.organizationId !== override.organizationId
  ) {
    throw new WorkspaceOverridePolicyError(
      'scope-mismatch',
      'Workspace override workspace is outside the requested organization scope.',
      'workspace',
    )
  }

  const actorMembership = requireScopedMembership(
    input.actorMembership,
    override.organizationId,
    input.actorUserId,
    'actor',
  )
  requireScopedMembership(
    input.targetMembership,
    override.organizationId,
    override.userId,
    'target',
  )

  if (actorMembership.role !== 'owner' && actorMembership.role !== 'admin') {
    throw new WorkspaceOverridePolicyError(
      'authorization-required',
      'Workspace override writes require an organization owner or admin.',
      'actorMembership.role',
    )
  }
  if (workspace.status === 'archived') {
    throw new WorkspaceOverridePolicyError(
      'archived-workspace-mutation',
      'Archived workspaces cannot accept membership override mutations.',
      'workspace.status',
    )
  }

  const protectedOwnerMutation = (
    workspace.organizationId === configuration.platformOrganizationId
    && override.userId === configuration.protectedOwnerUserId
    && (
      override.access === 'deny'
      || (override.access === 'grant' && override.role !== 'owner')
    )
  )
  if (protectedOwnerMutation) {
    throw new WorkspaceOverridePolicyError(
      'protected-owner-override',
      'The protected platform owner cannot be denied or demoted in a platform workspace.',
      'override',
    )
  }

  if (override.access === 'grant') {
    return Object.freeze({
      workspaceId: override.workspaceId,
      userId: override.userId,
      access: 'grant',
      role: override.role,
    })
  }
  if (override.access === 'deny') {
    return Object.freeze({
      workspaceId: override.workspaceId,
      userId: override.userId,
      access: 'deny',
      role: null,
    })
  }
  return Object.freeze({
    workspaceId: override.workspaceId,
    userId: override.userId,
    access: 'inherit',
    role: null,
  })
}
