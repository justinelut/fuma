import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { createOrganizationPolicyHooks } from '../../../server/fuma/organizations/hooks'
import {
  OrganizationCreationContributionSchema,
  OrganizationCreationPolicyInputSchema,
  OrganizationMutationContributionSchema,
  OrganizationPolicyError,
  OrganizationPolicyErrorCodeSchema,
  authorizeOrganizationCreation,
  authorizeOrganizationMutation,
  type OrganizationPolicyActor,
  type OrganizationPolicyErrorCode,
} from '../../../server/fuma/organizations/policy'

const CONFIGURATION = {
  platformOrganizationId: 'org-platform',
  protectedOwnerUserId: 'user-protected-owner',
} as const

const AUTHORIZED_ACTOR: OrganizationPolicyActor = {
  authentication: { state: 'authenticated', userId: 'user-customer-owner' },
  authorization: {
    canCreateOrganizations: true,
    canManageOrganizations: true,
  },
}

function creationInput(actor: OrganizationPolicyActor = AUTHORIZED_ACTOR) {
  return {
    actor,
    organization: {
      organization_class: 'customer' as const,
      displayName: 'Acme',
      slug: 'acme',
    },
  }
}

function mutationInput(action: Record<string, unknown>) {
  return {
    actor: AUTHORIZED_ACTOR,
    organization: {
      id: CONFIGURATION.platformOrganizationId,
      organization_class: 'platform' as const,
    },
    action,
  }
}

function expectPolicyError(run: () => unknown, code: OrganizationPolicyErrorCode): OrganizationPolicyError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(OrganizationPolicyError)
    if (!(error instanceof OrganizationPolicyError)) throw error
    expect(Value.Check(OrganizationPolicyErrorCodeSchema, error.code)).toBe(true)
    expect(error.code).toBe(code)
    return error
  }
  throw new Error(`Expected organization policy error ${code}.`)
}

describe('FUMA-014 organization creation policy', () => {
  it('requires both authentication and explicit creation authorization', () => {
    expectPolicyError(() => authorizeOrganizationCreation(creationInput({
      authentication: { state: 'anonymous' },
      authorization: {
        canCreateOrganizations: true,
        canManageOrganizations: false,
      },
    })), 'authentication-required')

    expectPolicyError(() => authorizeOrganizationCreation(creationInput({
      authentication: { state: 'authenticated', userId: 'user-without-grant' },
      authorization: {
        canCreateOrganizations: false,
        canManageOrganizations: false,
      },
    })), 'authorization-required')
  })

  it('reserves platform organization creation for bootstrap', () => {
    expectPolicyError(() => authorizeOrganizationCreation({
      ...creationInput(),
      organization: {
        organization_class: 'platform',
        displayName: 'Fuma platform',
        slug: 'fuma-platform',
      },
    }), 'platform-organization-reserved')
  })

  it('emits finite launch limits and shared placement by default', () => {
    const contribution = authorizeOrganizationCreation(creationInput())

    expect(Value.Check(OrganizationCreationPolicyInputSchema, creationInput())).toBe(true)
    expect(Value.Check(OrganizationCreationContributionSchema, contribution)).toBe(true)
    expect(contribution.ownerUserId).toBe('user-customer-owner')
    expect(contribution.placement).toEqual({
      placement_class: 'shared',
      placement_key: 'shared:launch',
    })
    for (const limit of Object.values(contribution.limits)) {
      expect(Number.isFinite(limit)).toBe(true)
      expect(limit).toBeGreaterThan(0)
    }
  })

  it('denies dedicated placement without separately priced enterprise authorization', () => {
    expectPolicyError(() => authorizeOrganizationCreation({
      ...creationInput(),
      placement: {
        placement_class: 'dedicated',
        placement_key: 'dedicated:acme',
      },
    }), 'dedicated-placement-authorization-required')
  })

  it('accepts an explicit premium placement guard as placement metadata only', () => {
    const contribution = authorizeOrganizationCreation({
      ...creationInput(),
      placement: {
        placement_class: 'dedicated',
        placement_key: 'dedicated:enterprise-contract-42',
        enterpriseAuthorization: {
          kind: 'enterprise_dedicated_placement',
          authorizationId: 'enterprise-contract-42',
          approvedByUserId: 'user-platform-billing',
          enterpriseApproved: true,
          separatelyPriced: true,
        },
      },
    })

    expect(Value.Check(OrganizationCreationContributionSchema, contribution)).toBe(true)
    expect(contribution.placement).toEqual({
      placement_class: 'dedicated',
      placement_key: 'dedicated:enterprise-contract-42',
      enterpriseAuthorization: {
        kind: 'enterprise_dedicated_placement',
        authorizationId: 'enterprise-contract-42',
        approvedByUserId: 'user-platform-billing',
        enterpriseApproved: true,
        separatelyPriced: true,
      },
    })
    for (const resource of ['database', 'redis', 'minio', 'edge', 'web', 'worker', 'scheduler']) {
      expect(resource in contribution.placement).toBe(false)
    }
  })
})

describe('FUMA-014 organization mutation policy', () => {
  it('denies removal, demotion, and suspension of the configured protected owner', () => {
    for (const action of [
      { kind: 'remove-member', targetUserId: CONFIGURATION.protectedOwnerUserId },
      { kind: 'set-member-role', targetUserId: CONFIGURATION.protectedOwnerUserId, role: 'admin' },
      { kind: 'suspend-member', targetUserId: CONFIGURATION.protectedOwnerUserId },
    ]) {
      expectPolicyError(
        () => authorizeOrganizationMutation(CONFIGURATION, mutationInput(action)),
        'protected-owner-mutation',
      )
    }
  })

  it('denies platform owner grants through customer invitation paths', () => {
    expectPolicyError(() => authorizeOrganizationMutation(CONFIGURATION, mutationInput({
      kind: 'grant-membership',
      targetUserId: 'user-invitee',
      role: 'owner',
      source: 'customer_invitation',
    })), 'platform-owner-invitation-forbidden')
  })

  it('returns a declarative contribution for an authorized safe mutation', () => {
    const contribution = authorizeOrganizationMutation(CONFIGURATION, mutationInput({
      kind: 'grant-membership',
      targetUserId: 'user-platform-admin',
      role: 'admin',
      source: 'platform_administration',
    }))

    expect(Value.Check(OrganizationMutationContributionSchema, contribution)).toBe(true)
    expect(contribution.authorized).toBe(true)
  })
})

describe('FUMA-014 organization hooks', () => {
  it('produces isolated declarative bootstrap and create contributions', () => {
    const hooks = createOrganizationPolicyHooks(CONFIGURATION)
    const otherHooks = createOrganizationPolicyHooks({
      platformOrganizationId: 'org-other-platform',
      protectedOwnerUserId: 'user-other-owner',
    })

    expect(hooks.bootstrap()).toEqual({
      organization: {
        id: CONFIGURATION.platformOrganizationId,
        organization_class: 'platform',
        reserved: true,
      },
      ownerMembership: {
        userId: CONFIGURATION.protectedOwnerUserId,
        role: 'owner',
        protected: true,
        source: 'platform_bootstrap',
      },
    })
    expect(otherHooks.bootstrap().organization.id).toBe('org-other-platform')
    expect(hooks.create(creationInput()).placement).toEqual({
      placement_class: 'shared',
      placement_key: 'shared:launch',
    })
  })
})
