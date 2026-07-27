# Fuma Organization Policy

This reference defines how services authorize organization creation and membership mutation, and how they consume declarative organization bootstrap and creation contributions.

The source of truth is `server/fuma/organizations/policy.ts`. It validates unknown inputs with TypeBox and returns policy data; `server/fuma/organizations/hooks.ts` binds one explicit configuration without storing global state.

---

## TL;DR

- `authorizeOrganizationCreation` requires an authenticated actor with explicit organization-creation authorization.
- Customer creation cannot create the reserved platform organization.
- `authorizeOrganizationMutation` prevents removal, demotion, or suspension of the configured protected owner.
- A customer invitation cannot grant owner membership in the platform organization.
- Default customer creation emits finite launch limits with `placement_class: 'shared'` and `placement_key: 'shared:launch'`.
- Dedicated placement is accepted only with an explicit separately priced enterprise authorization object. The contribution is placement metadata, not an infrastructure allocation.
- `createOrganizationPolicyHooks` returns instance-scoped bootstrap, create, and mutation functions. It has no singleton and no product-profile branch.

## Contracts

All policy types derive from exported TypeBox schemas in `server/fuma/organizations/policy.ts`:

| Schema | Purpose |
|---|---|
| `OrganizationPolicyConfigurationSchema` | Identifies the reserved platform organization and configured protected owner. |
| `OrganizationCreationPolicyInputSchema` | Defines the actor, requested organization class and optional placement request. |
| `OrganizationCreationContributionSchema` | Defines the data a creation service may persist after authorization. |
| `OrganizationMutationPolicyInputSchema` | Defines membership removal, role, suspension, and membership-grant requests. |
| `OrganizationMutationContributionSchema` | Carries an authorized mutation to the consuming service. |
| `EnterprisePlacementAuthorizationSchema` | Proves dedicated placement is enterprise-approved and separately priced. |

The policy entries accept `unknown`, validate it, and throw `OrganizationPolicyError` with a typed `code` and `path` when a contract or policy check fails. Services do not cast request data into these types.

## Creation flow

A creation service calls `authorizeOrganizationCreation` before persistence:

```ts
const contribution = authorizeOrganizationCreation(requestBody)

await organizationRepository.create(contribution)
```

The returned contribution owns the policy defaults. With no placement request it contains:

```ts
{
  limits: { members: 25, workspaces: 3, sites: 10 },
  placement: {
    placement_class: 'shared',
    placement_key: 'shared:launch',
  },
}
```

Every limit is a finite positive integer. The owner comes from the authenticated actor rather than from a caller-supplied owner identifier. A request with `organization_class: 'platform'` is rejected; only the bootstrap hook can describe the reserved platform organization.

## Mutation flow

`authorizeOrganizationMutation` receives explicit policy configuration and an unknown request. It requires authenticated organization-management authorization before returning an `OrganizationMutationContribution`.

For `protectedOwnerUserId`, the following actions are rejected:

- `remove-member`;
- `set-member-role` to any role other than `owner`;
- `suspend-member`.

The mutation policy also rejects `grant-membership` when all three platform-owner invitation facts are present: the target organization is the platform organization, the requested role is `owner`, and the source is `customer_invitation`. Platform bootstrap and explicit platform administration remain distinct contribution sources.

## Placement guard

Dedicated placement is policy metadata. An accepted request contains all of these positive facts:

```ts
{
  placement_class: 'dedicated',
  placement_key: 'dedicated:enterprise-contract-42',
  enterpriseAuthorization: {
    kind: 'enterprise_dedicated_placement',
    authorizationId: 'enterprise-contract-42',
    approvedByUserId: 'user-platform-billing',
    enterpriseApproved: true,
    separatelyPriced: true,
  },
}
```

Missing authorization, a non-dedicated placement key, or enterprise authorization attached to shared placement is rejected. The resulting contribution never allocates or names a customer database, Redis instance, MinIO bucket, edge allocation, web process, worker, or scheduler. Resource composition remains pooled and is outside the organization policy contract, as required by `docs/reference/fuma-platform-architecture.md`.

## Declarative hooks

`createOrganizationPolicyHooks(configuration)` in `server/fuma/organizations/hooks.ts` validates and closes over one configuration. Each call returns an independent frozen hook object:

- `bootstrap()` describes the reserved platform organization and protected owner membership;
- `create(input)` returns an authorized customer-creation contribution;
- `mutate(input)` returns an authorized mutation contribution.

The hooks do not write to repositories, allocate infrastructure, inspect product profiles, or retain module-global mutable state. Composition roots construct them and services consume their returned data.

## Forbidden patterns

- Creating an organization for an anonymous actor or an actor without the explicit authorization bit.
- Accepting `organization_class: 'platform'` through customer creation.
- Trusting a caller-supplied customer owner instead of the authenticated actor.
- Removing, demoting, or suspending the configured protected owner.
- Granting platform owner membership from `customer_invitation`.
- Treating dedicated placement as a default or accepting it without the separately priced enterprise authorization object.
- Adding per-customer resource handles or allocation commands to a placement contribution.
- Introducing a global organization-policy singleton or branching hooks on Website/Publication profile identifiers.

## Related

- `docs/reference/fuma-platform-architecture.md` — hierarchy, pooled topology, and guarded dedicated placement policy.
- `docs/reference/typebox-patterns.md` — TypeBox boundary-validation patterns.
- Source-of-truth policy: `server/fuma/organizations/policy.ts`
- Hook factory: `server/fuma/organizations/hooks.ts`
- Contract tests: `src/__tests__/fuma/organizationPolicy.test.ts`
- Architecture gate: `src/__tests__/architecture/fuma-platform-architecture.test.ts`
