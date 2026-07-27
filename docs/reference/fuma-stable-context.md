# Fuma Stable Admin Context

This reference describes how hosted admin URLs select an organization, workspace, site, and composed profile shell without trusting browser preference as authority.

`src/core/fuma/selection.ts` owns context contracts and resolution. `src/admin/router.tsx`, `src/admin/AdminEntry.tsx`, and `src/admin/preauth/HostedStaffShell.tsx` mount that model only when hosted staff mode is selected.

---

## TL;DR

- A selected site is addressed by the complete `organizationId → workspaceId → siteId` chain; lower-scope IDs are not globally unique.
- Hosted routes use `/admin/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId` plus an optional profile-relative suffix. Invitations use `/admin/invitations/:invitationId`.
- `src/admin/router.tsx` declares those patterns only in hosted mode. Every existing self-hosted route and the final `/admin/*` redirect remain unchanged.
- The live in-house-router pathname is authoritative. An explicit scoped URL always beats local browser preference.
- `fuma-scoped-context-v1` stores only the last ready selection. Stale, corrupt, suspended, archived, missing, and invitation resolutions do not become authority.
- FUMA-021 now provides the immutable server request/job context in `server/fuma/context/`. The browser catalog projection is still an optional TypeBox-checked composition seam; production defaults to an empty catalog until a production scoped-repository adapter supplies that projection.
- `FumaScopedShell` composes profile-neutral navigation/onboarding, renders `FumaContextSwitchers`, and exposes a read-only managed-client view only when the authorized catalog contains managed workspace links. React does not branch on Website or Publication IDs.
- Managed-client rows open normal canonical site contexts. Custom offers, internal grants, billing, pricing, quotas, payment, and transfer recovery remain outside the app view and belong to `admin.fuma.co.ke` owners.
- This integration mounts no server handlers and reads no caller-supplied headers.

## Route shape

The browser routes are declared in `src/admin/router.tsx`:

```text
/admin/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId
/admin/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId/*
/admin/invitations/:invitationId
```

`FUMA_SCOPED_ADMIN_ROUTE`, `FUMA_SCOPED_ADMIN_SUBPATH_ROUTE`, and `FUMA_INVITATION_ADMIN_ROUTE` export the exact router patterns. They are conditional on `hostedStaffAuthSelected()` from `src/admin/preauth/hostedStaffAuth.ts`. In hosted mode, existing unscoped admin entries also receive the same validated catalog seam so `/admin/dashboard`, `/admin/site`, and peer routes can restore the last ready selection. In self-hosted mode the route list remains the established dashboard/site/content/data/media/plugins/users/AI/account table followed by `/admin/*`.

Canonical concrete URLs come from `buildScopedAdminUrl(...)` and `buildInvitationAdminUrl(...)` in `src/core/fuma/selection.ts`. `parseScopedAdminUrl(...)` accepts only the complete canonical tenant chain or an invitation entry. Partial organization/workspace/site paths do not infer ownership.

The wildcard suffix represents a validated profile-relative `/admin` subpath. `validateProfileRelativeSubpath(...)` rejects paths that escape that shell. Switch targets preserve the validated suffix, not arbitrary URL text.

## Authority and resolution

`resolveScopedAdminContext(...)` applies one order:

1. Parse a complete scoped or invitation URL. A parsed URL is authoritative.
2. On an unscoped admin pathname only, consider the schema-valid version-1 browser preference.
3. If preference is absent, corrupt, or stale, choose the deterministic first active catalog selection.
4. If no active complete selection exists, return `missing/context`.

An explicit URL never falls back to another tenant when one part of its ownership chain fails. Resolution distinguishes:

| State | Meaning |
|---|---|
| `ready` | The exact active organization/workspace/site chain composed successfully. |
| `unauthorized` | An ID exists elsewhere in the accessible catalog but not under the URL owner chain. |
| `missing` | The requested workspace/site does not exist, or no complete context is available. |
| `organization-suspended` | The exact organization exists but cannot open descendants. |
| `workspace-archived` | The exact workspace exists but cannot open a site shell. |
| `site-archived` | The exact site exists but cannot open its profile shell. |
| `invitation` | The invitation URL owns the entry state; no site is substituted. |

`FumaScopedShell` in `src/admin/fuma/FumaScopedShell.tsx` presents every state explicitly. Only `ready` writes `fuma-scoped-context-v1` through `src/admin/fuma/contextPreference.ts`.

## Hosted composition seam

FUMA-021 provides trusted request/job authority in `server/fuma/context/`; it does not turn a browser-provided accessible catalog into authority. Until a production composition adapter projects accessible selections from scoped repositories, the browser integration keeps this explicit test/composition seam:

```tsx
<AdminEntry hostedContextCatalog={testCatalog} />

<HostedStaffShell
  session={session}
  pathname={pathname}
  contextCatalog={testCatalog}
/>
```

The prop type is `unknown` because it is a boundary. `HostedStaffShell` checks it with `AccessibleContextCatalogSchema` before passing it to `FumaScopedShell`. An omitted value becomes a valid empty catalog and renders **No scoped context is available**. A schema-invalid value renders **Scoped context unavailable**.

`AdminEntry` obtains `pathname` from `useLocation()` in the in-house router and passes it to the shell. Route parameters are populated by the router for other consumers, but catalog data and route params never rewrite the pathname selection. The URL remains the authority supplied to `resolveScopedAdminContext(...)`.

Do not replace this seam with caller headers, query-string catalog JSON, a browser global, or a client-side fetch that claims to establish trusted membership. A production adapter must derive the projection from authenticated immutable server context plus scoped repositories; until then, the prop remains test/composition data and omitted production input fails closed.

## Profile shell and switchers

`FumaScopedShell` resolves the selected profile through `fumaLaunchRegistry`, scopes composed navigation links with `buildScopedAdminUrl(...)`, resolves onboarding, and renders `FumaContextSwitchers` by default.

The switchers in `src/admin/fuma/FumaContextSwitchers.tsx`:

- list only active accessible organizations, workspaces, and sites;
- qualify colliding workspace/site IDs with the current owner chain;
- use deterministic active descendants for organization/workspace changes;
- preserve the validated profile-relative suffix;
- navigate through `useNavigate()` from `src/admin/lib/routing`;
- emit typed `FumaContextSwitchIntent` values for host observation;
- are exercised in the browser fixture across organization, workspace, and Website/Publication site changes, including suffix preservation.

A ready selection is persisted only after resolution. The browser fixture switches into another organization, observes the stored complete owner chain, reloads, and proves an unscoped `/admin` entry restores that exact selection. Explicit scoped URLs still win over the stored value, and stale stored selections still fall back deterministically.

A Website-to-Publication change is a site selection followed by registry composition. No selection, route, shell, or switcher code compares profile IDs.

## Managed-client app view

`AccessibleContextCatalogSchema` optionally carries `managedClients` links. Each link identifies one organization-qualified authorized workspace plus a distinct intended destination organization. `assertCatalog(...)` rejects missing/duplicate workspace links and a destination equal to the current owner.

`composeManagedClientsView(...)` in `src/core/fuma/managedClients.ts` projects only sites already present in that authorized catalog. Active sites receive canonical `buildScopedAdminUrl(...)` targets; archived workspaces/sites remain visible as unavailable metadata and never receive an open target. `FumaManagedClientsView` in `src/admin/fuma/FumaManagedClientsView.tsx` renders the projection at the scoped `/admin/managed-clients` suffix. Its links enter normal Website/Publication contexts, so managed work uses the same shell and editor seams as any other site.

The intended destination is informational and does not imply ownership or transfer eligibility. The app view has no mutation controls or fields for private offers, platform-internal grants, billing, pricing, quota proposals, payment state, or transfer recovery. Those operations remain `admin.fuma.co.ke` concerns and are not part of the FUMA-018 catalog or UI contract. FUMA-021 replaces the injected authorized catalog seam; FUMA-018 does not add a browser-trusted managed classification or mount a server handler.

## Public API

Core exports are available from `src/core/fuma/index.ts`:

- catalog, managed-client link/view, route-entry, selection, preference, and resolution schemas/types;
- `buildScopedAdminUrl(...)`, `buildInvitationAdminUrl(...)`, and `parseScopedAdminUrl(...)`;
- `resolveScopedAdminContext(...)`, `composeManagedClientsView(...)`, and switch-target builders;
- `ScopedContextSelectionError`.

Admin exports are available from `src/admin/fuma/index.ts`:

- `FumaScopedShell` and its switcher-slot contracts;
- `FumaContextSwitchers` and typed switch intents;
- `FumaManagedClientsView` and its read-only model prop;
- context preference read/write APIs;
- profile navigation/onboarding components.

Files inside either module use relative imports. External consumers use the barrel.

## Verification surfaces

- `src/__tests__/fuma/stableContextSelection.test.ts` — schema, resolver, route builders, authority, managed-client projection, and profile-neutral core behavior.
- `src/__tests__/admin/fumaContextSwitchers.test.tsx` — deterministic dependent choices and in-house navigation.
- `src/__tests__/admin/fumaScopedShell.test.tsx` — shell states, persistence, navigation, onboarding, and managed-client view.
- `src/__tests__/admin/fumaScopedRoutes.test.tsx` — hosted-only route table, unscoped restoration seam, and `AdminEntry`/`HostedStaffShell` integration.
- `tests/e2e/fuma-context-switching.e2e.ts` — deterministic multi-organization switching and managed-client browser entrypoint.
- `src/__tests__/architecture/fuma-managed-client-view.test.ts` — read-only app projection and admin-only commercial boundary.
- `src/__tests__/architecture/admin-router-usage.test.ts` — in-house router boundary.
- `src/__tests__/architecture/fuma-platform-architecture.test.ts` — profile-neutral and platform policy gates.

## Forbidden patterns

- Do not make workspace IDs or site IDs global selectors.
- Do not let localStorage override a complete URL.
- Do not redirect unauthorized, missing, suspended, or archived URLs to another context.
- Do not persist non-ready resolution states.
- Do not branch on Website, Publication, or another profile ID in route or shell integration.
- Do not add raw `/admin` anchors, `react-router-dom`, caller context headers, browser catalog globals, server handlers, or request-context claims here.
- Do not treat the optional catalog prop as the FUMA-021 production trust boundary.
- Do not infer managed-client classification from names, profile IDs, browser state, or customer input; consume only validated authorized catalog links.
- Do not add custom offers, platform-internal grants, billing/pricing/quota/payment state, transfer recovery, or their mutations to the app managed-client view.

## Related

- `docs/reference/fuma-platform-architecture.md` — hierarchy, profiles, hosted topology, and task ownership
- `docs/reference/fuma-profile-composition.md` — composed navigation/onboarding UI boundary
- `docs/reference/fuma-workspaces.md` — workspace services and FUMA-021 trusted composition seam
- `docs/reference/admin-router.md` — in-house browser router
- `src/core/fuma/selection.ts` — stable context source of truth
- `src/admin/fuma/` — scoped shell and switcher source of truth
- `src/admin/router.tsx` — hosted-only route declarations
