# WEB-DESIGN-034 — Service status redesign

## Result

Recomposed `/status` as a whole-page Fuma operational record rather than a simulated uptime dashboard. The route now keeps three facts visually and semantically attached: whether a fresh authority response crossed the boundary, the exact time attached to that read, and the narrow public conclusion the response permits.

Its signature is the **current authority trace**: fresh authority → exact observation → bounded conclusion. That trace changes coherently between a fresh accepted response and the safe unavailable state. Incident and on-call fields sit behind a second detail boundary and render only when the same accepted response supplies them.

## Changed files

- `apps/web/app/status/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-034.md`

No shared component, status authority, cache boundary, global style, design token, shell, contract, test, dependency, lockfile, server, generated artifact, or other route was edited.

## Design direction

- **Subject:** Fuma’s current public operational reading and the authority boundary around it.
- **Audience:** a customer, evaluator, reporter, or operator who needs to know what Fuma can truthfully state now without mistaking one read for historical availability evidence.
- **Page job:** show one current authority result, make its observation time exact, expose supplied incident/coverage detail only when permitted, and prevent unavailable or current data from expanding into uptime, provider, SLA, response-time, or incident-history claims.
- **Signature:** a semantic figure containing a three-part authority trace: freshness gate, observation/attempt timestamp, bounded conclusion. Its caption encodes the actual reading path rather than adding decorative steps.
- **Information architecture:** operational thesis → current authority trace → conditional incident/coverage boundary → strict freshness/no-store reading rules → separately owning status, trust, and security records.
- **Typography:** inherited Fuma display, body, and mono roles. Display type carries conclusions, body type explains boundaries, and mono is reserved for evidence labels, incident identifiers, exact UTC timestamps, and state metadata.
- **Layout:** a wide asymmetric opening resolves into one continuous three-column record, then ruled detail and definition-list structures. It avoids metric cards, uptime charts, incident timelines, badges, and repeated dashboard tiles.
- **Palette:** inherited semantic roles only: background, foreground, muted foreground, inset surface, soft/strong lines, and `live` solely for the accepted current-authority marker. No route-local color value exists.
- **Effects:** none. The page adds no route-local gradient, shadow, glow, bloom, blur, animation, inline style, or stylesheet.
- **Aesthetic risk:** the page makes the evidence chain—not a large status dot or percentage—the dominant visual artifact. The primary conclusion remains deliberately incomplete until read with its authority and timestamp.
- **Self-critique applied:** the obvious status-page treatment would be a green hero, uptime percentage, service grid, and fabricated incident history. That would be visually generic and factually unauthorized. The final composition spends its emphasis on provenance and degradation behavior instead; even the unavailable state retains the complete information architecture without manufacturing operational detail.
- **Closed positioning:** Fuma is the named product and status scope. No provider, host, infrastructure stack, self-hosting, open-source, database, deployment, monitoring vendor, SLA, on-call identity, or operational ownership claim was introduced.

The required `frontend-design` skill was applied after reviewing the target route, status boundary and schema, status summary component, strict trust/status behavior tests, trust architecture tests, measured Fuma public-web design reference, global semantic roles/type system, shell, adjacent trust/security whole-page compositions, and route package scripts. `graphify-out/graph.json` was checked first and was absent, so direct contract and code inspection was used rather than a graph query.

## Maintained authority and degradation boundary

The page continues to call `readPublicStatus()` as its only operational source. No data is copied into route constants or reconstructed from presentation state.

### Fresh accepted response

A response can appear as current only after the existing boundary verifies:

- configured HTTPS authority and bounded server-owned bearer credential;
- no-store fetch behavior and redirect refusal;
- successful response and bounded JSON size;
- strict schema version and `public-web` scope;
- one permitted status: `operational`, `degraded`, or `outage`;
- current canonical UTC status and coverage timestamps inside the five-minute window;
- coherence between status and incident presence;
- valid incident ordering and bounded authority fields.

The redesigned page then renders only fields present in that accepted projection:

- authority-reported status and message;
- exact `checkedAt` value;
- incident identifier, state, summary, start, and update values when an incident exists;
- authority-reported on-call coverage and its own check time;
- a separately configured safe HTTPS status-page URL when present.

The external status-page action uses a native anchor with `rel="noopener noreferrer"` and does not label the destination as uptime or incident history.

### Safe unavailable response

Missing configuration, stale data, malformed or additional fields, redirect behavior, oversized payloads, failed requests, invalid timestamps, and incoherent status/incident combinations all continue to resolve to the same `availability: 'unavailable'` view.

In that state the page:

- says fresh authority is unavailable;
- labels the local timestamp as **Boundary attempted**, never **Last observed**;
- retains the exact machine-readable UTC attempt value;
- publishes **No status claim** as the conclusion;
- renders the boundary’s maintained claim-free message;
- suppresses all incident and on-call detail;
- explains that no previous reading is substituted.

No current state is retained locally and no availability, incident, monitoring, coverage, provider, response, or resolution fact is inferred.

## Freshness, cache, locale, and exact time

- `dynamic = 'force-dynamic'` and `revalidate = 0` remain in place.
- `fetchCache = 'force-no-store'` makes the route-level no-store intent explicit in addition to the authority fetch’s existing `cache: 'no-store'` contract.
- The authority boundary still uses `redirect: 'error'`; no redirect target can become an authority response.
- Human-readable timestamps use the functional technical locale `en-KE` and timezone `Africa/Nairobi`.
- Every displayed timestamp retains the exact source ISO UTC value in a visible mono `<code>` value and its machine-readable `<time dateTime>` attribute.
- Current reads use `checkedAt`; unavailable reads use `attemptedAt` with distinct language so an attempt cannot be mistaken for a status observation.

## Claim boundary

The route explicitly does **not** claim or invent:

- availability percentages or an uptime record;
- incident history, unreported incidents, or a historical all-clear;
- a monitoring, hosting, cloud, status-page, or on-call provider;
- a service-level agreement, contractual service level, or launch approval;
- response, acknowledgement, restoration, remediation, or resolution timing;
- an on-call person, team, schedule, or escalation path;
- a provider relationship or infrastructure architecture.

An accepted operational response with no incident renders the exact narrow statement that the accepted response carries no incident projection, plus the explicit qualification that this is not incident history. Degraded and outage states require an authority-supplied incident before crossing the existing coherence boundary.

## SEO and accessibility

- `publicMetadata(...)` preserves canonical `https://fuma.co.ke/status`, index/follow behavior, locale alternates, feed discovery, and the app-owned social image contract.
- Metadata describes a fresh authority reading, exact observation time, and claim boundary without advertising uptime or availability.
- The page has one H1. Each major section is H2-led; conditional incident/detail records use H3 headings.
- The current authority trace is a native figure with figcaption. Its three facts remain readable in source order when the layout collapses.
- The changing current read is one polite, atomic `role="status"` live region.
- Incident and coverage values use native article and definition-list semantics. Reading rules use a native definition list.
- Every date has a `<time dateTime>` representation and visible exact ISO UTC value.
- The external configured route is distinguishable from internal `next/link` navigation and carries safe rel attributes.
- Route-owned interactive rows maintain at least 44 px target height and inherit shared focus-visible and forced-color behavior.
- Meaning does not depend on color, motion, hover, iconography, client JavaScript, or visual position. The mint state role is supplementary and limited to fresh accepted authority.
- Responsive grids collapse to one column without fixed-width content or horizontal overflow.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate test suite, full/root build, full typecheck, full lint, development server, browser/E2E process, screenshot, or snapshot was run.

- Language-service diagnostics for `apps/web/app/status/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/status/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-trust.test.tsx tests/public-web-trust-acceptance.test.tsx tests/public-web-trust-architecture.test.ts` from `apps/web` — **PASS**, 18 tests, 0 failures, 129 expectations. This covers strict fresh authority acceptance, no-store/redirect refusal, stale/malformed/oversized/failed safe degradation, status live-region and safe-link semantics, `en-KE`/`Africa/Nairobi` with retained ISO values, and architecture claim/provider gates.
- Direct no-server static render with unconfigured authority — **PASS**, 7,648-byte HTML. It verified main structure, exactly one H1, polite status region, current-authority trace, boundary-attempt language, no-status conclusion, suppressed fields, exact ISO time, Africa/Nairobi display, trust/security links, canonical `/status` metadata, and all three no-store route exports.
- Direct no-server static render with a fresh degraded fixture — **PASS**, 9,560-byte HTML. It verified no-store and redirect-refusing authority fetch options; accepted/fresh language; degraded conclusion; only the supplied message, incident ID/state/summary/timestamps, and coverage record; safe configured external link; and absence of unavailable-state leakage.
- `git diff --check -- apps/web/app/status/page.tsx` — **PASS**, exit status 0.
- Forbidden route-style audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH colors, gradient utilities, route-local shadows/drop-shadows/blurs, Fuma bloom/glow/pool/rim-light effects, or inline styles.
- Required route-source audit — **PASS**, confirming `force-dynamic`, zero revalidation, force-no-store fetch cache, strict status read, polite live status, machine-readable dates, Africa/Nairobi display, no-status fallback, conditional safe external route, and noreferrer protection.

## Acceptance boundary

Per ticket scope, no build, server, browser, Playwright/E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.
