# WEB-DESIGN-030 — Trust centre redesign

## Result

Recomposed `/trust` as a whole-page Fuma trust centre organized around an **evidence / boundary map** rather than generic security badges or equal-weight compliance cards. The page now traces each public surface from boundary, to what may pass, to its maintained evidence route, to the exact conclusion that must not be drawn.

The trust centre also reads the current legal collection and exact policy approval manifest at render time. Policy versions, effective dates, review owners, review due dates, required review roles, approval state, and policy-set digest therefore remain attached to their maintained sources instead of becoming manually duplicated claims.

## Changed files

- `apps/web/app/trust/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-030.md`

No shared component, global style, design token, trust contract, legal source, manifest, status/contact/security route, test, generated artifact, dependency, lockfile, server, or other file was edited.

## Design direction

- **Subject:** Fuma’s repository-backed public trust, policy, contact, security, and status boundaries.
- **Audience:** a prospective customer, evaluator, reporter, or reviewer who needs to determine what Fuma’s public record actually establishes before relying on it.
- **Page job:** make every maintained trust surface findable, show the exact current policy maintenance record, and prevent repository evidence from being mistaken for certification, uptime, delivery, approval, or launch evidence.
- **Signature:** an **evidence / boundary map** with four stable reading columns: the boundary, what passes, the maintained evidence, and where the claim stops. It is a factual routing instrument rather than a badge wall, risk score, generic compliance matrix, or decorative architecture diagram.
- **Information architecture:** trust thesis and primary routes → evidence/boundary map → live policy maintenance ledger → exact-byte manifest and pending review state → evidence/authority/approval distinction → specialist route directory and current-notice links.
- **Typography:** the approved Fuma Plus Jakarta Sans display, Inter body, and JetBrains Mono evidence roles are inherited from the global system. Display type carries the trust thesis; body type explains boundaries; mono is limited to boundary labels, versions, dates, roles, and the SHA-256 value.
- **Layout:** asymmetric Fuma section compositions, one continuous map surface, ruled policy records, one restrained manifest aside, and a route directory. There is no repeated card grid.
- **Palette and effects:** semantic global roles only: background, foreground, muted foreground, border/line roles, signal link decoration, and inset surface. The route introduces no raw color, local alpha, gradient, shadow, glow, inline style, local stylesheet, or motion effect.
- **Aesthetic risk:** the page makes the “negative space” of trust—the conclusion evidence cannot support—the dominant fourth column of its signature surface. This gives the page a specific due-diligence identity without inventing scores or turning limitations into warning decoration.
- **Self-critique applied:** a first-pass trust dashboard could have become six familiar compliance cards with labels and status dots. That would imply equivalence between unrelated boundaries and make pending authority look like a status badge. The final design removes badges, scores, icons, invented states, and card repetition; it uses a single inspectable map and exact maintained records instead.
- **Closed positioning:** Fuma is presented as the owner of this public trust centre and its routes. No open-source, self-hosting, deployment, infrastructure, database-ownership, alternative-platform, provider, or external-certification positioning was introduced.

The required `frontend-design` skill was applied after reviewing the current route, approved Fuma measured design system, global semantic token/type system, whole-page Fuma compositions, trust-surface reference, trust architecture/acceptance tests, security/status/contact/legal routes, legal policy component, all current policy sources, and approval manifest. No `graphify-out` graph existed, so direct code and contract inspection was used instead of a graph query.

## Maintained facts and authority boundaries

### Evidence / boundary map

The map preserves five distinct boundaries without turning any into an assurance claim:

1. **Browser and session:** public delivery and same-origin submissions do not establish a product, identity, administration, member, or tenant session.
2. **Submission:** strict public validation precedes a private routing attempt; accepted-for-routing does not prove delivery or a response time.
3. **Security:** the dedicated page and machine-readable discovery route provide entry points without implying acknowledgement, safe harbour, remediation, disclosure timing, or reward.
4. **Operational status:** only fresh strict authority data crosses into the summary; every invalid or unavailable result remains an explicit unavailable state and does not become uptime or operational evidence.
5. **Policy publication:** current source bytes, metadata, and history are repository records; publication does not establish legal, privacy, trust-and-safety, compliance, certification, or launch approval.

The map links to the existing owning routes. It does not copy a status result, contact destination, recipient, incident, provider, security finding, reviewer identity, approval, response time, or availability claim into `/trust`.

### Policy maintenance ledger

- `readEditorial()` remains the sole current policy-content projection. The trust route filters its already-validated public entries to the legal collection and sorts by slug for stable presentation.
- Every notice title, description, canonical slug, version, effective timestamp, review owner, and review-due timestamp comes from the validated `EditorialEntry` metadata.
- Policy links are derived from the validated legal slug and remain under `/legal/*`.
- Effective and review values use machine-readable `<time dateTime>` elements while displaying the maintained ISO calendar date.
- No superseded version, named counsel, approval actor, review completion, or future policy state is inferred.

### Exact policy-set review state

- `readLegalPolicyApprovalManifest()` remains the authority for approval state, required roles, and the exact current policy-set SHA-256.
- The page truthfully renders the current `pending` state and that no named approval is recorded for the exact set.
- Required legal, privacy, and trust-and-safety roles are displayed as required review roles, not as completed approvals or named people.
- Repository evidence, owning authority, and approval are explicitly separated. Passing code controls are not substituted for legal, privacy, security, accessibility, operations, or production approval.

## Preserved trust routes

The page retains direct, descriptive access to:

- `/security`
- `/status`
- `/contact`
- `/privacy-request`
- `/legal`
- `/legal/history`
- `/legal/privacy`
- `/legal/terms`
- `/legal/cookies`
- `/legal/acceptable-use`

The specialist directory explains which record owns each question. The trust centre remains an index and does not absorb or replace the security, status, contact, privacy-request, policy, or policy-history contracts.

## SEO and accessibility

- `publicMetadata` retains canonical `/trust` metadata and uses a claim-bounded description.
- One H1 states the page thesis. H2 sections establish the boundary map, policy ledger, review state, and route directory; row and record titles use H3s.
- Every major section is connected with `aria-labelledby`.
- Primary, specialist, trust-resource, and current-policy navigation landmarks have distinct accessible labels.
- The boundary map uses a semantic list, visible mobile field labels, and a desktop column guide hidden from assistive technology; meaning does not depend on position, color, icon, hover, or JavaScript.
- Policy records are semantic articles with definition lists and machine-readable times.
- The manifest is a labelled aside; its digest remains complete and wraps instead of truncating.
- Links acting as route actions preserve at least 44 px target height. Shared focus-visible, forced-color, wrapping, and reduced-motion behavior remains inherited.
- The route adds no client island, hydration-dependent content, autoplay, local animation, hover-only meaning, image, or fabricated structured data.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate test suite, full build, full typecheck, full lint, development server, browser/E2E run, screenshot, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/trust/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint app/trust/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-trust-acceptance.test.tsx` from `apps/web` — **PASS**, 6 tests, 0 failures, 28 assertions. This verifies the exact current policy set/digest and pending approval, canonical legal index, all current policies, bounded `security.txt`, status time semantics, and same-origin form/security headers.
- `bun test tests/public-web-trust-architecture.test.ts` from `apps/web` — **PASS**, 2 tests, 0 failures, 16 assertions. This verifies no prohibited certification/provider/session-authority dependencies or claims and preserves strict server-owned contact/status boundaries.
- Direct Bun server render of the changed route — **PASS**. Eighteen required markers verified the evidence map, thesis, exact pending policy-set digest, maintained review owners/date, all specialist and legal links, exactly one H1, canonical `https://fuma.co.ke/trust` metadata, and absence of prohibited certification/SLA/uptime claims.
- Forbidden style/positioning source audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH colors, gradients, shadows, glows, inline styles, named certifications, uptime percentages, SLA guarantees, guaranteed response language, and open-source/self-host/deployment/database positioning.
- Required authority/semantic source audit — **PASS**, confirming both maintained reads, boundary-map marker, labelled landmarks, ordered heading levels, machine-readable times, review owner/date fields, approval state/digest, and every required trust/legal link.

## Acceptance boundary

Per ticket scope, no build, server, browser, E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.
