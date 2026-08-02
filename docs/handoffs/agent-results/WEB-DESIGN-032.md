# WEB-DESIGN-032 — Contact intake redesign

## Result

Recomposed `/contact` as a whole-page Fuma contact intake surface. The route now establishes one clear operating sequence—choose the narrowest route, understand the request expectation, and read the public/private boundary literally—before presenting separate general and abuse forms.

The page does not use generic marketing contact cards, office details, team portraits, invented recipients, or response promises. Its signature is a semantic route / expectation / boundary figure followed by a ruled four-route directory. General and abuse remain distinct forms on this page; security and privacy retain their dedicated routes and guidance.

## Changed files

- `apps/web/app/contact/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-032.md`

No shared component, contact form, API route, request boundary, trust contract, test, global style, design token, dependency, lockfile, generated artifact, server file, or other route was edited for this ticket.

## Design direction

- **Subject:** Fuma’s owned public contact intake and the point where a visitor request crosses into a private routing attempt.
- **Audience:** a person with a general question, suspected-abuse report, security concern, or privacy request who needs to choose the correct route without guessing who receives it.
- **Page job:** route one concern to the narrowest maintained intake, set a minimum-information expectation, expose consent before action, and prevent accepted/error feedback from being misread as a delivery or response promise.
- **Signature:** a semantic `<figure>` and `<dl>` presenting `Route`, `Expectation`, and `Boundary`, closed by the caption `Sender context → same-origin public request → private routing attempt`. These labels encode the actual request lifecycle rather than acting as decorative numbering.
- **Information architecture:** intake thesis → route/expectation/boundary signature → four-route directory → consent/accepted/error interpretation key → general intake → abuse intake.
- **Typography:** inherited Fuma display, body, and mono roles. Display type identifies decisions and routes; body type carries handling guidance; mono identifies boundary and route-state labels.
- **Layout:** a wide asymmetric opening moves into ruled definition structures and full-width route rows. The two maintained forms close the page in matching asymmetric sections with bounded explanatory measures.
- **Palette:** inherited semantic roles only—background, primary, primary foreground, muted foreground, border, soft/strong lines, and the existing focus ring. There are no route-local color values.
- **Effects:** none. The route adds no gradient, glow, bloom, shadow, rim-light, animation class, inline style, or stylesheet.
- **Aesthetic risk:** the page’s visual artifact is the intake contract itself, not a contact-card mosaic or decorative communication metaphor. The form is treated as a serious boundary rather than a sales lead surface.
- **Self-critique applied:** a conventional four-card route chooser was rejected because it made security, privacy, abuse, and general requests appear like interchangeable marketing options. The final ruled directory preserves route hierarchy and gives specialist paths explicit ownership. Redundant pre-form privacy prose was also avoided; the maintained consent statement remains inside each form immediately before its action.
- **Closed positioning:** the route is Fuma-owned and product-specific. It introduces no open-source, self-hosting, operator, deployment, infrastructure, database, or third-party contact-provider positioning.

The required `frontend-design` skill was applied after reviewing the target route, shared `ContactForm`, contact request boundary tests, cross-origin/submission tests, architecture gates, Blyss trust E2E expectations, global semantic token/type system, shared shell, neighboring trust/security/status routes, public trust reference, visual direction, and prior Fuma handoff conventions. No `graphify-out` graph exists in the repository, so direct source and contract inspection was used.

## Route and expectation contract

The route directory preserves four distinct destinations:

1. **General** — an on-page `ContactForm kind="general"` for a product or general question that is not specialist intake.
2. **Abuse** — an on-page `ContactForm kind="abuse"` for a concise report identified by a public URL or stable identifier.
3. **Security** — `/security`, retaining its safe-reporting and disclosure guidance.
4. **Privacy** — `/privacy-request`, retaining its access, correction, deletion, and privacy-concern guidance.

The route asks senders not to duplicate requests across paths. General intake asks for one clear question and only useful context. Abuse intake preserves the maintained instruction to include only a public URL or identifier and concise reason, without copying harmful content or unrelated personal data.

## Consent and result states

The page makes three states explicit before either form:

- **Consent:** the maintained form states which request and limited anti-abuse data Fuma processes and links the privacy notice effective 26 July 2026 before the send action.
- **Accepted:** accepted means accepted for private routing only. It does not confirm delivery or promise a response time.
- **Error or unavailable:** acceptance is not confirmed. The sender follows the form-specific guidance, keeps a local copy, and retries only when permitted.

The shared form remains the source of operational state feedback. It retains a polite atomic live region, `role="status"` for acceptance, `role="alert"` for invalid/rate-limited/unavailable results, specific wait/retry language, and disabled busy/sent actions. The redesign does not create a competing state machine or claim.

## Maintained security boundary

`ContactForm` and `/api/contact` were not changed. The route continues to use the existing same-origin form submission with:

- omitted browser credentials and redirect refusal;
- strict bounded JSON and an 8 KiB server body limit;
- exact TypeBox fields with additional properties rejected;
- the version-bound consent value;
- canonical form-start timing checks;
- a hidden empty honeypot;
- replay-token idempotency and mutation conflict rejection;
- privacy-minimized rate limiting;
- XSS and header-injection rejection without submitted-text reflection;
- no-store, no-cookie, and defensive response headers;
- minimized private forwarding without a public recipient;
- fail-closed unavailable behavior when private routing cannot be attempted.

The new figure describes this boundary without exposing internals that a sender can alter: sender context crosses the same-origin public request boundary and may proceed to a private routing attempt. No recipient, provider, delivery evidence, acknowledgement, response SLA, or operational authority was invented.

## SEO and accessibility

- `publicMetadata(...)` retains the exact canonical `https://fuma.co.ke/contact`, index/follow behavior, locale alternates, feed discovery, and app-owned social image contract.
- Metadata now describes choosing the narrowest Fuma route and bounded general/abuse intake without unsupported delivery language.
- One H1 labels the page. Each major route area is H2-led.
- The lifecycle signature uses a native figure, definition list, terms, descriptions, and figcaption.
- The contact directory is a native labelled navigation list; internal route changes use `next/link`, while same-page destinations use native fragment anchors.
- Existing E2E region names remain intact: the `General question` and `Abuse report` headings label their sections.
- Route-owned interactive targets retain at least 44 px minimum height and inherited visible focus treatment.
- Each shared form retains explicit labels, autocomplete, email input mode, required and bounded controls, honeypot behavior, consent text, and live status output.
- All grids collapse without fixed content widths. `min-w-0` remains around each form, and route rows stack at narrow widths for 320 px / 200% text resilience.
- Content and route operation do not depend on decorative media, animation, hover, pointer use, or hydration-hidden page structure.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate/full test suite, root or app build, full lint, server, browser/E2E process, screenshot, or snapshot was run.

- Language-service diagnostics for `apps/web/app/contact/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/contact/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-trust.test.tsx tests/public-web-trust-architecture.test.ts tests/public-request.test.ts tests/public-submission-routes.test.ts` from `apps/web` — **PASS**, 21 tests, 0 failures, 163 expectations. This covers bounded/idempotent requests, honeypot/timing/replay/rate behavior, XSS and header-injection rejection, no reflection, unavailable private routing, no-store/no-cookie/defensive headers, exact HTTPS Host/Origin agreement, bounded JSON, hostile field rejection, strict server ownership, redirect safety, and accessible maintained form output.
- `bun test tests/public-web-links.test.ts tests/public-web-seo.test.ts` from `apps/web` — **PASS**, 17 tests, 0 failures, 82 expectations. This verifies all internal route targets, `next/link` ownership for route navigation, canonical metadata bounds and uniqueness, locale/feed/social metadata, noindex boundaries, sitemap inclusion, and fabricated structured-data rejection.
- Direct no-server static render of `app/contact/page.tsx` — **PASS**, 12,475-byte HTML and 12 contract checks. It verified the main landmark, exactly one H1, semantic figure/figcaption, route/expectation/boundary labels, exactly two forms, maintained general/abuse region names, same-origin signature, consent/privacy linkage, accepted/error interpretation, security/privacy routes, canonical `/contact` metadata, and explicit absence of a delivery/response promise.
- `git diff --check -- app/contact/page.tsx` — **PASS**, exit status 0.
- Forbidden route-source audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH colors, gradients, shadows, glows, blooms, rim-light classes, certification/SLA/uptime claims, recipient addresses, mail links, or self-host/open-source positioning.

## Acceptance boundary

Per ticket scope, no server, browser, Playwright/E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No contact request, private routing attempt, recipient delivery, provider call, commit, or push was made.
