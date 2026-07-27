# Fuma Website Parity

This reference defines the FUMA-019 evidence that connects the Website launch profile to the current self-hosted site-builder baseline.

The source of truth for the deterministic matrix is `src/__tests__/fuma/websiteParity.test.ts`. The behavioral baseline is `tests/e2e/fuma-website-parity.e2e.ts`, which drives the existing self-hosted editor rather than a replacement hosted editor.

---

## TL;DR

- `src/__tests__/fuma/websiteParity.test.ts` composes the registered Website profile without a browser and pins pages, content, data, media, design, and settings to their capability contributions.
- The same test pins the complete Website navigation, onboarding, starter-template, permission, and route objects, plus publish-job and transfer metadata; ID-only membership is not accepted.
- `src/admin/fuma/FumaScopedShell.tsx` receives a registry and composes scoped navigation and onboarding generically; the parity test renders that seam without Playwright.
- Registering the fixture from `src/__tests__/helpers/fuma/extensionProfile.ts` adds its public contributions to an extension profile or an explicit Website/Publication grant. The ungranted Website composition and scoped-shell markup remain deep-equal and byte-for-byte equal to launch output.
- `tests/e2e/fuma-website-parity.e2e.ts` treats the current self-hosted editor as the Fuma Website behavioral baseline: author, save, reload, publish, inspect clean public output, and reach all six setup concepts.
- FUMA-027 owns making editor persistence multi-site. FUMA-019 does not claim that the existing editor persistence is already site-scoped through the hosted shell.

## Deterministic concept matrix

`src/core/fuma/launchProfiles.ts` registers the Website metadata. The current self-hosted surfaces in the second column are exercised by `tests/e2e/fuma-website-parity.e2e.ts`; registered paths in the remaining columns are composition metadata and do not claim route mounting.

| Concept | Current self-hosted behavioral baseline | Website capability | Registered navigation / route | Setup and transfer metadata |
|---|---|---|---|---|
| Pages | Pages panel in the visual editor at `/admin/site` | `content.pages` | `nav.pages` / `route.pages.list`, `route.pages.write` at `/admin/pages` | `onboarding.pages`, `starter.pages`, `job.website-publish`, `transfer.pages` |
| Content | Content workspace at `/admin/content` | `website.content` | `nav.content` / `route.content` | None |
| Data | Data workspace at `/admin/data` | `website.data` | `nav.data` / `route.data` | None |
| Media | Media workspace at `/admin/media` | `website.media` | `nav.media` / `route.media` | `onboarding.media` |
| Design | Design tab in the visual editor at `/admin/site` | `website.design` | `nav.design` / `route.design` | `onboarding.design`, `starter.website`, `transfer.design` |
| Settings | Settings dialog opened from the current admin workspace | `site.settings` | `nav.settings` / `route.settings` | `onboarding.identity`, transfer execute/resume/compensate jobs, `transfer.settings` |

The matrix intentionally distinguishes current UI locations from launch registration. For example, Pages and Design remain surfaces inside `/admin/site` in the behavioral baseline while the launch declarations expose `/admin/pages` and `/admin/design`. `src/core/fuma/registry.ts` composes metadata; it does not mount routes or move existing editor UI.

## Website profile composition

`src/__tests__/fuma/websiteParity.test.ts` pins the complete Website preset, including Home and Analytics outside the six setup concepts:

```text
capabilities:
  site.home → website.content → content.pages → website.data
  → website.media → website.analytics → website.design → site.settings

navigation:
  Home → Content → Pages → Data → Media → Analytics → Design → Settings

onboarding:
  Name the site → Choose a design → Create a page → Add media

starter templates:
  website.blank → pages.blank
```

The acceptance test compares complete ordered objects rather than mapping them down to IDs. Navigation includes each `order`, `label`, `path`, and optional `permission`; onboarding includes each `order`, `title`, and `description`; starter templates include each `order`, `label`, and `templateId`. It also pins every Website permission's label and description and every Website route's method, path, and permission. This covers Home and Analytics as well as the six behavioral matrix concepts.

The composed Website route catalog is exactly:

| Route | Method and path | Permission |
|---|---|---|
| `route.home` | `GET /admin` | `site.home.read` |
| `route.content` | `GET /admin/content` | `website.content.read` |
| `route.pages.list` | `GET /admin/pages` | `content.pages.read` |
| `route.pages.write` | `POST /admin/pages` | `content.pages.write` |
| `route.data` | `GET /admin/data` | `website.data.read` |
| `route.media` | `GET /admin/media` | `website.media.read` |
| `route.website-analytics` | `GET /admin/analytics` | `website.analytics.read` |
| `route.design` | `GET /admin/design` | `website.design.read` |
| `route.settings` | `GET /admin/settings` | `site.settings.read` |

The launch registration also declares, but does not execute:

- `route.pages.list`: `GET /admin/pages` with `content.pages.read`;
- `route.pages.write`: `POST /admin/pages` with `content.pages.write`;
- `job.website-publish`: handler `website.publish` with `content.pages.write`;
- `job.transfer-execute`, `job.transfer-resume`, and `job.transfer-compensate`: shared transfer handlers with `site.settings.write`;
- `transfer.pages`: step `transfer.content.pages`;
- `transfer.design`: step `transfer.design.assets`;
- `transfer.settings`: step `transfer.site.settings`.

FUMA-024 object copy and ownership policy are deliberately absent from Website capability metadata. `createRegisteredTransferStepRegistry(...)` adds mandatory `transfer.tenant-objects-copy` and `transfer.object-ownership-policy` for every profile, with policy depending on verified copy.

The exact objects and permissions are asserted in `src/__tests__/fuma/websiteParity.test.ts`. The parity matrix includes generic contributions added to shared capabilities, so later transfer foundations can extend `site.settings` without profile forks while remaining explicit in Website evidence. Route mounting, job execution, and transfer execution remain owned by their runtime consumers rather than `src/core/fuma/launchProfiles.ts`.

## Scoped shell composition

`src/admin/fuma/FumaScopedShell.tsx` resolves an `organizationId → workspaceId → siteId` selection, then passes the selected site's `profileId` and `capabilityOverrides` to:

- `composeProfileNavigation(...)` in `src/core/fuma/navigation.ts`;
- `resolveProfileOnboarding(...)` in `src/core/fuma/onboarding.ts`.

The shell accepts an injected `FumaRegistry`. The non-browser integration test renders it with `react-dom/server` and proves:

1. The launch registry and extension registry emit byte-identical scoped Website markup when the extension is not granted.
2. Both outputs contain the same scoped Website navigation and onboarding.
3. Granting `fixture.content-review` through the extension registry adds its scoped navigation path and onboarding step without a shell branch or production-core edit.

Starter templates, jobs, routes, and transfers are registry outputs rather than shell-rendered controls. Their presence is asserted directly against `ComposedProductProfile` in the same test.

## Extension stability contract

The fixture declarations live outside production core at `src/__tests__/helpers/fuma/extensionProfile.ts`. They use only the public `@core/fuma` contracts and register one capability plus one Website-derived fixture profile.

The evidence snapshots both launch profiles before extension composition and compares these states. `FUMA_EXTENSION_CAPABILITY_GRANT` is one profile-neutral override envelope reused unchanged for Website and Publication:

| Composition | Extension contributions | Baseline requirement |
|---|---|---|
| Launch Website | Absent | Canonical deep structure and serialized bytes |
| Website in `fumaExtensionRegistry`, no grant | Absent | Deep-equal and byte-for-byte equal to Launch Website |
| Website in `fumaExtensionRegistry`, explicit grant | Present | Baseline contributions plus fixture navigation, onboarding, template, permission, route, job, and transfer |
| Publication in `fumaExtensionRegistry`, same explicit grant | Present | Publication receives the same public contributions without a profile-specific fixture or shared-core edit |
| `fixture.website-content-review` profile | Present | Contributions appear through profile registration alone |
| Launch Website and Publication after extension compositions | Absent | Both remain equal to their original launch snapshots |

Focused fixture validation remains in `src/__tests__/fuma/profileExtensionFixture.test.ts`; generic fixture-blind architecture coverage remains in `src/__tests__/architecture/fuma-profile-extension.test.ts`. The architecture gate also reads the concrete helper fixture, proves it lives outside shared core, rejects any `@core/fuma/*` deep import, and explicitly forbids `fixture.website-content-review` in shared composition sources or named-profile branches.

## Behavioral baseline and persistence boundary

`tests/e2e/fuma-website-parity.e2e.ts` uses the existing unscoped `/admin/*` self-hosted UI as the Fuma Website behavioral baseline. Its first scenario creates a real page, edits Text and Button modules, saves, reloads, publishes through the existing step-up-aware helper, and checks semantic public output without editor attributes. Its second scenario reaches Pages, Design, Content, Data, Media, and Settings through current UI paths.

This baseline proves that hosted profile and shell composition must preserve the current Website journey. It does not prove that the editor is mounted in a hosted scoped route or that its persistence keys and repository operations are multi-site. FUMA-027 owns making editor persistence multi-site; until that work lands, the FUMA-019 E2E deliberately exercises the existing self-hosted persistence behavior without pretending that hosted site isolation already exists.

## Proof and scope limits

Proven by declarations, unit/integration tests, architecture gates, and the behavioral E2E:

- exact Website capability and contribution composition for the six site-builder concepts;
- exact Website navigation, onboarding, starter-template, permission, and complete route metadata, plus publish-job and transfer metadata;
- a generic scoped-shell composition seam that accepts the extension registry;
- extension contribution discovery through profile registration and one profile-neutral capability grant reused across Website and Publication;
- deep-equal and serialized-byte stability of the ungranted Website composition and scoped shell;
- the existing self-hosted editor remains the executed behavioral authority for Website parity.

Not owned or claimed by FUMA-019:

- execution of registered routes, jobs, transfer steps, or fixture handlers;
- hosted mounting of the current editor under scoped URLs;
- multi-site editor persistence or cross-site isolation, which belongs to FUMA-027.

## Verification surfaces

Use these commands to repeat the focused and repository-wide verification:

```sh
bun test src/__tests__/fuma/websiteParity.test.ts src/__tests__/fuma/profileExtensionFixture.test.ts src/__tests__/architecture/fuma-profile-extension.test.ts
E2E_VITE_MODE=preview E2E_ADMIN_BASE_URL=https://5174.blyss.co.ke E2E_PUBLIC_BASE_URL=https://3002.blyss.co.ke bun run test:e2e -- tests/e2e/fuma-website-parity.e2e.ts
bun test
bun run build
bun run lint
```

The browser command intentionally uses the configured HTTPS preview hosts. Do not substitute browser-facing localhost for this acceptance run.

## Forbidden patterns

- Do not replace the self-hosted editor baseline with fixture-only UI assertions.
- Do not treat launch route, job, or transfer declarations as proof that handlers execute.
- Do not add Website or extension decisions to `src/core/fuma/registry.ts`, `src/core/fuma/navigation.ts`, `src/core/fuma/onboarding.ts`, or `src/admin/fuma/FumaScopedShell.tsx`.
- Do not mutate `LAUNCH_CAPABILITIES`, `LAUNCH_PROFILES`, or `fumaLaunchRegistry` to install a test extension.
- Do not use the FUMA-019 self-host parity suite as hosted isolation evidence; FUMA-027 now owns that evidence in `fuma-editor-multisite.md`.

## Related

- `docs/reference/fuma-profiles.md` — public capability and profile registry contracts
- `docs/reference/fuma-profile-composition.md` — navigation, onboarding, and scoped UI boundaries
- `docs/reference/fuma-stable-context.md` — hosted scoped URL and context authority
- `src/core/fuma/launchProfiles.ts` — Website launch registration source of truth
- `src/__tests__/fuma/websiteParity.test.ts` — deterministic non-browser parity matrix and stability proof
- `tests/e2e/fuma-website-parity.e2e.ts` — existing self-hosted Website behavioral baseline
- `src/__tests__/fuma/profileExtensionFixture.test.ts` — extension fixture contract coverage
- `src/__tests__/architecture/fuma-profile-extension.test.ts` — fixture-blind generic composition gate
