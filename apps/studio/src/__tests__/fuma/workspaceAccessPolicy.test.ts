import { describe, expect, it } from 'bun:test'
import type { OrganizationMembershipRecord } from '../../../server/fuma/organizations/contracts'
import {
  INHERITED_WORKSPACE_ROLES,
  WorkspaceOverridePolicyError,
  authorizeWorkspaceMembershipOverrideWrite,
  resolveWorkspaceAccess,
  type WorkspaceAccessPolicyConfiguration,
  type WorkspaceOverridePolicyErrorCode,
} from '../../../server/fuma/workspaces/accessPolicy'
import type {
  WorkspaceMembershipOverrideInput,
  WorkspaceMembershipOverrideRecord,
  WorkspaceRecord,
} from '../../../server/fuma/workspaces/contracts'
import {
  writeWorkspaceMembershipOverride,
  type WorkspaceMembershipOverrideRepository,
  type WorkspaceMembershipOverrideTransaction,
} from '../../../server/fuma/workspaces/membershipOverrides'

const NOW = new Date('2026-07-24T18:30:00.000Z')
const CREATED_AT = '2026-07-24T18:00:00.000Z'
const CONFIGURATION: WorkspaceAccessPolicyConfiguration = {
  platformOrganizationId: 'org-platform',
  protectedOwnerUserId: 'user-platform-owner',
}

function workspace(
  organizationId = 'org-acme',
  status: WorkspaceRecord['status'] = 'active',
): WorkspaceRecord {
  return {
    id: organizationId === 'org-platform' ? 'workspace-platform' : 'workspace-acme',
    organizationId,
    slug: 'main',
    name: 'Main',
    status,
    isDefault: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
}

function membership(
  userId: string,
  role: OrganizationMembershipRecord['role'],
  organizationId = 'org-acme',
): OrganizationMembershipRecord {
  return {
    id: `membership-${organizationId}-${userId}`,
    organizationId,
    userId,
    role,
  }
}

function override(
  workspaceId: string,
  userId: string,
  access: WorkspaceMembershipOverrideRecord['access'],
  role: WorkspaceMembershipOverrideRecord['role'] = null,
): WorkspaceMembershipOverrideRecord {
  if (access === 'grant') {
    if (!role) throw new Error('Grant fixture requires a role.')
    return {
      workspaceId,
      userId,
      access,
      role,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }
  }
  return {
    workspaceId,
    userId,
    access,
    role: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
}

function expectPolicyError(
  run: () => unknown,
  code: WorkspaceOverridePolicyErrorCode,
): WorkspaceOverridePolicyError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceOverridePolicyError)
    if (!(error instanceof WorkspaceOverridePolicyError)) throw error
    expect(error.code).toBe(code)
    return error
  }
  throw new Error(`Expected workspace override policy error ${code}.`)
}

function overrideWriteInput(
  targetUserId = 'user-target',
  value: Pick<WorkspaceMembershipOverrideInput, 'access' | 'role'> = {
    access: 'grant',
    role: 'editor',
  },
) {
  const currentWorkspace = workspace()
  const writeOverride: WorkspaceMembershipOverrideInput = value.access === 'grant'
    ? {
        organizationId: currentWorkspace.organizationId,
        workspaceId: currentWorkspace.id,
        userId: targetUserId,
        access: 'grant',
        role: value.role ?? 'editor',
      }
    : {
        organizationId: currentWorkspace.organizationId,
        workspaceId: currentWorkspace.id,
        userId: targetUserId,
        access: value.access,
        role: null,
      }

  return {
    configuration: CONFIGURATION,
    actorUserId: 'user-actor',
    override: writeOverride,
    workspace: currentWorkspace,
    actorMembership: membership('user-actor', 'admin'),
    targetMembership: membership(targetUserId, 'member'),
  }
}

class FakeOverrideRepository implements WorkspaceMembershipOverrideRepository {
  readonly memberships = new Map<string, OrganizationMembershipRecord>()
  readonly saved: WorkspaceMembershipOverrideRecord[] = []
  currentWorkspace: WorkspaceRecord | null = workspace()
  existing: WorkspaceMembershipOverrideRecord | null = null
  transactionCount = 0
  readonly calls: string[] = []

  membershipKey(organizationId: string, userId: string): string {
    return `${organizationId}:${userId}`
  }

  addMembership(value: OrganizationMembershipRecord): void {
    this.memberships.set(this.membershipKey(value.organizationId, value.userId), value)
  }

  async transaction<T>(
    organizationId: string,
    work: (transaction: WorkspaceMembershipOverrideTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1
    this.calls.push(`transaction:${organizationId}`)
    const transaction: WorkspaceMembershipOverrideTransaction = {
      findWorkspaceById: async (workspaceId) => (
        await this.#findWorkspaceById(organizationId, workspaceId)
      ),
      findOrganizationMembership: async (userId) => (
        await this.#findOrganizationMembership(organizationId, userId)
      ),
      findWorkspaceMembershipOverride: async (workspaceId, userId) => (
        await this.#findWorkspaceMembershipOverride(organizationId, workspaceId, userId)
      ),
      saveWorkspaceMembershipOverride: async (record) => {
        await this.#saveWorkspaceMembershipOverride(organizationId, record)
      },
    }
    return work(transaction)
  }

  async #findWorkspaceById(
    organizationId: string,
    workspaceId: string,
  ): Promise<WorkspaceRecord | null> {
    this.calls.push(`workspace:${organizationId}:${workspaceId}`)
    return this.currentWorkspace?.organizationId === organizationId
      && this.currentWorkspace.id === workspaceId
      ? this.currentWorkspace
      : null
  }

  async #findOrganizationMembership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembershipRecord | null> {
    return this.memberships.get(this.membershipKey(organizationId, userId)) ?? null
  }

  async #findWorkspaceMembershipOverride(
    organizationId: string,
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipOverrideRecord | null> {
    this.calls.push(`override:${organizationId}:${workspaceId}:${userId}`)
    return this.existing
  }

  async #saveWorkspaceMembershipOverride(
    organizationId: string,
    record: WorkspaceMembershipOverrideRecord,
  ): Promise<void> {
    this.calls.push(`save:${organizationId}:${record.workspaceId}:${record.userId}`)
    this.saved.push(record)
  }
}

describe('FUMA-015 workspace access resolution', () => {
  it('inherits organization owner, admin, and member as workspace owner, admin, and editor', () => {
    expect(INHERITED_WORKSPACE_ROLES).toEqual({
      owner: 'owner',
      admin: 'admin',
      member: 'editor',
    })

    for (const [organizationRole, expectedWorkspaceRole] of Object.entries(INHERITED_WORKSPACE_ROLES)) {
      const decision = resolveWorkspaceAccess({
        workspace: workspace(),
        userId: 'user-subject',
        organizationMembership: membership(
          'user-subject',
          organizationRole as OrganizationMembershipRecord['role'],
        ),
        membershipOverride: null,
        operation: 'mutate',
      })
      expect(decision).toEqual({
        authorized: true,
        role: expectedWorkspaceRole,
        source: 'organization-membership',
      })
    }
  })

  it('applies explicit grant over inheritance and explicit deny over every role', () => {
    const currentWorkspace = workspace()
    const inheritedOwner = membership('user-subject', 'owner')

    expect(resolveWorkspaceAccess({
      workspace: currentWorkspace,
      userId: 'user-subject',
      organizationMembership: inheritedOwner,
      membershipOverride: override(currentWorkspace.id, 'user-subject', 'grant', 'viewer'),
      operation: 'mutate',
    })).toEqual({
      authorized: true,
      role: 'viewer',
      source: 'workspace-override',
    })

    expect(resolveWorkspaceAccess({
      workspace: currentWorkspace,
      userId: 'user-subject',
      organizationMembership: inheritedOwner,
      membershipOverride: override(currentWorkspace.id, 'user-subject', 'deny'),
      operation: 'read-metadata',
    })).toEqual({
      authorized: false,
      role: null,
      reason: 'explicit-deny',
    })
  })

  it('denies absent membership and fails closed on cross-organization or cross-user records', () => {
    const currentWorkspace = workspace()

    expect(resolveWorkspaceAccess({
      workspace: currentWorkspace,
      userId: 'user-subject',
      organizationMembership: null,
      membershipOverride: override(currentWorkspace.id, 'user-subject', 'grant', 'owner'),
      operation: 'read-metadata',
    }).authorized).toBe(false)

    for (const input of [
      {
        organizationMembership: membership('user-subject', 'owner', 'org-other'),
        membershipOverride: null,
      },
      {
        organizationMembership: membership('user-subject', 'owner'),
        membershipOverride: override(currentWorkspace.id, 'user-other', 'grant', 'owner'),
      },
      {
        organizationMembership: membership('user-subject', 'owner'),
        membershipOverride: override('workspace-other', 'user-subject', 'grant', 'owner'),
      },
    ]) {
      expect(resolveWorkspaceAccess({
        workspace: currentWorkspace,
        userId: 'user-subject',
        ...input,
        operation: 'read-metadata',
      })).toEqual({
        authorized: false,
        role: null,
        reason: 'scope-mismatch',
      })
    }
  })

  it('denies archived mutations and limits archived metadata reads to resolved owner/admin roles', () => {
    const archived = workspace('org-acme', 'archived')

    expect(resolveWorkspaceAccess({
      workspace: archived,
      userId: 'user-owner',
      organizationMembership: membership('user-owner', 'owner'),
      membershipOverride: null,
      operation: 'mutate',
    })).toMatchObject({
      authorized: false,
      reason: 'archived-workspace-mutation',
    })

    for (const role of ['owner', 'admin'] as const) {
      expect(resolveWorkspaceAccess({
        workspace: archived,
        userId: `user-${role}`,
        organizationMembership: membership(`user-${role}`, role),
        membershipOverride: null,
        operation: 'read-metadata',
      }).authorized).toBe(true)
    }

    expect(resolveWorkspaceAccess({
      workspace: archived,
      userId: 'user-member',
      organizationMembership: membership('user-member', 'member'),
      membershipOverride: null,
      operation: 'read-metadata',
    })).toMatchObject({
      authorized: false,
      role: 'editor',
      reason: 'archived-workspace-metadata-restricted',
    })
  })
})

describe('FUMA-015 membership override write policy', () => {
  it('requires an organization owner/admin and same-organization target membership', () => {
    const unauthorized = overrideWriteInput()
    unauthorized.actorMembership = membership('user-actor', 'member')
    expectPolicyError(
      () => authorizeWorkspaceMembershipOverrideWrite(unauthorized),
      'authorization-required',
    )

    const missingTarget = overrideWriteInput()
    missingTarget.targetMembership = null
    expectPolicyError(
      () => authorizeWorkspaceMembershipOverrideWrite(missingTarget),
      'target-membership-required',
    )
  })

  it('fails closed when actor, target, or workspace records cross organization scope', () => {
    const crossActor = overrideWriteInput()
    crossActor.actorMembership = membership('user-actor', 'admin', 'org-other')

    const crossTarget = overrideWriteInput()
    crossTarget.targetMembership = membership('user-target', 'member', 'org-other')

    const crossWorkspace = overrideWriteInput()
    crossWorkspace.workspace = workspace('org-other')

    for (const input of [crossActor, crossTarget, crossWorkspace]) {
      expectPolicyError(
        () => authorizeWorkspaceMembershipOverrideWrite(input),
        'scope-mismatch',
      )
    }
  })

  it('rejects every override mutation against an archived workspace', () => {
    const input = overrideWriteInput()
    input.workspace = workspace('org-acme', 'archived')
    expectPolicyError(
      () => authorizeWorkspaceMembershipOverrideWrite(input),
      'archived-workspace-mutation',
    )
  })

  it('prevents denial or demotion of the protected owner in the platform workspace', () => {
    const platformWorkspace = workspace('org-platform')

    for (const protectedOverride of [
      {
        organizationId: 'org-platform',
        workspaceId: platformWorkspace.id,
        userId: CONFIGURATION.protectedOwnerUserId,
        access: 'deny' as const,
        role: null,
      },
      {
        organizationId: 'org-platform',
        workspaceId: platformWorkspace.id,
        userId: CONFIGURATION.protectedOwnerUserId,
        access: 'grant' as const,
        role: 'admin' as const,
      },
    ]) {
      expectPolicyError(() => authorizeWorkspaceMembershipOverrideWrite({
        configuration: CONFIGURATION,
        actorUserId: 'user-platform-admin',
        override: protectedOverride,
        workspace: platformWorkspace,
        actorMembership: membership('user-platform-admin', 'admin', 'org-platform'),
        targetMembership: membership(
          CONFIGURATION.protectedOwnerUserId,
          'owner',
          'org-platform',
        ),
      }), 'protected-owner-override')
    }

    expect(authorizeWorkspaceMembershipOverrideWrite({
      configuration: CONFIGURATION,
      actorUserId: 'user-platform-admin',
      override: {
        organizationId: 'org-platform',
        workspaceId: platformWorkspace.id,
        userId: CONFIGURATION.protectedOwnerUserId,
        access: 'inherit',
        role: null,
      },
      workspace: platformWorkspace,
      actorMembership: membership('user-platform-admin', 'admin', 'org-platform'),
      targetMembership: membership(
        CONFIGURATION.protectedOwnerUserId,
        'owner',
        'org-platform',
      ),
    })).toMatchObject({ access: 'inherit', role: null })
  })

  it('writes an authorized override through one transaction and preserves its creation time', async () => {
    const repository = new FakeOverrideRepository()
    repository.addMembership(membership('user-actor', 'owner'))
    repository.addMembership(membership('user-target', 'member'))
    repository.existing = override(workspace().id, 'user-target', 'grant', 'viewer')

    const record = await writeWorkspaceMembershipOverride(repository, CONFIGURATION, {
      actorUserId: 'user-actor',
      override: {
        organizationId: 'org-acme',
        workspaceId: workspace().id,
        userId: 'user-target',
        access: 'grant',
        role: 'admin',
      },
      now: NOW,
    })

    expect(repository.transactionCount).toBe(1)
    expect(repository.calls).toEqual([
      'transaction:org-acme',
      `workspace:org-acme:${workspace().id}`,
      `override:org-acme:${workspace().id}:user-target`,
      `save:org-acme:${workspace().id}:user-target`,
    ])
    expect(repository.saved).toEqual([record])
    expect(record).toEqual({
      workspaceId: workspace().id,
      userId: 'user-target',
      access: 'grant',
      role: 'admin',
      createdAt: CREATED_AT,
      updatedAt: NOW.toISOString(),
    })
  })
})
