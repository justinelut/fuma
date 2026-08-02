# FUMA-077 continuation handoff

## Disposition

**KEEP OPEN.** The latest repository-local continuation adds bounded AST-only inventory for finite local `const` strings, immutable literal maps with explicit unknown-key fallbacks, and non-exported local components whose complete JSX call-site string props are finite. Together with earlier literal/conditional/template analysis, this reduces real Lawyer dynamic Tailwind blockers from 53 to 15 without evaluating source. The raw source remains blocking, and only an explicitly proposed, confirmed, and applied font revision reduces `unsupported-next-api` from five to four. The remaining findings require runtime/provider/member/media/system authority or protected acceptance, not broader syntax interpretation. This does not satisfy protected GitHub-provider, browser/native, podcast-authority, system/OG, or full real-Lawyer acceptance.

FUMA-077 and FUMA-SITE-006 remain open. Migration `000078_next_source_portability_authority` remains the sole checksum sentinel; it was not edited, finalized, registered as runnable, or applied. Physical migrations `000079_public_marketing_analytics.ts` and `000080_public_trust_authority.ts` remain isolated and unregistered; neither was modified.

The authoritative amended ticket and source-import contract were re-read from `docs/plans/fuma-execution-backlog.md` and `docs/reference/fuma-nextjs-source-import.md`. The shared worktree was inspected first and all existing user/agent changes were preserved.

## Implemented in this continuation

1. **Static string normalization.** The AST evaluator now interprets exact `trim`, `trimStart`, `trimEnd`, `toLowerCase`, and `toUpperCase` calls on already bounded static strings with zero arguments and a 100,000-code-unit result ceiling.
2. **Static string predicates and lookups.** Exact string `startsWith`, `endsWith`, `includes`, `indexOf`, and `lastIndexOf` calls accept one static string plus an optional safe-integer position. String `at` and `slice` share the existing safe-integer rules while preserving bounded null/out-of-range behavior.
3. **Bounded tokenization and joining.** Exact string `split` accepts only a literal/static string separator, never a regular expression, and rejects results above the existing 500-item collection ceiling. Exact array `join` accepts only scalar values, at most one static string separator, and the same 100,000-code-unit result ceiling.
4. **Real-source pattern coverage.** Focused semantic projection now covers source-inspired slug filtering with `trim().startsWith(...)`/`endsWith(...)`, static heading joins, case normalization, substring lookup/slicing, character access, and split-driven JSX maps.
5. **Fail-closed constraints.** Regular-expression split, non-string search/separator values, unsafe positions, excessive split output, object/array join values, extra normalization arguments, mutation methods, unknown calls, callback references, and locale-sensitive/arbitrary methods remain rejected.
6. **Architecture gate.** The FUMA-077 architecture test now requires explicit string-method, regex-denial, split-item, scalar-join, and string-output boundaries while retaining callback invocation, dynamic import, package execution, app-boundary, Tailwind, Zod, and podcast denials.

## Security and authority invariants preserved

- No imported package manager, lifecycle/build script, dependency, configuration plugin, repository module, arbitrary React/backend/server code, or tenant callback executed.
- No database/SQL/ORM, provider SDK, environment/secret, credential, unrestricted network, package/dependency, config-plugin, backend, or runtime authority was added.
- No route/page/app import, shared UI, Zod, Studio Tailwind, dependency, lockfile, browser surface, `apps/web`, legal, payment, provider, or migration file changed.
- Existing source-hash, destination, reviewed interaction-binding, owner-confirmation, metering, replay, editor-sequence, release, export/re-import, and rollback boundaries were not changed.
- AI/MCP gained no dependency/backend/policy/credential/self-confirmation/publication authority.
- Podcast remains fail-closed. No episode, audio-enclosure, feed, provider, or podcast authority was added or inferred.

## Exact files changed in this continuation

- `apps/studio/server/fuma/nextSource/projectionEvaluator.ts` — bounded static string normalization/predicates/lookups/split plus scalar-array join.
- `apps/studio/src/__tests__/fuma/nextSourceProjection.test.ts` — positive semantic projection and negative bounded/non-execution cases.
- `apps/studio/src/__tests__/architecture/fuma-next-source-portability.test.ts` — explicit string/split/join architecture assertions.
- `docs/handoffs/agent-results/FUMA-077.md` — current continuation evidence and disposition.
- `docs/plans/fuma-execution-backlog.md` — concise current-continuation checkpoint.

The FUMA-077 implementation remains untracked within the larger shared worktree. This continuation did not stage, commit, push, reset, clean, amend, discard, or overwrite any shared change.

## Focused validation evidence

- New projector slice plus architecture gate:
  - `bun test src/__tests__/fuma/nextSourceProjection.test.ts src/__tests__/architecture/fuma-next-source-portability.test.ts`
  - **14 pass / 0 fail / 110 assertions**.
- Complete scoped non-native FUMA-077 selection (analyzer, portability/adaptation, production GitHub/owner authority, projection, GitHub recovery, architecture):
  - **50 pass / 0 fail / 339 assertions** across seven files.
- Real allowlisted Lawyer checkout through the generic non-executing FileMap path:
  - **1 pass / 0 fail / 13 assertions**.
  - Evidence remains **209 files, 69 routes, 173 runtime-reachable modules, 8 assets**, 194 externally reviewable supported bindings, 33 podcast interactions, source hash `1fa700ca206db160deb930a3a23c76a1114dfef98b44ce30e7203069f4017616`.
- Hosted migration candidate/policy/transition/workspace baseline:
  - **17 pass / 0 fail / 3 explicit optional native PostgreSQL skips / 328 assertions**.
- Canonical read-only migration inventory:
  - Registry source contains **78 manifests / 77 runnable**; last runnable is `000077_public_handoff_authority`; `000078_next_source_portability_authority` is the sole indexed checksum sentinel.
  - Physical `000079_public_marketing_analytics.ts` and `000080_public_trust_authority.ts` remain unindexed. Neither was registered or modified here.
- Strict Studio server/node TypeScript:
  - `bunx tsc -p tsconfig.node.json --noEmit --pretty false` — **pass**.
- Scoped ESLint over the three changed implementation/test files:
  - `bunx eslint --max-warnings 0 ...` — **pass, zero warnings/errors**.
- LSP diagnostics for all three changed implementation/test files — **none**.
- Scoped whitespace/final-newline checks — **pass**.
- Owned implementation line budget — evaluator **404 lines**, within the 700-line ceiling.

No unfiltered root test/build/lint, browser/E2E, package install, imported command, external GitHub/provider mutation, deployment, migration application, Docker/buildx/QEMU/emulation, signing, scanning, commit, staging, push, reset, clean, or amend was performed.

## Unchanged closure blockers

1. The real Lawyer analysis still reports `dynamic-import-denied:1`, `dynamic-tailwind-denied:15`, `provider-sdk-denied:1`, `secret-or-environment-access:89`, `server-authority-required:96`, `unsupported-dependency:84`, and raw `unsupported-next-api:5`. Its raw analysis also reports unbound content 68, form 18, member 74, subscription 34, and podcast 33; the fixture externally maps all 194 currently reviewable non-podcast interactions, and the reviewed font revision reduces unsupported Next findings to four, but those other findings and podcast still block projection/publication.
2. **Podcast remains intentionally blocked.** No reviewed canonical show/episode/audio-enclosure/feed capability is demonstrably available; `podcast: []` remains the correct fail-closed contract.
3. Request-time data templates, dynamic/computed Tailwind, provider/server/environment behavior, forms/media beyond existing reviewed adapters, sorting/reduction and richer dynamic compositions still require reviewed deterministic adaptation. Static projection must not become arbitrary React or server execution.
4. Protected GitHub App/provider acceptance and a real external branch/pull request remain absent.
5. Formal Studio/Blyss HTTPS, responsive/accessibility/client-navigation, full Lawyer content/member/subscription/payment/email/podcast parity, cutover/fallback/rollback, and native ARM64 evidence remain absent and were not simulated.
6. The previously recorded unrelated aggregate module-size offenders (`server/index.ts` and `server/router.ts`) were not touched; the FUMA-specific architecture gate passes.

Consequently FUMA-077 and FUMA-SITE-006 remain open, and `000078_next_source_portability_authority` remains protected and sentinel-gated.

## 2026-08-01 system-surface authority assessment

No system-surface implementation was made. The analyzer correctly keeps both real Lawyer App Router conventions blocking as `unsupported-next-api` until a reviewed source fix is applied; discovery alone does not trust or project their imported code.

The architecture has one legitimate canonical destination for `src/app/not-found.tsx`: an ordinary editor page with `template: { enabled: true, target: { kind: 'notFound' }, priority }`. `resolveNotFoundTemplate`, `renderPublishedNotFound`, the final GET fallback, and the `404.html` bake preserve that authored page through the existing editor and publisher. However, the Next-source projector has no reviewed mapping contract that creates this template from a system diagnostic, binds that structural change to the exact input/output source hashes and fix receipt, or includes it in the canonical sequenced editor replacement.

There is no corresponding Fuma error-template authority at all: `TemplateTarget` contains only `everywhere`, `postTypes`, and `notFound`; there is no error target/resolver/renderer/artifact/publication gate. The real Lawyer `src/app/error.tsx` is additionally not a static generic component: it consumes runtime `error` and `reset`, calls `useEffect`/`console.error`, conditionally renders `error.digest`, and binds `onClick={reset}`. Mapping it as static content would silently discard behavior; interpreting it would execute imported callbacks/runtime code. Neither is allowed.

A complete two-surface deterministic slice therefore requires a separately reviewed canonical error-surface model plus an explicit Next-source system-template mapping contract for both surface kinds. That contract must project only bounded static JSX, represent or explicitly owner-review removal of unsupported runtime behavior, produce a new immutable draft revision, retain exact destination and input/output hashes, require fresh distinct direct-owner confirmation for executable changes, flow through authoritative editor sequencing, and remain blocked from publication until the applied receipt is final-output-bound. Until then, even the otherwise static `not-found.tsx` must not be special-cased independently because that would leave the advertised error/not-found transformation partial and without one canonical review seam.

The real checkout's `unsupported-next-api` inventory therefore remains exactly **5**: two analyzer-owned system-surface findings (`src/app/error.tsx`, `src/app/not-found.tsx`), one `next/font/google` import (`src/app/layout.tsx`), and two `next/og` imports (`src/app/api/og/route.tsx`, `src/app/apple-icon.tsx`). No remote-font or OG execution authority was added or inferred. FUMA-077 and FUMA-SITE-006 remain open; migrations `000078`, `000079`, and `000080` were not edited, finalized, registered, or applied.

## 2026-08-02 reviewed `next/font/google` adaptation

The existing deterministic source-fix and direct-owner-confirmation authority now has one generic, bounded font rewrite. `buildNextSourceGoogleFontSystemFix` accepts only one exact analyzed `next/font/google` diagnostic bound to the current source revision, destination, policy version, source path, and SHA-256 inventory. It parses source as AST data without importing or executing it; requires one named static import, one top-level literal `const` initialization per font, reviewed literal `subsets`/`weight`/optional `style`/`variable`/`display: "swap"`, an imported CSS token stylesheet, and `.variable` use only inside `className` templates. Unsupported options, spreads, computed values, runtime/className usage, unresolved or ambiguous tokens, unsafe fallback stacks, and non-UTF-8/unparseable source fail closed.

The plan exposes an explicit two-file diff: it removes the remote font import/initializers and class-variable injection from the layout, then replaces each exact `var(--font-*)` leading token with its already-authored concrete system fallback stack. It records requested family/options, source/token variables, stylesheet path/hash, patches, and literal evidence that no network was accessed, font downloaded, imported code executed, or dependency changed. The style change is explicitly `review-required-system-fallback` and remains a blocking diagnostic until a distinct direct owner confirms the executable diff. Application creates and reanalyzes a new immutable draft revision; it must remove exactly the bound font diagnostic plus only any declared co-located computed-class diagnostic while leaving every other diagnostic ID unchanged.

Patch safety remains strict. Public `proposeFix` always rejects replacements containing server/environment/secret/dynamic authority. Only the private internally generated font-plan path may preserve the exact count of already diagnosed forbidden matches in an unchanged source file; it cannot add any. This is required for the real Lawyer layout's existing environment findings and does not authorize reading or changing them.

Exact implementation/test files:

- `src/core/siteImport/nextSourceFontAdaptation.ts`
- `src/core/siteImport/nextSourcePortabilityContracts.ts`
- `src/core/siteImport/nextSourceAdaptation.ts`
- `src/core/siteImport/index.ts`
- `src/__tests__/siteImport/nextSourceFontAdaptation.test.ts`
- `src/__tests__/fuma/nextSourceLawyerAcceptance.test.ts`
- `src/__tests__/architecture/fuma-next-source-portability.test.ts`

Primary validation:

- Focused font, real-Lawyer, and architecture acceptance: **11 pass / 0 fail / 85 assertions**.
- Expanded eight-file non-native FUMA-077 regression: **56 pass / 0 fail / 375 assertions**.
- Real Lawyer raw analysis remains **209 files / 69 routes / 173 reachable modules / 8 assets / 194 reviewable non-podcast bindings / 33 podcast interactions**, source `1fa700ca206db160deb930a3a23c76a1114dfef98b44ce30e7203069f4017616`.
- Only after policy proposal, distinct owner confirmation, and application does the reviewed revision become `ee18d74258b74cd77f00593dabda038003c5d97e38d2c0dd4a2d9c50a8067702` and reduce `unsupported-next-api` **5 → 4** while preserving all unrelated diagnostic IDs.
- Migration serialization checks: **10 pass / 4 explicit optional native skips / 80 assertions**; `000078` remains the sole indexed sentinel and `000079`/`000080` remain unindexed.
- Strict Studio server/node TypeScript, scoped ESLint, LSP diagnostics, and `git diff --check`: pass.

The four remaining unsupported Next findings are the two system surfaces and two `next/og` imports. Podcast, provider/server/environment/dependency, protected GitHub, Blyss/native, parity, and cutover blockers remain. FUMA-077 and FUMA-SITE-006 stay open; no migration or protected evidence boundary moved.

## 2026-08-02 real Lawyer `next/og` authority assessment

No source fix was proposed, confirmed, or applied. Raw diagnostics remain authoritative. The reviewed applied `next/font/google` revision may still reduce `unsupported-next-api` from **5 → 4**, but neither `next/og` finding can honestly reduce that count further through an existing Fuma authority.

### Dynamic Open Graph route

`/home/ubuntu/workspace/proposal/thelawyer/src/app/api/og/route.tsx` has SHA-256 `48d1c9517974b3f68a7ddc0f1cbb90a1946cc4d3325ab984e41025d33a86ebfc`. It imports `next/og` and `next/server`, reads request query values `title`, `author`, and `credential`, and uses `ImageResponse` to render a 1200×630 PNG. It is not static metadata: article metadata constructs a visitor/data-controlled `/api/og?...` URL when no post social or feature image exists.

The reviewed Publication authority can carry bounded per-entry Open Graph/social title, description, card kind, and immutable media IDs, but it has no data-only contract that composites title/byline/credential into image bytes and no query-time image renderer. The fixed `apps/web` Fuma marketing card is app-owned, visitor-input-free, and brand-specific; it is not a tenant Publication social-card authority and cannot preserve this route. The generic source-fix seam also deliberately rejects `app/api/` patches, supports replacement text only for existing files, and cannot add/delete/rename a route or materialize immutable PNG bytes. Independently, analyzer route policy keeps every imported route handler `server-authority-required`, and editor projection rejects any revision containing a route handler. Removing only the `next/og` import would therefore discard behavior while leaving the server surface unresolved and would not be a legitimate adaptation.

### Apple icon

`/home/ubuntu/workspace/proposal/thelawyer/src/app/apple-icon.tsx` has SHA-256 `8b25799da9b3637c31790eaec476c038f1d4e9e7e7829e406480eeaf4e9e75f5`. It uses `ImageResponse` to render a static 180×180 PNG. Fuma can store a CMS-owned `faviconUrl` and publish `<link rel="icon">`, and the Next-source projector can embed only already-present, hash/MIME/sanitizer-verified `public/` image bytes. Neither authority models an Apple touch icon, emits `<link rel="apple-touch-icon">`, maps a Next metadata route into site settings, or turns JSX into PNG bytes.

The checkout does contain visually related but non-equivalent immutable SVGs: `src/app/icon.svg` (`fa2e3080bd1b86f6f19784c0027b5258171341c4f715acea2a1e77af022db568`) and `public/logo-mark.svg` (`1c05f1a6e205f060b37aba9d1afd37c02ddb4cdf7a3a9ba5d8c0c4a87c124be0`). They are different source bytes and do not preserve the generated 180×180 PNG response or Apple-link behavior. Substituting either would require an explicit reviewed icon-mapping/publication contract and owner-reviewed behavior/style loss that do not currently exist. Executable metadata routes remain `server-authority-required`; merely deleting the `next/og` import would misrepresent support.

### Disposition and unchanged blockers

The exact missing authority is a canonical tenant icon/social-card adaptation contract that can bind a diagnostic to the exact destination and input/output hashes, reference already immutable reviewed media (or accept separately supplied reviewed immutable bytes), express the loss of query-controlled title/author/credential rendering and generated-PNG/Apple-link semantics, require distinct direct-owner confirmation, create and reanalyze a new immutable revision, enter the sequenced editor replacement, and remain publication-blocked until final-output-bound receipts are applied. It must not execute imported React, `ImageResponse`, browser/canvas code, or arbitrary server code and must not create a second renderer/backend.

Until that authority exists, the raw real-Lawyer inventory remains `unsupported-next-api:5`; after the separately reviewed font application it is **4**, comprising the two system surfaces and these two `next/og` imports. Dynamic import, dynamic Tailwind, provider SDK, environment/secret, server-authority, unsupported-dependency, podcast, protected GitHub/PR, Blyss/native parity, and cutover blockers are unchanged. FUMA-077 and FUMA-SITE-006 remain **OPEN**. Migration state remains **78 manifests / 77 runnable**, with `000077_public_handoff_authority` last runnable, `000078_next_source_portability_authority` the sole indexed checksum sentinel, and physical `000079`/`000080` isolated and unregistered; none was edited, finalized, registered, or applied.

## 2026-08-02 `next/og` authority assessment

No `next/og` adaptation was implemented. The two real Lawyer findings require image generation, not metadata projection:

- `src/app/api/og/route.tsx` reads query-controlled title/author/credential values and executes a 1200×630 React `ImageResponse` renderer.
- `src/app/apple-icon.tsx` executes a 180×180 React `ImageResponse` renderer to synthesize an icon.

Canonical FUMA-034 Publication authority is data-only: Open Graph and social contracts can reference an already-owned `imageId`, and presentation decisions can select those IDs, but no contract renders arbitrary JSX into image bytes. Core site settings similarly reference an existing favicon URL; they do not own Apple-icon generation. Studio production code contains no `next/og`/`ImageResponse` renderer. The public Web social card uses app-specific Next.js code and cannot be imported into Studio or promoted into a tenant authority.

Adapting either surface would therefore require one of two unavailable inputs: owner-provided immutable image bytes already admitted through media authority, or a separately reviewed bounded social-card/icon renderer contract. Executing imported `ImageResponse`, copying query-controlled React into a new backend, or importing the public Web renderer would violate FUMA-077's non-execution, no-parallel-backend, and app-boundary rules. The analyzer correctly retains both diagnostics.

Verification passed **18 tests / 159 assertions** across Publication lifecycle/metadata, its architecture gate, FUMA-077 architecture, and real Lawyer raw/reviewed-font analysis. Source audits confirm Publication models only `imageId` references and Studio production code has no `next/og`, `ImageResponse`, or public-Web social-card import. Raw Lawyer remains at five unsupported Next findings and the owner-reviewed font revision remains at four; neither `next/og` finding can honestly reduce without new reviewed authority or owner-provided assets. No implementation, migration, renderer, dependency, route, or protected evidence was added.

## 2026-08-02 finite static-class analysis

The analyzer now parses source as TypeScript AST data and inventories complete class alternatives only when every interpolated value is provably finite and static. It supports bounded string/no-substitution literals, parenthesized/type-only wrappers, conditional branches, string concatenation, and template composition. Alternative expansion is capped at 64 values and each candidate at 16,384 code units; class tokens remain capped at 512 characters. No condition, callback, component, module, or imported source executes.

Unresolved identifiers, prop-derived values, map/property lookups, calls such as `cn(...)` with dynamic arguments, and other runtime expressions remain `dynamic-tailwind-denied`. Unresolved template fragments such as `bg-` are never entered into the static class inventory. Parse failure falls back to the prior conservative template diagnostic scan. Existing literal `className` plus bounded `cn`/`clsx`/`cva` literal discovery remains intact.

Changed files:

- `src/core/siteImport/nextSourceStaticClasses.ts`
- `src/core/siteImport/analyzeNextSource.ts`
- `src/__tests__/siteImport/analyzeNextSource.test.ts`
- `src/__tests__/architecture/fuma-next-source-portability.test.ts`

Validation:

- Focused analyzer and architecture acceptance: **22 pass / 0 fail / 117 assertions**.
- Expanded eight-file non-native FUMA-077 regression: **62 pass / 0 fail / 394 assertions**.
- Real Lawyer analyzer plus reviewed font adaptation: **2 pass / 0 fail / 25 assertions**.
- Protected migration policy/serialization/baseline: **17 pass / 0 fail / 3 explicit optional native PostgreSQL skips / 328 assertions**; the registry remains 78 manifests / 77 runnable with `000077_public_handoff_authority` last runnable and `000078_next_source_portability_authority` the sole indexed sentinel. Physical `000079_public_marketing_analytics.ts` and `000080_public_trust_authority.ts` remain unindexed.
- Real Lawyer raw analysis remains **209 files / 69 routes / 173 reachable modules / 8 assets / 194 reviewable non-podcast bindings / 33 podcast interactions**, while `dynamic-tailwind-denied` narrows **53 → 15** at the unchanged source hash.
- The final three reductions are the two `statusStyles[row.status] ?? fallback` uses in `case-law-digest.tsx` and the four literal `bg`/`text` prop combinations supplied to the non-exported local `ColourTile` component in `brand-guideline/page.tsx`.
- Strict Studio server/node TypeScript and scoped ESLint pass.

The remaining 15 raw class findings are imported font-instance variables, unguarded runtime map/property selection, or exported/runtime `className` and sizing props. Inferring them would require imported type execution, arbitrary call-graph interpretation, or accepting caller-controlled class strings. They therefore remain blocked; the safe repository-code frontier is exhausted without a separately reviewed authority/model. FUMA-077/SITE-006 remain open; no migration, package, route, backend, or protected evidence boundary moved.

## 2026-08-02 dynamic-import assessment

The sole real Lawyer `dynamic-import-denied` finding is `src/lib/members.ts:140`, where `await import("node:crypto")` obtains `createHmac` to mint a Ghost Admin JWT from `process.env.GHOST_ADMIN_API_KEY`, then performs a credentialed Ghost Admin API request. This is server/member/provider/secret authority, not presentation syntax. Rewriting it to a static `node:crypto` import would preserve the prohibited behavior while hiding the dynamic-import diagnostic, so no deterministic syntax fix is valid. The complete flow must instead be removed or mapped through existing reviewed Fuma member/access authorities with no imported credential, JWT, provider call, or server code execution. The dynamic-import blocker remains exactly one; no code or authority was added.
