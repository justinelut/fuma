# Fuma Permissions

This reference defines Fuma's permission contracts, composed catalog, launch-persona matrices, layered resolution order, and authorization boundaries.

FUMA permissions combine a fixed management catalog with permissions contributed by the site's active capabilities. `src/core/fuma/permissionContracts.ts` owns the TypeBox contracts, `src/core/fuma/permissionCatalog.ts` owns composition and launch defaults, and `server/fuma/permissions/resolver.ts` resolves one immutable decision snapshot for an exact actor and site hierarchy.

---

## TL;DR

- The public contracts and catalog are exported from `@core/fuma` through `src/core/fuma/index.ts`.
- Every permission defaults to deny. A permission must be active, have an applicable membership, survive lifecycle gates, and then be allowed by the precedence rules.
- The five launch personas are `protected-owner`, `owner`, `admin`, `member`, and `viewer`; grants strictly narrow in that order.
- Platform and support authority belongs only to `protected-owner`. Customer roles cannot synthesize it.
- Website and Publication differences come only from `FumaRegistry.compose(...)`; the catalog and resolver do not branch on profile IDs.
- Explicit deny outranks explicit grant. Protected-owner invariants outrank both, but an unavailable capability still fails closed first.
- Custom roles can use only the catalog's customer-assignable ceiling and can inherit only `admin`, `member`, or `viewer`.
- FUMA-021 supplies immutable request context to authorization callers. FUMA-025 scopes repository operations to that authorized context.
- The exhaustive executable specification is `src/__tests__/fuma/permissionRoleMatrix.test.ts`.

## Architecture

```text
src/core/fuma/registry.ts
  FumaRegistry.compose(profileId, capabilityOverrides)
                │
                ▼
src/core/fuma/permissionCatalog.ts
  core management permissions + active capability permissions
                │
                ▼
server/fuma/permissions/resolver.ts
  exact actor + platform/org/workspace/site chain + assignments + overrides
                │
                ▼
  immutable allow/deny decisions with precedence, source, and reason
```

The registry composition in `src/core/fuma/registry.ts` is the only profile-selection step. `composePermissionCatalog` in `src/core/fuma/permissionCatalog.ts` consumes `ComposedProductProfile.capabilities` and adds every declared permission as site-scoped customer authority. Unknown extension permissions remain deny-by-default unless an explicit capability default, custom role, or permission override grants them. A capability default declared for one persona also grants that permission to every stronger persona, preserving the launch hierarchy (`viewer ⊂ member ⊂ admin ⊂ owner ⊂ protected-owner`).

`resolveLayeredPermissions` in `server/fuma/permissions/resolver.ts` resolves the full registered permission universe. Active catalog permissions enter role resolution; permissions belonging to registered but inactive capabilities receive an immutable `capability-disabled` denial. The output records active capabilities, every decision, and ordered allowed/denied ID lists.

## Public contracts

Import permission contracts and catalog APIs through the canonical barrel:

```ts
import {
  FUMA_BASE_PERMISSION_CATALOG,
  LAUNCH_PERMISSION_PERSONAS,
  PERMISSION_RESOLUTION_PRECEDENCE,
  PermissionCatalogSchema,
  PermissionResolverInputSchema,
  assertCustomRolePermissions,
  composePermissionCatalog,
} from '@core/fuma'
```

`src/core/fuma/permissionContracts.ts` defines strict TypeBox schemas for subjects, ownership scopes, assignments, explicit overrides, custom roles, capability availability, protected-owner invariants, and allow/deny decisions. `src/core/fuma/permissionCatalog.ts` defines catalog entries, default grants, authority classes, composition, and custom-role ceiling validation. The schemas are the source of truth; exported types are derived from them.

The layered server input in `server/fuma/permissions/resolver.ts` adds current organization/workspace/site records and lifecycle status to the public per-permission contract. It validates exact ancestry before policy evaluation.

## Resource scopes

Every ownership scope carries its complete ancestor chain. A child ID without its owning parent IDs is not a valid authorization resource.

| Scope | Required coordinates | Management resources |
|---|---|---|
| Platform | `platformId` | organizations, platform roles/settings, support |
| Organization | `platformId`, `organizationId` | organization identity, members, workspace creation |
| Workspace | platform + organization + `workspaceId` | workspace identity, members, site creation |
| Site | platform + organization + workspace + `siteId` | site identity, members, profile, capability resources |

Assignments inherit downward only where the assignment scope can own the permission resource. A site assignment cannot grant an organization permission. The nearest applicable assignment supplies launch-persona or custom-role policy. An explicit grant without any applicable membership still fails with `membership-required`.

The layered resolver repeats `platformId` on the authoritative organization, workspace, and site records and checks every copy against `scope.platformId`; workspace and site records also repeat their complete parent chain. A structurally valid record from another platform therefore fails with `scope-mismatch` before catalog policy runs.

## Resolution precedence

The public per-permission order is frozen as `PERMISSION_RESOLUTION_PRECEDENCE` in `src/core/fuma/permissionContracts.ts`:

| Rank | Stage | Result |
|---:|---|---|
| 1 | Capability unavailable | Deny when the capability is disabled or the permission is undeclared |
| 2 | Protected-owner invariant | Allow the invariant's active permission for its exact subject/platform |
| 3 | Explicit deny | Deny regardless of a broader/narrower explicit grant or role default |
| 4 | Explicit grant | Allow before custom-role or launch-persona defaults |
| 5 | Custom role | Apply role overrides over its base persona |
| 6 | Launch persona | Apply the composed catalog's default grants |
| 7 | Default deny | Deny when no prior stage grants authority |

`resolveLayeredPermissions` adds three outer gates in `server/fuma/permissions/resolver.ts`:

1. **Applicable membership:** no applicable role assignment means `membership-required`, even if an orphan explicit grant exists.
2. **Lifecycle:** suspended/archived organizations and archived workspaces/sites deny mutations while preserving reads. Lifecycle denial occurs before persona and override policy.
3. **Protected internal authority:** catalog entries classified as `platform`, `support`, or `protected-owner` require the matching platform-scoped protected-owner assignment and invariant. A customer persona or explicit grant receives `default-deny`; it cannot manufacture internal-console authority.

A permission action named `read` or `access` is read-only for lifecycle gating. Other actions are mutations. Platform mutations are not controlled by descendant customer lifecycle state.

## Management matrix

`A` means the launch persona receives the permission by default; `D` means deny. This matrix is identical for Website and Publication because management permissions come from `FUMA_BASE_PERMISSION_CATALOG` in `src/core/fuma/permissionCatalog.ts`.

| Scope | Permission | Protected owner | Owner | Admin | Member | Viewer |
|---|---|:---:|:---:|:---:|:---:|:---:|
| Platform | `platform.organizations.read` | A | D | D | D | D |
| Platform | `platform.organizations.manage` | A | D | D | D | D |
| Platform | `platform.roles.manage` | A | D | D | D | D |
| Platform | `platform.settings.read` | A | D | D | D | D |
| Platform | `platform.settings.write` | A | D | D | D | D |
| Platform | `support.access` | A | D | D | D | D |
| Platform | `support.organizations.read` | A | D | D | D | D |
| Platform | `support.sessions.revoke` | A | D | D | D | D |
| Organization | `organization.read` | A | A | A | A | A |
| Organization | `organization.update` | A | A | A | D | D |
| Organization | `organization.delete` | A | A | D | D | D |
| Organization | `organization.members.read` | A | A | A | D | D |
| Organization | `organization.members.manage` | A | A | D | D | D |
| Organization | `organization.workspaces.create` | A | A | A | D | D |
| Workspace | `workspace.read` | A | A | A | A | A |
| Workspace | `workspace.update` | A | A | A | D | D |
| Workspace | `workspace.delete` | A | A | D | D | D |
| Workspace | `workspace.members.read` | A | A | A | D | D |
| Workspace | `workspace.members.manage` | A | A | D | D | D |
| Workspace | `workspace.sites.create` | A | A | A | D | D |
| Site | `site.read` | A | A | A | A | A |
| Site | `site.update` | A | A | A | A | D |
| Site | `site.delete` | A | A | D | D | D |
| Site | `site.members.read` | A | A | A | D | D |
| Site | `site.members.manage` | A | A | D | D | D |
| Site | `site.profile.manage` | A | A | A | D | D |

The customer-persona subsets are strict: viewer ⊂ member ⊂ admin ⊂ owner. Protected owner additionally owns platform, support, and protected policy authority.

Platform settings deliberately share one `platform.settings` resource: read is platform authority and write is protected-owner authority. `resourceAuthoritiesAreCompatible(...)` permits only that platform/protected-owner combination at platform scope; customer, support, descendant-scope, and capability resource collisions still fail closed.

## Website capability matrix

All capability permissions are site-scoped customer authority. Website contributes 11 active permissions through `src/core/fuma/launchProfiles.ts`.

| Permission | Protected owner | Owner | Admin | Member | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| `site.home.read` | A | A | A | A | A |
| `website.content.read` | A | A | A | A | A |
| `content.pages.read` | A | A | A | A | A |
| `content.pages.write` | A | A | A | A | D |
| `website.data.read` | A | A | A | A | A |
| `website.media.read` | A | A | A | A | A |
| `website.analytics.read` | A | A | A | A | A |
| `website.design.read` | A | A | A | A | A |
| `website.design.write` | A | A | A | D | D |
| `site.settings.read` | A | A | A | A | A |
| `site.settings.write` | A | A | A | D | D |

Combined with the 26 management permissions, the deterministic Website matrix has 37 rows.

## Publication capability matrix

Publication contributes 15 active permissions through `src/core/fuma/launchProfiles.ts`. Shared pages, design, home, and settings permissions retain the same policy as Website.

| Permission | Protected owner | Owner | Admin | Member | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| `site.home.read` | A | A | A | A | A |
| `content.pages.read` | A | A | A | A | A |
| `content.pages.write` | A | A | A | A | D |
| `publication.posts.read` | A | A | A | A | A |
| `publication.posts.write` | A | A | A | A | D |
| `publication.posts.schedule` | A | A | A | D | D |
| `publication.tags.read` | A | A | A | A | A |
| `publication.members.read` | A | A | A | A | A |
| `publication.newsletters.read` | A | A | A | A | A |
| `publication.newsletters.send` | A | A | D | D | D |
| `publication.analytics.read` | A | A | A | A | A |
| `website.design.read` | A | A | A | A | A |
| `website.design.write` | A | A | A | D | D |
| `site.settings.read` | A | A | A | A | A |
| `site.settings.write` | A | A | A | D | D |

Combined with management permissions, the deterministic Publication matrix has 41 rows.

## Profile differences and cross-profile grants

Website-only launch permissions are `website.content.read`, `website.data.read`, `website.media.read`, and `website.analytics.read`. Publication-only launch permissions cover posts, scheduling, tags, members, newsletters, and publication analytics. Permissions from registered but inactive capabilities remain present in layered output as `capability-disabled` denials.

Profiles are defaults, not capability walls. A Website can grant `publication.editorial.schedule`; dependency closure also activates the editorial capability and contributes `publication.posts.read`, `publication.posts.write`, and `publication.posts.schedule`. A Publication can grant `website.data` and receive `website.data.read`. `FUMA_CAPABILITY_PERMISSION_DEFAULT_PERSONAS` in `src/core/fuma/permissionCatalog.ts` applies the same permission-ID policy regardless of which profile activated the capability.

```ts
const websiteWithScheduling = fumaLaunchRegistry.compose('website', {
  grant: ['publication.editorial.schedule'],
  revoke: [],
})

const catalog = composePermissionCatalog(websiteWithScheduling)
```

Do not branch on `profileId` in permission composition or resolution.

## Custom roles

A custom role in `src/core/fuma/permissionContracts.ts` has:

- an owning resource scope;
- a base persona of only `admin`, `member`, or `viewer`;
- one or more assignable scope kinds that are not broader than its owning scope;
- explicit grant and deny lists with no overlap.

`assertCustomRolePermissions` in `src/core/fuma/permissionCatalog.ts` checks every referenced permission against the exact composed catalog. The custom-role ceiling contains customer permissions marked `assignableToCustomRoles`; it excludes platform, support, protected-owner, and owner-only management authority such as organization deletion, membership management, and site deletion. Active capability permissions are customer-assignable unless their catalog definition says otherwise.

A custom role cannot inherit `owner` or `protected-owner`, refer to an unknown permission, alter a permission from a scope too narrow to own it, or escape the active catalog's ceiling. Scope ownership is checked when the role is defined, and the assignment scope is checked again when the layered resolver applies it.

## Protected-owner invariants

A protected-owner assignment is valid only at platform scope and only with a matching `ProtectedOwnerInvariant` for the exact subject and platform. The invariant lists permissions that cannot be removed by explicit deny. `server/fuma/permissions/resolver.ts` also rejects descendant role assignments that would demote the protected owner inside the reserved platform organization.

Internal-console authority is server-owned. Customer launch roles, custom roles, site permission grants, and explicit overrides cannot grant any catalog entry whose authority is `platform`, `support`, or `protected-owner`. Registered inactive capability permissions are also checked for collisions with core IDs; a collision fails catalog construction instead of being masked by the active core entry. Capability-contributed permissions are always site-scoped customer authority, and capability composition rejects the reserved `admin`, `console`, `internal`, `organization`, `platform`, `protected-owner`, `support`, and `workspace` resource namespaces. Customer invitation contracts admit only customer roles and organization policy separately protects the reserved platform owner. Transfer collaborator manifests admit only customer roles; their capability snapshot is server-captured and must recompose through the registered capability registry, so neither role strings nor manifest capability IDs can manufacture internal authority.

The invariant does not activate capabilities. Capability unavailability is rank 1, so an invariant that names a registered permission from an inactive capability still receives `capability-disabled`. Lifecycle gates also protect suspended or archived customer resources before role policy.

## Request and repository boundaries

This module resolves authorization facts; it does not establish request identity or retrofit tenant filters into persistence.

- **FUMA-021** supplies the immutable request context: authenticated actor plus exact platform, organization, workspace, and site ownership chain. Callers build resolver input from that trusted context rather than client-provided IDs. See `docs/reference/fuma-stable-context.md`.
- **FUMA-025** scopes repository operations to the authorized context. Permission checks do not replace organization/workspace/site predicates in repository reads and writes; repository scoping prevents cross-tenant substitution after authorization.

Authorization and data isolation are both required. A permission decision without immutable context is not authoritative, and an authorized handler using an unscoped repository operation is not tenant-safe.

## Deterministic matrix output

`src/__tests__/fuma/permissionRoleMatrix.test.ts` constructs a JSON-safe demo object without timestamps or environment-dependent values:

```json
{
  "schemaVersion": 1,
  "personaOrder": ["protected-owner", "owner", "admin", "member", "viewer"],
  "profiles": [
    {
      "profileId": "website",
      "activePermissionIds": ["platform.organizations.read"],
      "rows": [
        {
          "permissionId": "platform.organizations.read",
          "scopeKind": "platform",
          "source": "core",
          "decisions": {
            "protected-owner": "allow",
            "owner": "deny",
            "admin": "deny",
            "member": "deny",
            "viewer": "deny"
          }
        }
      ]
    }
  ]
}
```

The excerpt shows the shape; the test fixture emits all 37 Website rows and all 41 Publication rows in catalog order. A later command can serialize this structure directly for demos or fixture comparison.

## Forbidden patterns

- Do not import `@core/fuma/permissionContracts` or `@core/fuma/permissionCatalog` outside the module; import through `@core/fuma`.
- Do not grant on an unknown or inactive permission.
- Do not treat a profile preset as an authorization boundary; active capabilities define availability.
- Do not let explicit grant outrank explicit deny.
- Do not assign platform/support/owner-only authority to custom roles.
- Do not accept resource IDs from a request body as authorization context; FUMA-021 owns immutable context.
- Do not rely on permission resolution instead of repository ownership predicates; FUMA-025 owns repository scoping.

## Verification

Focused permission acceptance and the structural authority gate run with:

```sh
bun test src/__tests__/fuma/permissionCatalog.test.ts src/__tests__/fuma/permissionContracts.test.ts src/__tests__/fuma/permissionRoleMatrix.test.ts src/__tests__/fuma/layeredPermissionResolver.test.ts
bun test src/__tests__/architecture/fuma-authority-boundaries.test.ts
```

The repository-wide completion gate remains `bun test`, `bun run build`, and `bun run lint`.

## Related

- `docs/reference/fuma-platform-architecture.md` — hierarchy, tenancy, and task ownership boundaries.
- `docs/reference/fuma-profiles.md` — capability registry and profile composition.
- `docs/reference/fuma-stable-context.md` — FUMA-021 immutable request-context seam.
- Source contracts: `src/core/fuma/permissionContracts.ts`.
- Source catalog: `src/core/fuma/permissionCatalog.ts`.
- Layered resolver: `server/fuma/permissions/resolver.ts`.
- Exhaustive specification: `src/__tests__/fuma/permissionRoleMatrix.test.ts`.
