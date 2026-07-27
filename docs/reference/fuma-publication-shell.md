# Fuma Publication shell

FUMA-032 composes the hosted Publication profile shell from the shared capability registry, permission snapshot, scoped route authority, and FUMA-027 editor surfaces. It does not introduce Publication CRUD; FUMA-033 owns that data model and UI.

## Implemented boundary

- `src/core/fuma/launchProfiles.ts` registers the exact subtitle **“Blog, magazine, newsletter, or newsroom”** and the exact ordered navigation: Home, Posts, Pages, Tags, Members, Newsletters, Analytics, Design, Settings.
- Publication profile data places `nav.design` in a default-collapsed **Editor** disclosure. `src/core/fuma/navigation.ts` validates and resolves this metadata; `src/admin/fuma/ProfileNavigation.tsx` renders native `details`/`summary` semantics, reveals Design on request, and opens it automatically for an authorized Design direct link.
- `src/core/fuma/routes.ts` resolves GET direct links from the assigned profile's active capabilities and the immutable permission snapshot. A known route from an inactive capability fails as `capability-disabled`; an active route without an exact allow fails as `permission-denied`.
- `src/admin/fuma/FumaScopedShell.tsx` resolves route access before invoking route children. Denied routes retain scoped shell context but mount neither route content nor an editor adapter. A keyboard-visible skip link moves focus to the named workspace `main` landmark, and the shell collapses to one contained column at narrow viewports.
- `src/admin/fuma/publication/PublicationRouteContent.tsx` maps allowed route IDs to their owning active capabilities. It does not infer Publication ownership from permission-filtered navigation, and mutation decisions must match the exact active organization/workspace/site scope before controls become writable.
- Nested direct links retain `aria-current="page"` and automatically reveal their containing disclosure. Publication editors can mutate pages/posts when their exact-site decisions allow writes; viewers and shared Design remain read-only.

## Composition and access flow

```text
site profile assignment + capability overrides
  -> FumaRegistry.compose(...)
  -> ordered permission-filtered navigation + disclosure metadata
  -> direct-route capability/permission resolution
  -> ready scoped shell
  -> capability-owned FUMA-027 editor surface
```

No routing, permission, persistence, editor, or navigation consumer branches on the `website` or `publication` profile ID. Profile differences remain declarations in `launchProfiles.ts`. A direct `/admin/posts` link therefore works for an authorized Publication assignment and fails closed for a Website assignment unless the relevant Publication capability is explicitly composed.

## Accessibility and frontend ownership

The Editor disclosure uses native keyboard-operable `details` and `summary` elements. Navigation retains its named landmark, links retain source order, and active direct links use `aria-current="page"`. Denials use an alert-state empty surface and do not leave inert unauthorized controls.

FUMA-032 extends the existing hosted Studio shell rather than creating a new React application or shared component library. It therefore preserves Studio's existing CSS Modules, token vocabulary, and in-house router. Tailwind/shadcn remain app-local to `apps/web`; no Tailwind, shadcn, Zod, or shared-UI dependency enters Studio or a leaf package. This follows the frontend ownership policy in [Fuma workspace and public Web architecture](fuma-workspace-public-web-architecture.md).

## Verification

Focused deterministic coverage:

```sh
bun test src/__tests__/admin/fumaPublicationShell.test.tsx \
  src/__tests__/fuma/profileNavigation.test.ts \
  src/__tests__/admin/fumaProfileEditor.test.ts \
  src/__tests__/admin/fumaScopedRoutes.test.tsx
bun test src/__tests__/architecture/fuma-publication-shell.test.ts \
  src/__tests__/architecture/fuma-platform-architecture.test.ts \
  src/__tests__/architecture/fuma-editor-multisite.test.ts
```

The hostile gates `src/__tests__/architecture/fuma-publication-shell.test.ts` and `src/__tests__/architecture/fuma-publication-route-content.test.ts` mutate the exact subtitle, navigation order, collapsed Design declaration, route permission check, denied-child mount guard, capability-owned child selection, exact-site write authority, accessible disclosure markup, profile neutrality, and Studio dependency isolation. Browser acceptance lives in `tests/e2e/fuma-publication-shell.e2e.ts` and is required to run through `https://5174.blyss.co.ke` plus `https://3002.blyss.co.ke`.

### Executed closure evidence — 2026-07-26

- Focused shell, route-content, workspace, navigation, shared-editor, and scoped-route behavior: **33 passed, 0 failed**.
- Focused hostile shell, route-content, platform, and multi-site editor architecture gates: **52 passed, 0 failed**.
- Studio app and Playwright project TypeScript checks: passed with no diagnostics.
- Scoped ESLint over changed shell/navigation/tests/E2E: passed with no findings.
- Blyss HTTPS Playwright (`E2E_ADMIN_BASE_URL=https://5174.blyss.co.ke`, `E2E_PUBLIC_BASE_URL=https://3002.blyss.co.ke`, preview mode): **2 passed, 0 failed**. The run proved the public service response, editor and viewer access, keyboard reveal of collapsed Design, skip-link focus, narrow viewport containment, read-only Design, permission denial, and capability-disabled denial.

## Related

- [Fuma profiles](fuma-profiles.md)
- [Fuma profile composition](fuma-profile-composition.md)
- [Fuma permissions](fuma-permissions.md)
- [Fuma multi-site editor sessions](fuma-editor-multisite.md)
- [Architecture test catalog](architecture-tests.md)
