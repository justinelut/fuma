# Fuma Profiles and Capabilities

FUMA-004 defines the pure product-composition contracts used by Fuma. The canonical public API is `@core/fuma`, backed by TypeBox schemas in `src/core/fuma/contracts.ts`, registry validation in `src/core/fuma/registry.ts`, and the two launch presets in `src/core/fuma/launchProfiles.ts`.

This module is declarative and shared. It does not persist site assignments, start web/worker/scheduler roles, mount routes, render navigation, execute jobs or transfers, or implement Publication domain behavior. Those responsibilities belong to later FUMA tasks.

## Composition model

A `ProductProfile` is a default capability preset plus explicit ordering for its navigation, onboarding, and starter-template contributions. A `CapabilityDefinition` may contribute:

- navigation entries;
- onboarding steps;
- starter-template references;
- permission definitions;
- routes;
- job handler references;
- ownership-transfer step references.

Profiles are defaults, not capability walls. `FumaRegistry.compose(profileId, overrides)` resolves the profile preset, applies explicit grants and revocations, closes capability dependencies, then returns an immutable `ComposedProductProfile`. Shared composition performs map lookups and dependency traversal; it does not branch on launch profile names.

All data contracts are TypeBox schemas and exported types are derived with `Static<typeof Schema>`. Objects reject undeclared properties. In particular, contributions cannot contain `profileId`, `profiles`, or callback selectors: product-specific selection belongs in profile registration, not shared route, permission, persistence, or navigation decisions.

## Launch presets

### Website

Website preserves the visual-site product shape through reusable home, content, pages, data, media, analytics, design, and settings capabilities. Its declarations include navigation, onboarding, starter templates, permissions, routes, publishing work, and transfer references. They are metadata only; FUMA-004 does not mount or execute them.

### Publication

Publication has the exact subtitle:

> Blog, magazine, newsletter, or newsroom

Its composed navigation is exactly, in order:

1. Home
2. Posts
3. Pages
4. Tags
5. Members
6. Newsletters
7. Analytics
8. Design
9. Settings

Publication composes the shared pages and design capabilities with editorial, scheduling, tags, members, newsletters, newsletter sending, and publication analytics. Design remains part of the preset; later shell work may collapse its presentation but must not remove the capability.

No future profile is declared or reserved here.

## Registry guarantees

Construction validates the complete registry before it can be used:

- capability, profile, and contribution IDs are unique;
- capability dependencies and conflicts refer to registered IDs;
- repeated, self-referential, missing, cyclic, and mutually active conflicting dependencies are rejected;
- profile contribution presets refer only to contributions supplied by their default capabilities;
- route method/path pairs are unique, including equivalent parameter routes such as `/posts/:id` and `/posts/:slug`;
- every declaration conforms to its strict TypeBox contract.

Composition rejects malformed override envelopes, duplicate override IDs, unknown capabilities, simultaneous grant/revoke, active conflicts, and revocation of a dependency still required by an active capability. Redundant grants are valid, which lets fixture and persisted override sets remain declarative.

Errors use `FumaRegistryError` and one of the stable codes `duplicate-id`, `dependency-collision`, `route-collision`, `invalid-definition`, `invalid-capability-override`, or `unknown-profile`.

## Cross-profile grants

A capability is independently reusable regardless of the profile that includes it by default:

```ts
import { fumaLaunchRegistry } from '@core/fuma'

const siteProduct = fumaLaunchRegistry.compose('website', {
  grant: ['publication.editorial.schedule'],
  revoke: [],
})
```

The resolver includes `publication.editorial.schedule`, closes its `publication.editorial` dependency, and adds the contributed Posts navigation, permissions, routes, job reference, starter template, and transfer reference. No shared core switch or profile edit is needed.

The focused proof is `src/__tests__/fuma/profileRegistry.test.ts`. It also composes overrides emitted by the FUMA-002 fixture contract.

## Boundaries

FUMA-004 intentionally does not provide:

- site/profile persistence or hosted schema;
- request context, tenant routing, authorization resolution, or UI guards;
- web, worker, or scheduler process roles;
- route mounting or job/transfer execution;
- onboarding UI or starter-template application;
- Publication content, member, newsletter, or analytics runtime behavior;
- speculative profile contracts.

Related policy: `docs/reference/fuma-platform-architecture.md`. Reusable tenant fixtures: `docs/reference/fuma-test-fixtures.md`.
