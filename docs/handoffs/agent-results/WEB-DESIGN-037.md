# WEB-DESIGN-037 — `/legal/history` policy lineage register

## Result

Recomposed `/legal/history` as a whole-page Fuma policy-history register rather than a card grid or decorative timeline. The page now makes the actual lineage legible: this is the origin policy set, all four maintained notices are current at version `2026-07-26`, no predecessor set or superseded public text is recorded, and every record exposes its effective/update/review dates, review owner, canonical preserved text, and exact source-byte receipt.

The signature is a forward-only legal folio. The set-level lineage establishes where the record begins; the continuous ruled register then keeps version state and source identity attached to each notice. A separate preservation contract explains the enforced transition invariant without pretending that a prior version, reviewer, counsel, certification, or approval already exists.

## Changed files

- `apps/web/app/legal/history/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-037.md`

No shared component, global style, design token, policy source, approval manifest, legal compiler, history contract, test, generated artifact, dependency, lockfile, server, snapshot, or other route was edited.

## Design direction

- **Subject:** the version lineage and preserved public text of Fuma’s maintained public-website notices.
- **Audience:** a reader who needs to determine which version is current, whether an earlier version exists, what text was attached to a version, and which exact repository bytes support the record.
- **Page job:** expose complete maintained policy history and its limits without allowing publication evidence to read as legal approval.
- **Signature:** a continuous **forward-only policy folio**. Set-level origin/current lineage leads into one ruled version register; receipt identity sits in the record rather than in decorative metadata cards.
- **Information architecture:** policy-history thesis → current/prior/manifest summary → set lineage → complete version register → history-integrity and preservation contract → maintained legal/trust/contact routes.
- **Typography:** inherited Fuma display type carries the thesis and record decisions; body type explains boundaries; mono is restricted to versions, labels, hashes, and compact authority facts.
- **Layout:** an asymmetric opening resolves into broad ledger rows. Each row separates notice identity from its maintenance clock, source receipt, prior-state statement, and preserved-text action. No generic card collection, faux dashboard, ornamental timeline, illustration, or meaningless numbered section sequence was introduced.
- **Palette:** only global semantic roles are used: background/foreground, muted foreground, soft/strong lines, inset surface, signal link decoration, and the reserved live state for textually identified current versions. There are no route-local colors.
- **Effects:** none. The route adds no gradient, shadow, glow, ambient field, rim light, animation, inline style, or stylesheet.
- **Aesthetic risk:** cryptographic receipts and the absence of history are treated as first-class visual information. The page deliberately gives “none recorded” the same structural weight as a populated predecessor would receive, because an honest empty archive is more useful than timeline decoration implying activity that never happened.
- **Self-critique applied:** a conventional version timeline would have produced four identical one-node diagrams and visually implied missing events. The final composition uses one real set-level lineage and a document register, so sequence appears only where chronology is meaningful. A separate card-per-policy treatment was also removed because it fragmented dates, owner, receipt, and text access that must travel as one record.
- **Closed positioning:** the copy and navigation remain Fuma-owned. No self-hosting, open-source, operator, infrastructure, database, deployment, alternate platform, or external authority positioning was introduced.

The mandatory `frontend-design` skill was applied after inspecting the target route, adjacent `/legal` register, legal detail route, Fuma global semantic tokens and measured type/layout system, all four maintained policy sources, editorial compiler projection, exact-byte approval manifest authority, forward-only legal history contract, canonical metadata helper, and focused trust/legal tests. The `graphify` skill guidance was also reviewed; `graphify-out/graph.json` is absent, so no graph query was available and this bounded two-file change used direct source-contract inspection rather than rebuilding a repository-wide graph.

## Maintained history authority

The page reads two existing closed authorities in parallel:

1. `readEditorial()` supplies the compiler-validated current public legal entries. It preserves canonical paths, public eligibility, exact frontmatter version, published/update/review timestamps, descriptions, and maintained owners.
2. `readLegalPolicyApprovalManifest()` supplies the closed four-policy receipt set, exact source SHA-256 values, manifest issue/version data, predecessor pointer, approval state, approval records, and policy-set digest. Its reader re-hashes the disk source before returning and rejects metadata or byte mismatches.

Receipt lookup now fails closed for a displayed policy: if a legal entry has no matching manifest receipt, the route throws instead of rendering an empty or editorial substitute.

The rendered facts are exactly:

- manifest version `2026-07-26.1`, issued `2026-07-26`;
- current policy-set SHA-256 `5ccdab79a5b6e63607437817851f46cd5160d92ea65d7dbce42de16526a2ef2b`;
- no predecessor policy set (`supersedesPolicySetSha256: null`);
- approval state `pending`, zero recorded approvals;
- four current public notices, zero recorded prior versions;
- no superseded public policy text represented by the maintained sources.

The four complete current records remain:

1. `acceptable-use` — **Acceptable use notice**, version/effective `2026-07-26`, updated `2026-07-27`, review due `2026-10-26`, owner `Trust and safety review owner`, source receipt `de8b0736813f8db180c315251d07c7b5cc632198a97dabe9510d08c173a9f482`.
2. `cookies` — **Cookies and browser storage notice**, version/effective `2026-07-26`, updated `2026-07-27`, review due `2026-10-26`, owner `Privacy review owner`, source receipt `817264d9b883c4668196188e08deb460718ea3adbf315870503faeeea2e2e188`.
3. `privacy` — **Public website privacy notice**, version/effective `2026-07-26`, updated `2026-07-27`, review due `2026-10-26`, owner `Privacy review owner`, source receipt `ada85aa60d7d90395704bd7704f8d2ac2ed74122fe558df8bcdbd84f93015827`.
4. `terms` — **Public website terms of use**, version/effective `2026-07-26`, updated `2026-07-27`, review due `2026-10-26`, owner `Legal review owner`, source receipt `b0a87a2bab6841d5fbcd7837103a8273c02a5633a4145ae6bec34b312e18ac00`.

Every title and “Read preserved current text” action uses the compiler-owned canonical policy path. Every record explicitly states `Current · Version 2026-07-26` and `Superseded public versions: none recorded.` No historical route, document, summary, reviewer identity, approval date, approval body, counsel, certification, compliance status, or legal entity was fabricated.

## Forward-only and preservation integrity

The page reflects, but does not duplicate or weaken, `lib/legal-policy-history.ts`:

- candidate publication requires a complete closed policy version record;
- version identity cannot be reused;
- effective time must move strictly forward;
- the existing current record becomes prior rather than being mutated away;
- complete prior `content` remains in history;
- exactly one current record remains for that policy;
- invalid timestamps, review windows, duplicates, and overdue current review state fail validation.

Because no durable prior version is maintained today, the page does not manufacture a prior row or archival link. It says exactly that the recorded lineage begins at the current set. The preservation contract is prospective truth from the existing enforced history invariant, not a claim that preservation has already occurred.

## SEO, links, accessibility, and responsive behavior

- `publicMetadata(...)` retains the exact canonical `https://fuma.co.ke/legal/history`, index/follow behavior, `en-KE` and `x-default` alternates, feed discovery, Open Graph/Twitter metadata, and Fuma-owned social image.
- One H1 labels the page. Major regions use H2; each policy and the preservation aside use H3 in a valid hierarchy.
- The register is a native `<ul>` of labelled `<article>` records rather than a presentational table or clickable container. The actual three-step preservation sequence uses an ordered list because order is semantically material.
- All dates remain machine-readable `<time dateTime>` values. Exact metadata and hashes use definition lists. The set/policy state remains textually available; live dots are supplementary and hidden from assistive technology.
- In-page navigation is a native fragment. Route links use `next/link`, visible underline treatments, inherited focus-visible behavior, and at least 44 px action height.
- All four canonical notice links are preserved, alongside `/legal`, `/trust`, and `/contact`.
- Responsive grids collapse in DOM/source order. Hashes use safe breaking, and there is no fixed-width media, client island, motion dependency, or route-local overflow/effect surface.
- Approval boundaries are explicit: source identity does not establish legal, privacy, trust-and-safety, compliance, certification, counsel, or launch approval.

## Focused validation evidence

Validation stayed within ticket scope. No aggregate test suite, root/full lint, full typecheck, build, server, browser/Playwright E2E, screenshot, or snapshot was run.

- Language-service diagnostics for `apps/web/app/legal/history/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/legal/history/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-trust-acceptance.test.tsx tests/public-web-trust.test.tsx tests/public-web-trust-architecture.test.ts` from `apps/web` — **PASS**, 18 tests, 0 failures, 129 expectations. Coverage includes exact-byte policy receipts and set digest; truthful pending approval state; complete policy set; forward-only publication and preserved prior content; effective/review/owner facts; canonical SEO and malformed-route noindex; accessible legal content; claim-free authority boundaries; and architecture restrictions.
- Direct no-server React render of `app/legal/history/page.tsx` — **PASS**, 18,119-byte HTML. Assertions verified exactly one H1, the history-register landmark, all four canonical policy links, all four exact source receipts, current version labels, no-prior statements, preserved-text actions, maintained owners/review date, canonical `https://fuma.co.ke/legal/history`, and absence of unsupported counsel/approval/certification/SLA claims.
- Exact target-file forbidden-source audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH colors, gradients, shadows, glows, ambient/rim effects, inline styles, card primitives, named external counsel/approval, compliance/certification claims, or SLA/uptime guarantees.
- Exact target semantic-content audit — **PASS**, 26 matches confirming canonical metadata/manifest authorities, source receipt, effective/update/review/owner data, current/prior labels, canonical links, machine-readable time, and native section/article/list/navigation structure.

## Acceptance boundary

Per ticket scope, no server, browser, Playwright/E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later public browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.
