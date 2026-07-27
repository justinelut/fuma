import {
  Type,
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'

const RequiredIdentifierSchema = Type.String({ minLength: 1, pattern: '\\S' })
const OrganizationRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member'),
])

export const OrganizationPolicyConfigurationSchema = Type.Object({
  platformOrganizationId: RequiredIdentifierSchema,
  protectedOwnerUserId: RequiredIdentifierSchema,
}, { additionalProperties: false })

export type OrganizationPolicyConfiguration = Static<typeof OrganizationPolicyConfigurationSchema>

export const OrganizationPolicyActorSchema = Type.Object({
  authentication: Type.Union([
    Type.Object({ state: Type.Literal('anonymous') }, { additionalProperties: false }),
    Type.Object({
      state: Type.Literal('authenticated'),
      userId: RequiredIdentifierSchema,
    }, { additionalProperties: false }),
  ]),
  authorization: Type.Object({
    canCreateOrganizations: Type.Boolean(),
    canManageOrganizations: Type.Boolean(),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

export type OrganizationPolicyActor = Static<typeof OrganizationPolicyActorSchema>

export const EnterprisePlacementAuthorizationSchema = Type.Object({
  kind: Type.Literal('enterprise_dedicated_placement'),
  authorizationId: RequiredIdentifierSchema,
  approvedByUserId: RequiredIdentifierSchema,
  enterpriseApproved: Type.Literal(true),
  separatelyPriced: Type.Literal(true),
}, { additionalProperties: false })

export type EnterprisePlacementAuthorization = Static<typeof EnterprisePlacementAuthorizationSchema>

export const OrganizationPlacementRequestSchema = Type.Object({
  placement_class: Type.Union([
    Type.Literal('shared'),
    Type.Literal('dedicated'),
  ]),
  placement_key: Type.Optional(RequiredIdentifierSchema),
  enterpriseAuthorization: Type.Optional(EnterprisePlacementAuthorizationSchema),
}, { additionalProperties: false })

export type OrganizationPlacementRequest = Static<typeof OrganizationPlacementRequestSchema>

export const OrganizationCreationPolicyInputSchema = Type.Object({
  actor: OrganizationPolicyActorSchema,
  organization: Type.Object({
    organization_class: Type.Union([
      Type.Literal('customer'),
      Type.Literal('platform'),
    ]),
    displayName: Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' }),
    slug: Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  }, { additionalProperties: false }),
  placement: Type.Optional(OrganizationPlacementRequestSchema),
}, { additionalProperties: false })

export type OrganizationCreationPolicyInput = Static<typeof OrganizationCreationPolicyInputSchema>

export const OrganizationLimitsSchema = Type.Object({
  members: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  workspaces: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  sites: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
}, { additionalProperties: false })

export type OrganizationLimits = Static<typeof OrganizationLimitsSchema>

const SharedPlacementContributionSchema = Type.Object({
  placement_class: Type.Literal('shared'),
  placement_key: Type.Literal('shared:launch'),
}, { additionalProperties: false })

const DedicatedPlacementContributionSchema = Type.Object({
  placement_class: Type.Literal('dedicated'),
  placement_key: RequiredIdentifierSchema,
  enterpriseAuthorization: EnterprisePlacementAuthorizationSchema,
}, { additionalProperties: false })

export const OrganizationPlacementContributionSchema = Type.Union([
  SharedPlacementContributionSchema,
  DedicatedPlacementContributionSchema,
])

export type OrganizationPlacementContribution = Static<typeof OrganizationPlacementContributionSchema>

export const OrganizationCreationContributionSchema = Type.Object({
  organization_class: Type.Literal('customer'),
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  slug: Type.String({ minLength: 1, maxLength: 80 }),
  ownerUserId: RequiredIdentifierSchema,
  limits: OrganizationLimitsSchema,
  placement: OrganizationPlacementContributionSchema,
}, { additionalProperties: false })

export type OrganizationCreationContribution = Static<typeof OrganizationCreationContributionSchema>

export const OrganizationMutationActionSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('remove-member'),
    targetUserId: RequiredIdentifierSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('set-member-role'),
    targetUserId: RequiredIdentifierSchema,
    role: OrganizationRoleSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('suspend-member'),
    targetUserId: RequiredIdentifierSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('grant-membership'),
    targetUserId: RequiredIdentifierSchema,
    role: OrganizationRoleSchema,
    source: Type.Union([
      Type.Literal('customer_invitation'),
      Type.Literal('platform_bootstrap'),
      Type.Literal('platform_administration'),
    ]),
  }, { additionalProperties: false }),
])

export type OrganizationMutationAction = Static<typeof OrganizationMutationActionSchema>

export const OrganizationMutationPolicyInputSchema = Type.Object({
  actor: OrganizationPolicyActorSchema,
  organization: Type.Object({
    id: RequiredIdentifierSchema,
    organization_class: Type.Union([
      Type.Literal('customer'),
      Type.Literal('platform'),
    ]),
  }, { additionalProperties: false }),
  action: OrganizationMutationActionSchema,
}, { additionalProperties: false })

export type OrganizationMutationPolicyInput = Static<typeof OrganizationMutationPolicyInputSchema>

export const OrganizationMutationContributionSchema = Type.Object({
  authorized: Type.Literal(true),
  organizationId: RequiredIdentifierSchema,
  action: OrganizationMutationActionSchema,
}, { additionalProperties: false })

export type OrganizationMutationContribution = Static<typeof OrganizationMutationContributionSchema>

export const OrganizationPolicyErrorCodeSchema = Type.Union([
  Type.Literal('invalid-contract'),
  Type.Literal('authentication-required'),
  Type.Literal('authorization-required'),
  Type.Literal('platform-organization-reserved'),
  Type.Literal('protected-owner-mutation'),
  Type.Literal('platform-owner-invitation-forbidden'),
  Type.Literal('dedicated-placement-authorization-required'),
  Type.Literal('invalid-placement'),
])

export type OrganizationPolicyErrorCode = Static<typeof OrganizationPolicyErrorCodeSchema>

export class OrganizationPolicyError extends Error {
  readonly code: OrganizationPolicyErrorCode
  readonly path: string

  constructor(code: OrganizationPolicyErrorCode, message: string, path: string) {
    super(message)
    this.name = 'OrganizationPolicyError'
    this.code = code
    this.path = path
  }
}

export const DEFAULT_ORGANIZATION_LIMITS: OrganizationLimits = Object.freeze({
  members: 25,
  workspaces: 3,
  sites: 10,
})

const SHARED_PLACEMENT: OrganizationPlacementContribution = Object.freeze({
  placement_class: 'shared',
  placement_key: 'shared:launch',
})

function parseContract<T extends TSchema>(schema: T, input: unknown, path: string): Static<T> {
  const result = safeParseValue(schema, input)
  if (!result.ok) {
    throw new OrganizationPolicyError(
      'invalid-contract',
      `Organization policy contract is invalid at ${path}.`,
      path,
    )
  }
  return result.value
}

export function readOrganizationPolicyConfiguration(input: unknown): OrganizationPolicyConfiguration {
  return parseContract(OrganizationPolicyConfigurationSchema, input, 'configuration')
}

function authenticatedUserId(actor: OrganizationPolicyActor, capability: 'create' | 'manage'): string {
  if (actor.authentication.state !== 'authenticated') {
    throw new OrganizationPolicyError(
      'authentication-required',
      'Organization operations require an authenticated user.',
      'actor.authentication',
    )
  }

  const authorized = capability === 'create'
    ? actor.authorization.canCreateOrganizations
    : actor.authorization.canManageOrganizations
  if (!authorized) {
    throw new OrganizationPolicyError(
      'authorization-required',
      `Organization ${capability} authorization is required.`,
      'actor.authorization',
    )
  }

  return actor.authentication.userId
}

function placementContribution(
  request: OrganizationPlacementRequest | undefined,
): OrganizationPlacementContribution {
  if (!request) return SHARED_PLACEMENT

  if (request.placement_class === 'shared') {
    if (
      request.placement_key !== undefined
      && request.placement_key !== SHARED_PLACEMENT.placement_key
    ) {
      throw new OrganizationPolicyError(
        'invalid-placement',
        'Shared organizations use the launch shared placement.',
        'placement.placement_key',
      )
    }
    if (request.enterpriseAuthorization !== undefined) {
      throw new OrganizationPolicyError(
        'invalid-placement',
        'Enterprise authorization is only valid for dedicated placement.',
        'placement.enterpriseAuthorization',
      )
    }
    return SHARED_PLACEMENT
  }

  if (!request.enterpriseAuthorization) {
    throw new OrganizationPolicyError(
      'dedicated-placement-authorization-required',
      'Dedicated placement requires separately priced enterprise authorization.',
      'placement.enterpriseAuthorization',
    )
  }
  if (!request.placement_key || !request.placement_key.startsWith('dedicated:')) {
    throw new OrganizationPolicyError(
      'invalid-placement',
      'Dedicated placement requires a dedicated placement key.',
      'placement.placement_key',
    )
  }

  return Object.freeze({
    placement_class: 'dedicated',
    placement_key: request.placement_key,
    enterpriseAuthorization: Object.freeze({ ...request.enterpriseAuthorization }),
  })
}

export function authorizeOrganizationCreation(input: unknown): OrganizationCreationContribution {
  const request = parseContract(OrganizationCreationPolicyInputSchema, input, 'creation')
  const ownerUserId = authenticatedUserId(request.actor, 'create')

  if (request.organization.organization_class === 'platform') {
    throw new OrganizationPolicyError(
      'platform-organization-reserved',
      'The platform organization is reserved for platform bootstrap.',
      'organization.organization_class',
    )
  }

  return Object.freeze({
    organization_class: 'customer',
    displayName: request.organization.displayName,
    slug: request.organization.slug,
    ownerUserId,
    limits: DEFAULT_ORGANIZATION_LIMITS,
    placement: placementContribution(request.placement),
  })
}

function isProtectedOwnerMutation(
  action: OrganizationMutationAction,
  protectedOwnerUserId: string,
): boolean {
  if (action.targetUserId !== protectedOwnerUserId) return false
  if (action.kind === 'remove-member' || action.kind === 'suspend-member') return true
  return action.kind === 'set-member-role' && action.role !== 'owner'
}

export function authorizeOrganizationMutation(
  configurationInput: unknown,
  input: unknown,
): OrganizationMutationContribution {
  const configuration = readOrganizationPolicyConfiguration(configurationInput)
  const request = parseContract(OrganizationMutationPolicyInputSchema, input, 'mutation')
  authenticatedUserId(request.actor, 'manage')

  if (isProtectedOwnerMutation(request.action, configuration.protectedOwnerUserId)) {
    throw new OrganizationPolicyError(
      'protected-owner-mutation',
      'The configured protected owner cannot be removed, demoted, or suspended.',
      'action.targetUserId',
    )
  }

  const platformOrganization = request.organization.id === configuration.platformOrganizationId
    || request.organization.organization_class === 'platform'
  if (
    platformOrganization
    && request.action.kind === 'grant-membership'
    && request.action.role === 'owner'
    && request.action.source === 'customer_invitation'
  ) {
    throw new OrganizationPolicyError(
      'platform-owner-invitation-forbidden',
      'Customer invitation paths cannot grant platform owner membership.',
      'action.source',
    )
  }

  return Object.freeze({
    authorized: true,
    organizationId: request.organization.id,
    action: Object.freeze({ ...request.action }),
  })
}
