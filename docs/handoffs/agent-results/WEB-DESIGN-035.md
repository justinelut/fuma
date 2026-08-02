# WEB-DESIGN-035 — `/legal` policy register redesign

## Result

Recomposed `/legal` as a whole-page Fuma policy register rather than a generic card index. Every current notice now carries its compiler-approved title and description, exact version, effective/update/review dates, accountable review owner, canonical destination, version-history entry point, and exact source-byte receipt in one continuous ruled record.

The page’s signature is the relationship between that register and the exact policy-set manifest: publication evidence is visible and cryptographically bound, while the current approval state remains plainly pending with zero recorded approvals. The design does not infer legal review, privacy review, trust-and-safety review, counsel, compliance, certification, or production approval from repository publication.

## Changed files

- `apps/web/app/legal/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-035.md`

No shared component, global style, design token, policy source, approval manifest, legal compiler, history contract, test, generated artifact, dependency, lockfile, server, snapshot, or other route was edited.

## Design direction

- **Subject:** Fuma’s maintained public-website notices and the exact repository evidence attached to their current versions.
- **Audience:** a person who needs the current policy text, its maintenance clock and owner, or truthful evidence of whether the exact set has been approved.
- **Page job:** make all four notices and their maintenance records inspectable without allowing publication, a digest, or a test result to masquerade as approval.
- **Signature:** a continuous **policy register + approval-evidence signature**. Each policy row terminates in its exact source SHA-256 receipt; the separate manifest record binds those receipts to one policy-set digest and reports the real approval state.
- **Information architecture:** policy-record thesis → current collection/manifest strip → complete current policy register → required-role and manifest evidence signature → maintained legal/trust/contact navigation.
- **Typography:** inherited Fuma display type for the thesis and register decisions, body type for exact descriptions and boundaries, and mono type only for versions, labels, routes, and cryptographic evidence.
- **Layout:** an asymmetric opening resolves into one full-width ruled ledger. The approval section pairs review-role evidence with one manifest block; the ending is a ruled route directory. Repeated cards, dashboard tiles, badges, fake controls, policy illustrations, and decorative ordinal numbering were removed.
- **Palette:** inherited global semantic roles only: background/foreground, muted foreground, soft/strong lines, inset surface, signal link decoration, and the reserved live role only for the truthful current-publication marker. No route-local color value exists.
- **Effects:** none. The route adds no gradient, glow, shadow, bloom, rim light, animation, inline style, or stylesheet.
- **Aesthetic risk:** cryptographic source receipts are promoted into the primary visual register rather than hidden in implementation detail. That density is justified because receipt identity is the fact that distinguishes “these words are published” from “someone approved some words.” The rest of the page remains quiet and typographic.
- **Self-critique applied:** an early status-panel direction risked becoming another legal dashboard and giving the pending label decorative prominence without enough evidence. The final design makes policy records primary, then shows the pending state only beside required roles, zero recorded approvals, manifest issue data, supersession state, and the exact set digest.
- **Closed positioning:** Fuma remains the sole product and public policy surface. No self-hosting, open-source, operator, infrastructure, database, deployment, or alternate-platform positioning was introduced.

The required `frontend-design` skill was applied after reviewing the target route; measured Fuma design reference; global semantic roles, type scale, and shared shell; the whole-page `/trust` composition; legal detail/history routes; all four maintained legal sources; editorial loader/compiler and public eligibility rules; exact-byte approval manifest validator; forward-only legal history contract; metadata helper; and focused legal/trust/SEO/accessibility tests. The `graphify` guidance was also reviewed; no `graphify-out/graph.json` exists, so direct contract inspection was used rather than inventing a graph query or rebuilding the repository for this bounded two-file ticket.

## Maintained policy register

`readEditorial()` remains the sole source of visible policy content and metadata. It compiles disk sources, validates strict public frontmatter and timestamps, excludes drafts/future content, fails overdue review state, validates links, and emits canonical paths. The page filters that already-validated projection to `collection === 'legal'` and preserves deterministic slug order.

All four current policies remain present:

1. `acceptable-use` — **Acceptable use notice**, version `2026-07-26`, effective `2026-07-26`, updated `2026-07-27`, review due `2026-10-26`, owner `Trust and safety review owner`.
2. `cookies` — **Cookies and browser storage notice**, version `2026-07-26`, effective `2026-07-26`, updated `2026-07-27`, review due `2026-10-26`, owner `Privacy review owner`.
3. `privacy` — **Public website privacy notice**, version `2026-07-26`, effective `2026-07-26`, updated `2026-07-27`, review due `2026-10-26`, owner `Privacy review owner`.
4. `terms` — **Public website terms of use**, version `2026-07-26`, effective `2026-07-26`, updated `2026-07-27`, review due `2026-10-26`, owner `Legal review owner`.

Titles link to the compiler-owned canonical paths. Each record also exposes an explicit “Read current notice” action and the maintained `/legal/history` entry point. The page does not manufacture a superseded version, alternate canonical, policy summary, review identity, legal entity, provider, or deadline.

## Approval-evidence signature

`readLegalPolicyApprovalManifest()` remains the only approval-evidence authority. Before the page receives it, the validator checks the closed policy slug set, ordering and completeness, receipt versions, exact source bytes, receipt digest, timestamps, required roles, approval role uniqueness, target digest equality, state/approval consistency, and withdrawal consistency.

The rendered current evidence is exactly:

- manifest schema version `2` and manifest version `2026-07-26.1`;
- issued at `2026-07-26T00:00:00Z`;
- no superseded policy set recorded;
- approval state `pending`;
- required roles `legal`, `privacy`, and `trust-and-safety`;
- zero approval records and no named actor;
- policy-set SHA-256 `5ccdab79a5b6e63607437817851f46cd5160d92ea65d7dbce42de16526a2ef2b`;
- each source SHA-256 from the manifest attached to its matching current register row.

Pending rows say “Required · no approval recorded.” The page explicitly says that the signature identifies the repository source set and does not establish legal, privacy, trust-and-safety, compliance, certification, or launch approval. Future non-pending states can render only records that first pass the maintained manifest validator; there is no editorial fallback or fabricated reviewer.

## SEO, links, and accessibility

- `publicMetadata(...)` is unchanged, retaining the exact `https://fuma.co.ke/legal` canonical, index/follow behavior, `en-KE` and `x-default` alternates, feed discovery, Open Graph/Twitter metadata, and app-owned social image.
- Exactly one H1 labels the page. Each major region is H2-led; individual policies and the manifest are H3-led in a valid hierarchy.
- The policy register uses labelled `<article>` records, definition lists for exact metadata, machine-readable `<time dateTime>` values, and native links. Approval requirements use a native list; the manifest is a labelled complementary `<aside>`.
- The live-colored dot marks only the truthful current repository-publication state and is hidden from assistive technology; text carries the state independently.
- The in-page register link is a native fragment. All route transitions use `next/link`, retain visible underlines or hover underlines, inherited focus-visible treatment, and at least 44 px minimum target height where action-oriented.
- Responsive grids collapse in source order with no fixed-width content, image, client island, motion dependency, or horizontal cryptographic overflow; hashes use safe breaking.
- Legal navigation preserves `/legal/history`, `/trust`, and `/contact`. All four canonical current policy paths remain linked.

## Focused validation evidence

Validation followed ticket scope. No aggregate test suite, root/full lint, typecheck, build, server, browser/E2E process, screenshot, or snapshot was run.

- Language-service diagnostics for `apps/web/app/legal/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/legal/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-trust-acceptance.test.tsx tests/public-web-trust.test.tsx tests/public-web-trust-architecture.test.ts` from `apps/web` — **PASS**, 18 tests, 0 failures, 129 expectations. This covers exact-byte policy receipts and set digest, real pending approval state, all four canonical policies, forward-only history and prior-text preservation, effective/review dates and owners, canonical metadata, malformed-route noindex behavior, accessible legal content, claim-free evidence, and architecture boundaries.
- Direct no-server React render of `app/legal/page.tsx` — **PASS**, 16,902-byte HTML. Assertions verified the main landmark, exactly one H1, policy-register signature, all four policy links, effective/review dates, all maintained review owners, policy history/trust/contact links, exact policy-set digest, `Approval state: pending`, zero recorded approvals, canonical `https://fuma.co.ke/legal`, and absence of unsupported certification/SLA strings.
- Exact target-file forbidden-source audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH colors, gradients, shadows, glows, Fuma ambient effects, inline styles, card primitives, named certification/compliance claims, uptime/SLA figures, non-Fuma positioning, or deployment/database language.
- No-index whitespace checks for `apps/web/app/legal/page.tsx` and `docs/handoffs/agent-results/WEB-DESIGN-035.md` — **PASS**, both files produced no whitespace-error output. This form was used because the checkout reports both ticket files as untracked, so an ordinary tracked diff check would not inspect them.

## Acceptance boundary

Per ticket scope, no server, browser, Playwright/E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.
