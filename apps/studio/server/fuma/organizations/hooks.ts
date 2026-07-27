import {
  authorizeOrganizationCreation,
  authorizeOrganizationMutation,
  readOrganizationPolicyConfiguration,
  type OrganizationCreationContribution,
  type OrganizationMutationContribution,
  type OrganizationPolicyConfiguration,
} from './policy'

export type OrganizationBootstrapContribution = Readonly<{
  organization: Readonly<{
    id: string
    organization_class: 'platform'
    reserved: true
  }>
  ownerMembership: Readonly<{
    userId: string
    role: 'owner'
    protected: true
    source: 'platform_bootstrap'
  }>
}>

export type OrganizationPolicyHooks = Readonly<{
  bootstrap: () => OrganizationBootstrapContribution
  create: (input: unknown) => OrganizationCreationContribution
  mutate: (input: unknown) => OrganizationMutationContribution
}>

function bootstrapContribution(
  configuration: OrganizationPolicyConfiguration,
): OrganizationBootstrapContribution {
  return Object.freeze({
    organization: Object.freeze({
      id: configuration.platformOrganizationId,
      organization_class: 'platform',
      reserved: true,
    }),
    ownerMembership: Object.freeze({
      userId: configuration.protectedOwnerUserId,
      role: 'owner',
      protected: true,
      source: 'platform_bootstrap',
    }),
  })
}

export function createOrganizationPolicyHooks(
  configurationInput: unknown,
): OrganizationPolicyHooks {
  const configuration = readOrganizationPolicyConfiguration(configurationInput)

  return Object.freeze({
    bootstrap: () => bootstrapContribution(configuration),
    create: (input: unknown) => authorizeOrganizationCreation(input),
    mutate: (input: unknown) => authorizeOrganizationMutation(configuration, input),
  })
}
