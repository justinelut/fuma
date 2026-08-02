# WEB-DESIGN-029 — `/start` transition redesign

## Result

Recomposed `/start` as a whole-page Fuma-owned transition experience centered on an **intent / resolution signature**. A valid public request now reads as one clear handoff folio: the exact intent category accepted by the public contract on one side, the application-owned resolution still pending on the other, followed by the real continue, pending, error and cancel paths.

The implementation does not imitate Studio, authentication, a dashboard or another application surface. It does not claim that identity, authority, availability, session creation or the requested outcome has already been resolved.

## Changed files

- `apps/web/app/start/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-029.md`

No shared component, client state machine, API route, contract, server/auth boundary, global style, design token, test, generated artifact, dependency, lockfile, snapshot or other file was edited.

## Design direction

- **Subject:** the one-way transition from Fuma’s public web origin to its application-owned resume boundary.
- **Audience:** a person who has selected one valid public action and needs to understand what will—and will not—happen next.
- **Page job:** confirm the request shape, identify the unresolved application outcome, explain the ownership boundary, and offer one real continue action plus one safe cancellation path.
- **Signature:** a responsive **intent / resolution folio**. The accepted intent and pending resolution occupy equal halves, joined by a directional rule. This is not decorative sequencing: it encodes the actual boundary from validated public request to post-auth authority resolution.
- **Information architecture:** accepted transition thesis → intent/resolution definition list → real handoff action and live state behavior → concise boundary record → safe cancel/security links.
- **Typography:** inherited Fuma display type for the transition thesis and exact intent/resolution names, body type for guidance, and mono only for state and boundary labels.
- **Palette and effects:** existing semantic Fuma roles only (`background`, `card`, `surface-inset`, `foreground`, `muted-foreground`, `border`, `line-strong`, `signal-bright`). The route adds no raw color, gradient, shadow, glow, inline style or page-local effect value. Its restrained entrance uses the existing reduced-motion-safe shared `fuma-rise` class.
- **Aesthetic risk:** the unresolved half is given the same visual authority as the accepted intent. A generic conversion page would make the button dominant and imply an already-known outcome; this composition makes uncertainty and re-resolution first-class, which is specific to this security handoff.
- **Self-critique applied:** an early concept considered a multi-step progress tracker, but that would resemble fake application UI and suggest durable progress states the public route does not own. The final design uses a semantic definition list and boundary record instead.
- **Closed positioning:** every visible product or destination reference remains Fuma-owned. No self-hosting, open-source, alternate-platform, infrastructure or deployment positioning was added.

The required `frontend-design` skill was applied after reviewing the measured Fuma design system, shared semantic classes, current route, `IntentForm`, public handoff API/target guards, the exact public closed union, app/auth resume contracts and focused security tests. The `graphify` guidance was also reviewed; no `graphify-out/graph.json` exists, so there was no existing graph to query and no graph rebuild was needed for this bounded two-file ticket.

## Intent and state behavior

### Valid request

The existing fail-closed parser remains intact:

- repeated query values still call `notFound()`;
- `KIND_KEYS` still allows only the exact fields belonging to the selected kind;
- the constructed value still must pass `PublicHandoffRequestSchema`;
- the exact six-kind union remains `sign_up`, `sign_in`, `create_site`, `choose_plan`, `use_template`, and `contact_expert`;
- malformed source/profile/cadence/ID/version values and every additional field still fail closed.

The presentation map is exhaustively typed against `PublicHandoffRequest['kind']`. It renders only a generic Fuma-owned intent and pending resolution label; it does not echo source, profile, plan ID, price-book version, cadence, template ID, expert ID, or any arbitrary request value into the page.

### Pending issuance

The existing `IntentForm` remains the sole interaction owner. On submission it enters its real busy state, disables the action and changes the label to “Preparing a safe transition…”. The page explains that issuance is pending rather than implying completion.

### Error

The existing client state machine remains unchanged. A failed response, malformed response or target rejected by `safeAppResumeUrl` keeps the person on `/start` and renders the existing assertive `role="alert"` error. The new page copy explicitly states that no fallback destination is used.

### Cancel

The route exposes one explicit internal cancellation link to `/`. It does not attempt to cancel an app/auth-owned intent that has not yet been issued. App/auth cancellation after issuance remains owned by the mounted application boundary.

## Security and ownership preservation

- Metadata remains `publicMetadata(..., '/start', true)`, preserving `noindex, nofollow` and the canonical `/start` surface.
- `IntentForm`, `/api/handoff`, `issueHandoff`, `safeAppResumeUrl` and their cookie/credential behavior were not modified.
- Only a validated short-lived opaque intent and correlation can be sent to the fixed `https://app.fuma.co.ke/resume` target by the existing client boundary.
- The route accepts no arbitrary redirect, return URL, callback, email, name, password, identity, session or audience field.
- Authentication, two-factor verification, cancellation, authorization code exchange, session creation and resume remain explicitly described as application/identity responsibilities.
- The only authored links are safe internal routes: `/` and `/security`.
- No query value is interpolated into an href, metadata value, raw HTML or visible request detail.
- No app/auth cookie, opaque token, correlation or session detail is rendered by this server page.

## Accessibility and semantics

- One exact H1 preserves the established conversion acceptance name: “Continue to the Fuma application”.
- The signature is a labelled section containing a valid semantic definition list; intent and resolution use `dt`/`dd` pairs.
- The action and boundary regions have explicit headings. The boundary facts are a semantic list rather than faux controls.
- Decorative direction marks and state dots are hidden from assistive technology.
- The real `IntentForm` retains its `aria-describedby`, assertive error live region, disabled busy state and minimum target size.
- The cancel and security links retain visible underlines, inherited focus treatment and minimum-height treatment where action-oriented.
- Responsive behavior collapses the horizontal public-to-app direction into a vertical transition without changing source order.
- Shared focus, forced-color and reduced-motion rules remain inherited. No client island, app mockup, hidden content, image or autoplay behavior was added.

## Focused validation evidence

Validation followed the ticket restriction. No full test suite, root lint, full typecheck, build, server, browser/E2E run, screenshot or snapshot was executed.

- Language-service diagnostics for `apps/web/app/start/page.tsx` — **PASS**, `No diagnostics` after the final semantic markup edit.
- `bunx eslint app/start/page.tsx` from `apps/web` — **PASS**, exit status 0 with no output after the final edit.
- `bun test tests/public-web-security.test.ts tests/public-web-handoff-layer.test.ts tests/public-submission-routes.test.ts` from `apps/web` — **PASS**, 12 tests, 0 failures, 80 expectations. This focused set verifies the closed union rejects arbitrary redirect/identity fields; private forwarding contains only the strict intent; app resume is fixed-origin/path/query and rejects expired, malformed, credentialed, redirected or extra-parameter targets; hostile submission fields and cross-origin requests fail closed; and minimized analytics/privacy boundaries remain intact.
- Focused route source security/design audit — **PASS**. It found no raw color, color function, local gradient/shadow, inline style, raw HTML injection, browser-location call, local input/select/textarea, fake UI, self-host/open-source positioning or loopback host. It also asserted exactly two links (`/` and `/security`), noindex metadata, strict schema validation and repeated-query rejection.
- `git diff --check -- apps/web/app/start/page.tsx` — **PASS**, exit status 0 with no output.
- Diff inspection — **PASS**. The original repeated-value guard, exact key map, per-kind object construction, terminal `PublicHandoffRequestSchema` check and `notFound()` behavior are unchanged; additions are the exhaustive presentation map and redesigned semantic render.

## Acceptance boundary

Per scope, no server, browser, E2E process or screenshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.
