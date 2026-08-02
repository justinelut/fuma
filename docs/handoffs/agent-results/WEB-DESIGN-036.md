# WEB-DESIGN-036 — `/legal/[slug]` current-policy document redesign

## Result

Recomposed every current `/legal/[slug]` route as a premium long-form Fuma policy instrument rather than a generic article inside a card shell. The complete compiler-rendered policy remains the primary document, while its effective version, maintenance clock, exact source receipt, policy-set digest, required review roles, and real approval state remain visibly attached.

The page’s signature is a truthful three-part evidence relationship: **exact policy source → exact policy set → recorded review state**. It makes source identity inspectable without allowing a repository receipt, digest, publication event, review-owner label, or passing test to masquerade as legal, privacy, trust-and-safety, compliance, certification, counsel, or production approval.

## Changed files

- `apps/web/app/legal/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-036.md`

No shared component, global style, design token, policy source, approval manifest, legal compiler, legal history contract, metadata helper, test, dependency, lockfile, generated artifact, server, snapshot, or other route was edited.

## Design direction

- **Subject:** one current Fuma public-website policy and the maintained record that identifies its exact version and review state.
- **Audience:** a reader who needs the complete current notice, its effective/review dates, its accountable maintenance role, or evidence of the exact source and approval state.
- **Page job:** preserve premium long-form readability while keeping the current text inseparable from its version, receipt, history, and truthful review relationship.
- **Signature:** a semantic review-evidence figure connecting the policy’s exact source SHA-256 receipt to the exact policy-set SHA-256 digest and then to the maintained required-role records.
- **Information architecture:** exact policy identity → effective-version/owner/review strip → full maintained notice with on-page navigation → source/set/review signature → maintained history/index/trust/contact routes.
- **Typography:** inherited Fuma display type for document identity and major conclusions, body type for legal text and boundary explanations, and mono type only for versions, evidence labels, slugs, timestamps, routes, and hashes.
- **Layout:** an asymmetric document opening resolves into a full-width reading section with the compiler-owned table of contents, then a two-part review signature and a ruled record directory. It avoids policy cards, dashboard metrics, status badges, fake seals, decorative numbering, illustrations, and repeated panels.
- **Palette:** shared semantic roles only: background, foreground, muted foreground, soft/strong lines, and signal link decoration. No route-local color or raw color value exists. The reserved live role is intentionally absent because publication and approval state are already explicit in text and do not need a decorative status light.
- **Effects:** none. The route adds no gradient, glow, shadow, bloom, rim light, blur, animation, inline style, or stylesheet.
- **Aesthetic risk:** cryptographic source identity is promoted into the page’s main editorial hierarchy rather than hidden as implementation detail. The visual chain is deliberately dense, but each step encodes a real relationship and the rest of the document remains quiet.
- **Self-critique applied:** the obvious approach was a sticky “policy status” card with a bright pending badge. That would overstate an administrative label and compete with the actual policy. The final design instead gives the maintained notice the broadest reading surface and treats approval as a separate evidence relationship with exact roles, counts, timestamps, and digests.
- **Closed positioning:** Fuma is the sole product and policy surface. No self-hosting, open-source, operator, deployment, infrastructure, provider, database, alternate-platform, or external-counsel positioning was added.

The required `frontend-design` skill was applied after reviewing the target route, measured Fuma semantic roles and type system, shared shell, `/legal`, `/legal/history`, `/trust`, `/security`, and `/privacy-request` compositions, all four maintained legal sources, editorial loader/compiler and render path, exact-byte approval manifest validator, forward-only version history contract, metadata/structured-data helpers, and focused trust/legal/architecture tests. The `graphify` guidance was reviewed and `graphify-out/graph.json` was checked; it is absent, so bounded direct contract inspection was used rather than inventing a graph result or rebuilding the repository for this two-file ticket.

## Maintained policy text and record

`getEditorial('legal', slug)` remains the only policy source. It resolves from `readEditorial()`, whose compiler validates strict public frontmatter, timestamps, review windows, components, links, heading hierarchy, canonical paths, publication state, and overdue review state before returning an entry.

`<EditorialContent entry={entry} />` remains the sole body renderer. It renders every compiler block in source order, preserves native heading hierarchy and IDs, retains safe links, labels keyboard-scrollable code blocks, and exposes a native on-page navigation list. No route-authored paraphrase, shortened legal body, substitute summary, or generated policy clause replaces the maintained text.

Every available detail route now shows:

- exact maintained title, description, category, slug, and canonical path;
- current version and effective date;
- updated date;
- accountable review-owner label;
- review-due date;
- every maintained policy heading and complete compiled body;
- exact matching source SHA-256 receipt;
- exact containing policy-set SHA-256 digest and manifest version/issue date;
- exact approval state, recorded approval count, required-role count, and role records;
- withdrawal detail only when the validated manifest supplies it;
- superseded policy-set digest only when the validated manifest supplies it;
- policy history, complete legal index, trust centre, contact route, and canonical current-record link.

The current maintained set remains four policies—`acceptable-use`, `cookies`, `privacy`, and `terms`—all at version `2026-07-26`. Static parameter order and values remain unchanged.

## Approval and history truth boundary

`readLegalPolicyApprovalManifest()` is now read directly by the detail route after a valid public policy is found. Before presentation, that existing boundary validates the closed and sorted policy set, receipt versions, exact source bytes, receipt/set digest, canonical timestamps, unique required roles, approval target equality, pending/approved/withdrawn coherence, and withdrawal target equality.

The current manifest truth is rendered without embellishment:

- approval state `pending`;
- zero recorded approvals for three required roles;
- required roles `legal`, `privacy`, and `trust-and-safety`;
- no named approval actor;
- no withdrawal record;
- no earlier policy-set digest recorded;
- manifest version `2026-07-26.1`, issued `2026-07-26T00:00:00Z`;
- policy-set SHA-256 `5ccdab79a5b6e63607437817851f46cd5160d92ea65d7dbce42de16526a2ef2b`.

Future approved or withdrawn states can display only records admitted by that same validator. Approved records show the manifest-maintained role, actor, and approval timestamp. A withdrawal section exists only when a validated withdrawal supplies its reason, actor, and timestamp. Missing records are labelled “Required · no approval recorded”; no placeholder actor, reviewer, counsel, legal entity, approval date, certification, compliance outcome, or launch decision is invented.

The review owner from policy frontmatter remains explicitly a maintenance owner, not an approver. `/legal/history` remains the authority for current and future superseded public versions; the detail route does not manufacture prior policy text. The manifest’s `supersedesPolicySetSha256` is displayed separately from policy version history so a set-level relationship cannot be confused with archived policy content.

## Available, missing, and malformed states

- **Available exact slug:** the strict lowercase/digit/hyphen slug passes `LEGAL_SLUG`, resolves through the public editorial compiler, then receives a matching exact-byte manifest receipt. Only then does the full route render.
- **Valid but missing slug:** `getEditorial()` returns `null`; metadata uses canonical `https://fuma.co.ke/legal/unavailable` with `noindex, nofollow`, and the page calls `notFound()`.
- **Malformed slug:** the strict slug gate prevents lookup; metadata uses the same noindexed unavailable canonical, and the page calls `notFound()`.
- **Missing receipt:** the detail route throws before rendering a policy-evidence relationship. It does not emit an empty hash or editorial approval fallback.
- **Malformed policy source:** editorial compiler validation throws before the entry can become public; the route has no raw-file or hardcoded fallback.
- **Malformed, byte-mismatched, incomplete, incoherent, or cross-digest approval manifest:** maintained manifest validation throws before presentation; the route has no catch that could transform invalid evidence into a public approval claim.
- **Draft, future, or overdue policy:** the existing public editorial boundary excludes or rejects it before route resolution; there is no route-local availability override.

The route deliberately resolves the policy before reading the approval manifest, so missing and malformed slug requests remain bounded 404 states rather than evaluating evidence for a document that is not public.

## SEO, security, accessibility, and responsive behavior

- `dynamicParams = false`, `generateStaticParams()`, strict `LEGAL_SLUG`, exact `getEditorial('legal', slug)`, and `notFound()` behavior are preserved.
- `publicMetadata(...)` preserves exact current canonicals, `en-KE`/`x-default` alternates, feed discovery, index/follow for available policies, and the noindexed `/legal/unavailable` canonical for missing or malformed input.
- Structured data remains serialized through `jsonLd(...)`, not interpolated into executable script text, and uses only maintained policy metadata plus the existing Fuma website identity.
- The route has one H1. Major regions are H2-led; the required-review aside uses an H3. The maintained policy’s H2/H3 hierarchy follows beneath the route’s maintained-notice section.
- Policy metadata uses native definition lists and machine-readable `<time dateTime>` values. The evidence relationship uses a native figure, ordered relationship list, and figcaption. Required roles and record navigation use native lists.
- The complete policy remains in an `<article>` through `EditorialContent`; its table of contents remains a labelled native `<nav>`.
- Hashes use safe breaking. Grids collapse in source order without fixed content widths, client islands, motion dependencies, or route-local overflow effects.
- All route transitions use `next/link`, visible underline affordances, inherited focus-visible treatment, and at least 44 px minimum target height where action-oriented. No external target or recipient is introduced.
- Meaning does not depend on color, hover, iconography, animation, JavaScript hydration, or visual position.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate test suite, root/full lint, full typecheck, build, server, browser/E2E process, screenshot, or snapshot was run.

- Language-service diagnostics for `apps/web/app/legal/[slug]/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/legal/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-trust-acceptance.test.tsx tests/public-web-trust.test.tsx tests/public-web-trust-architecture.test.ts` from `apps/web` — **PASS**, 18 tests, 0 failures, 129 expectations. This covers exact-byte policy receipts/set digest, real pending approval state, all four static policy routes, forward-only version history and prior-text preservation, effective/review metadata, malformed-route noindex behavior, safe legal content/links, structured claim boundaries, and architecture gates.
- Direct no-server React render of `/legal/privacy` — **PASS**, 13,577-byte HTML. Assertions verified the main landmark, exactly one H1, all five maintained privacy headings, review signature, exact privacy source receipt, exact set digest, effective version, review owner/date, zero approvals for three roles, policy history/trust/contact links, canonical metadata, exact four static params, malformed canonical/robots state, and absence of unsupported certification, uptime, response, or external-counsel claims.
- Direct no-server render of all four current policy routes — **PASS**. Every route contained its maintained title, description, version, owner, canonical path, every maintained heading, matching exact source receipt, and policy-history link.
- Direct valid-missing and malformed-slug checks — **PASS**. Both `missing-policy` and `privacy#attacker` produced a 404 path result plus canonical `https://fuma.co.ke/legal/unavailable` and `{ index: false, follow: false }` robots metadata.
- Direct malformed approval-evidence check — **PASS**. A policy-set digest mismatch was rejected by `validateLegalPolicyManifestState(...)` before rendering.
- Exact route forbidden-source audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH values, gradients, shadows, glows, ambient effects, inline styles, unsafe external targets, named counsel/law firms, certifications, regulated-framework claims, uptime figures, or SLA-guarantee language.
- Exact route required-contract audit — **PASS**, confirming static params, strict slug gate, not-found path, canonical/noindex metadata, complete editorial renderer, validated approval reader, source/set digests, structured-data serializer, and policy-history link.

## Acceptance boundary

Per ticket scope, no build, server, browser, Playwright/E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.
