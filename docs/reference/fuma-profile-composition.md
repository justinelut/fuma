# Fuma Profile Composition UI

This reference describes how resolved Fuma profile onboarding and navigation models reach reusable hosted admin UI without moving composition policy into React.

`src/core/fuma/onboarding.ts` and `src/core/fuma/navigation.ts` resolve the models. `src/admin/fuma/ProfileOnboarding.tsx` and `src/admin/fuma/ProfileNavigation.tsx` only present those results and report typed user intent to their host.

---

## TL;DR

- Compose navigation with `composeProfileNavigation(...)`, then pass its complete output to `<ProfileNavigation entries={...} />`.
- Resolve onboarding with `resolveProfileOnboarding(...)`, then pass its complete state to `<ProfileOnboarding state={...} />`.
- React does not branch on profile IDs, filter permissions, inspect capabilities, fetch assignments, persist progress, or mount routes.
- The onboarding action emits a `CompleteProfileOnboardingStepCommand`; the host applies and persists it through the onboarding engine.
- Durable progress contains the completed prefix and resume cursor. Replaying an already-completed command is idempotent in `completeProfileOnboardingStep(...)`.
- FUMA-018 owns site/profile context selection and switcher UI. FUMA-021 owns workspace route/context mounting.

## Composition flow

The reusable boundary keeps policy in the core composition layer:

```text
profile assignment + overrides + permissions
                 │
                 ├─ resolveProfileOnboarding(...) ── ProfileOnboardingState
                 │                                      │
                 │                                      └─ <ProfileOnboarding />
                 │
                 └─ composeProfileNavigation(...) ── ProfileNavigationOutput
                                                        │
                                                        └─ <ProfileNavigation />
```

The core API is exported from `src/core/fuma/index.ts`. The UI API is exported from `src/admin/fuma/index.ts`. Core files do not import the admin module, so the barrel does not create an engine-to-React dependency cycle. Every onboarding assignment, progress record, and completion command carries the full `organizationId → workspaceId → siteId` scope because site IDs may intentionally collide across workspaces.

### Navigation

`composeProfileNavigation(...)` in `src/core/fuma/navigation.ts` composes the assigned profile and capability overrides, validates collisions and ordering, and removes entries whose required permission is absent or denied. `ProfileNavigation` accepts only the resulting `ProfileNavigationOutput`; it does not accept a registry, profile ID, permission map, or route catalog.

Each approved entry is rendered with `Link` from `src/admin/lib/routing`. `currentPath` controls only `aria-current` presentation, and the optional typed `onNavigate(entry)` callback reports the selected approved entry. The component does not mount or resolve the entry's route.

### Onboarding

`resolveProfileOnboarding(...)` in `src/core/fuma/onboarding.ts` returns ordered composed steps, durable progress, the current step ID, and the completed state. `ProfileOnboarding` renders exactly those steps. It shows the completed count, the durable resume cursor, current/completed/upcoming states, and a completed summary.

Only the current step is actionable. The action is hidden when there is no current step or no `onCompleteStep` handler, so completed and unavailable steps never receive inert controls. The callback receives a `CompleteProfileOnboardingStepCommand` built from the state's site ID, profile ID, composition fingerprint, and current step ID.

## Resume and idempotency seam

Persistence stays outside React. The hosting flow is:

1. Load the assigned site profile, capability overrides, and optional `ProfileOnboardingProgress`.
2. Call `resolveProfileOnboarding(...)` from `src/core/fuma/onboarding.ts`.
3. Render the returned state with `ProfileOnboarding`.
4. On `onCompleteStep(command)`, call `completeProfileOnboardingStep(...)` and persist the returned `state.progress` atomically with the owning host operation.
5. Render the returned state or resolve it again from the durable progress after navigation/reload.

The engine validates that progress belongs to the same organization, workspace, site, profile, and composition fingerprint. This prevents a colliding lower-scope site ID from resuming another tenant's onboarding. Completed IDs must be the ordered prefix ending at `progress.cursor`. A replay of a command for an already-completed step returns the same resolved state, while unavailable and out-of-order commands fail closed. The component does not duplicate those checks.

Starter-template side effects use the transaction-bound service in `server/fuma/onboarding/starterTemplates.ts`; they are not executed by `ProfileOnboarding`.

## Mounting boundaries

These components intentionally do not form a hosted shell by themselves:

- FUMA-018 supplies the active site/profile context and owns profile or site switchers. Do not add selectors, assignment fetches, or profile labels to `ProfileNavigation.tsx` or `ProfileOnboarding.tsx`.
- FUMA-021 mounts composed workspace routes and supplies route/site context. A navigation contribution is presentation metadata here, not proof that a route has been mounted.
- Route handlers, persistence, and permission resolution stay outside both components.

This separation allows Website, Publication, and registry-injected profiles to use the same components without adding profile-name branches or route arrays to React.

## Forbidden patterns

- Do not branch on `website`, `publication`, or another profile ID in `src/admin/fuma/`.
- Do not hardcode navigation labels, paths, onboarding titles, or step order in the components.
- Do not pass unfiltered registry contributions directly to `ProfileNavigation`; call `composeProfileNavigation(...)` first.
- Do not re-filter permissions or capabilities in React.
- Do not fetch assignments, persist progress, execute templates, mount routes, or implement switchers in these presentational components.
- Do not render raw admin anchors or action buttons; use the in-house `Link` and shared `Button` primitives.

## Related

- `docs/reference/fuma-profiles.md` — capability and profile registry composition
- `docs/reference/fuma-sites.md` — durable owned-site profile assignments
- `docs/reference/fuma-workspaces.md` — workspace boundary and FUMA-021 composition seam
- `src/core/fuma/onboarding.ts` — onboarding contracts, resume validation, completion, and replay behavior
- `src/core/fuma/navigation.ts` — ordered permission-filtered navigation composition
- `src/admin/fuma/` — reusable profile UI source of truth
- `src/__tests__/admin/fumaProfileCompositionUI.test.tsx` — Website/Publication UI composition and callback coverage
- `src/__tests__/architecture/fuma-platform-architecture.test.ts` — profile-decision and platform boundary gates
