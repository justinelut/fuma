# FUMA-SITE-006 — The Lawyer exact-host runtime pilot

## Result

The complete accepted FUMA-076 Lawyer estate is projected into the single manifestless `apps/site-runtime` Next application through owned, compiled React source components. The runtime preserves exact routes and canonical URLs, publication data/access bindings, reusable templates and loops, shared tokens, imported media relationships, member and verified-paid behavior, responsive/accessibility behavior, and retained-release rollback. It does not reconstruct rendered HTML or create disconnected tenant copies.

This work was completed in `/home/ubuntu/worktrees/fuma-orch-23` on `orchestrator/23-lawyer-runtime-fuma-site006`, based on `55e260c15b345791d9f07f7eef4d56122aa78a73`. The canonical backlog contract was absent from this base and was read only from the main checkout; the main checkout was not edited.

## Estate and source ownership

The strict deterministic `runtimePilot.ts` projector requires and maps the full accepted estate:

- 69 routes: 40 page, 18 API, 6 feed, and 5 system routes.
- 63 content records: 42 posts and 21 pages.
- 147 relations, 4 authors, 4 members, 13 section tags, 16 reserved pages, and 2 media objects.
- Access: 45 public, 9 member, and 9 paid records.
- 11 reusable templates, 10 loop identities, 6 shared Lawyer tokens, and both imported assets connected to all 42 posts.
- 6 exact owned components at `1.0.0`: site shell, editorial header, story card, access gate, membership panel, and account panel.
- `flattenedCopies: 0` and `disconnectedCopies: 0`.

The components live in `apps/site-runtime/components/lawyer-components.tsx`, use static Tailwind strings, and are registered in the existing exact-version component registry/tree walker. `projectLawyerCanonicalRoute` emits strict existing runtime trees; inventory patterns such as `/article/[slug]` remain inventory patterns while concrete routes are canonical and reject dot segments. API, admin, and payment callbacks remain behind existing Bun authorities rather than becoming synthetic Next pages.

## Authority and security boundaries

The pilot reuses only existing authorities:

- `fuma.publication.content`
- `fuma.publication.member-access`
- `fuma.customer-payments`
- `fuma.oci-email-delivery`

Authenticated member/paid state is projected from `PublicationMemberAccessService.audienceForIdentity` into the strict optional `SiteApplicationAccessSchema`. Anonymous requests receive explicit false access. Only `member`, `paid`, `memberSource`, and sorted segment IDs cross into Next; provider references, payment transaction IDs, credentials, and secrets do not. Legacy Paystack labels never grant paid access. Payment checkout remains Fuma customer-payment authority, and mail remains Fuma-managed OCI Email Delivery.

The Studio and independent Next contracts remain strict TypeBox with `additionalProperties: false`. There are no Zod contracts, app-to-app production imports, shared UI, database/provider ownership in Next, dynamic tenant server imports, migration, or lockfile changes.

## Parity, cutover, and rollback

The manifest preserves source-route targets as React pages, existing Bun authorities, generated publication feeds, or runtime-system routes. React routes retain exact internal-link and canonical bindings. One shared token mutation changes the manifest hash without copying routes, content, templates, or components.

Each eligible route uses explicit policy: target `react`, shadow `compare`, fallback `legacy`, retained legacy required. The five rollback triggers are visual parity, access parity, hydration, budget, and operator action. Rollback is exact-route and non-mutating: it changes no content, member, or payment data.

Deterministic demo evidence:

- Before manifest SHA-256: `32865ee135248ad32857dcdd2b9b559c989c6184ef17a08a011c296b4b845c03`
- Shared-token-mutated SHA-256: `99608a902f56293de15b0954404da90eeca5ccf9da237d027884976e4b942c56`
- Canonical demo route: `/article/the-constitutional-pivot`
- Payment reconciliation: 1 verified eligible, 4 denied/exception, 0 direct access grants.

## Executed validation

All commands ran from the assigned worktree; no root aggregate test, full build, or full lint was run.

- Focused SITE-006 plus affected SITE-002/004/005 regressions: **32 pass, 0 fail, 201 assertions**.
- FUMA-076 regressions: **15 pass, 0 fail, 107 assertions**.
- Targeted changed-file ESLint: **0 errors, 0 warnings**.
- `bun run typecheck:site-runtime`: passed, including Next route type generation and direct TypeScript check.
- `bun run build:site-runtime`: passed with Next 16.2.9 Turbopack; compiled successfully, TypeScript passed, page data/static generation completed, and standalone assets were prepared.
- `git diff --check`: passed.
- Native host: `aarch64`; browser executable is an ELF 64-bit ARM aarch64 Playwright Chromium headless shell.
- `bun.lock`, root `package.json`, and `apps/studio/package.json`: unchanged.

Focused test command:

```sh
bun test apps/studio/src/__tests__/fuma/FUMASITE006 \
  apps/studio/src/__tests__/architecture/fuma-lawyer-runtime.test.ts \
  apps/site-runtime/tests/lawyer-components.test.tsx \
  apps/site-runtime/tests/component-registry.test.tsx \
  apps/studio/src/__tests__/fuma/siteRuntimeApplication.test.ts \
  tooling/site-runtime/tests/site-runtime-release.architecture.test.ts
```

FUMA-076 regression command:

```sh
bun test apps/studio/src/__tests__/fuma/FUMA076 \
  apps/studio/src/__tests__/architecture/fuma-lawyer-import.test.ts
```

## Native Blyss HTTPS browser acceptance

`apps/studio/tests/e2e/fuma-site-006-lawyer.acceptance.ts` starts the standalone Node runtime on loopback for process control only, exposes an exact-host routing proxy at `https://3121.blyss.co.ke`, and uses the strict private authority double through `https://3123.blyss.co.ke`. Every browser navigation and asset request uses the public Blyss HTTPS host. No browser acceptance is claimed from loopback.

Native ARM64 Chromium passed:

- public article and exact-host canonical link;
- shared token `--lawyer-accent: #713f12`;
- internal Next Link transition with one document and navigation visits `1 → 2`;
- member denial and authority-projected member allowance;
- paid denial and verified-paid allowance, including the explicit legacy-label non-grant message;
- semantic navigation/main/footer landmarks and skip link;
- 320 px containment, 200% text zoom containment, and reduced-motion CSS;
- React cutover and retained legacy exact-route rollback with no data mutation;
- zero actionable console, page, hydration, or runtime errors.

Browser transcript SHA-256: `32588b854dbb716400e1eb09002a8fb179916066d5616090e0e7c74147928439`.

Evidence was written to ignored `.tmp/fuma-site-006-browser/`. Screenshot SHA-256 values:

- member allowed: `1df58ae89c0386c7ead9d6c86cc2435cd35322663e56caf029db8d562d6e0609`
- member denied: `4909809dd4db4f88200181d25eb1aae10588f7fc77dfa2930660013ce0a82cd5`
- paid allowed, 320 px/200%: `61ed8d20120dd7527aea0b9ff1e47c210b8379cda2d55e551f0bbc2b76b4ad49`
- paid denied, 320 px/reduced motion: `d0e5987d2a916410ecbb19a39c7818a82f0801d011d653ecbeb0912133f1c2f5`
- retained rollback: `83a90e260c411baa7825cdc8f41135e2b46aa80be900df0cba02a912685c5790`

## Integration notes and non-claims

- Integrate the local ticket commit as one unit; runtime access contract changes in Studio and Next must land with the component registry/tree changes.
- The exact-host runtime marker advances from SITE-005 to SITE-006. No shared SITE-008 abstraction was introduced.
- No canonical migration was added. No tracker/counter documents were edited.
- No dependency was installed. The targeted build/browser run used ignored local links/copies from the repository's existing exact Bun dependency store solely to satisfy worktree-local Turbopack resolution; none are tracked.
- No live provider request, production data mutation, external deployment, Docker, emulation, protected publication, signing, scan, push, or production cutover was performed or claimed.
