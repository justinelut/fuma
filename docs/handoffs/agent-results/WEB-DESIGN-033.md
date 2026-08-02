# WEB-DESIGN-033 — Privacy request intake redesign

## Result

Recomposed `/privacy-request` as a whole-page Fuma privacy request intake organized around a **minimum evidence envelope**: choose the request, add one useful locator, state a narrow scope, then send only that minimized request through the bounded public form.

The route now makes identity minimization operational rather than decorative. It names the supported request paths, gives a three-line message anatomy, identifies material that must stay outside the public form, explains the public-to-private routing boundary, and leaves verification, eligibility, legal determination, delivery, completion, and response timing explicitly separate.

## Changed files

- `apps/web/app/privacy-request/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-033.md`

No shared component, form implementation, contact boundary, public contract, legal source, design token, global style, test, generated artifact, dependency, lockfile, server file, or other route was edited.

## Design direction

- **Subject:** Fuma’s public privacy request intake and its identity-minimizing routing boundary.
- **Audience:** a person asking Fuma about information connected to an account, site, or public interaction without knowing how much identifying material is appropriate to send.
- **Page job:** help the person choose a request type, write the smallest useful request, avoid sensitive evidence, submit through the maintained privacy-class form, and interpret the result without inferring a legal or operational outcome.
- **Signature:** a **minimum evidence envelope** formed by the ordered choose → minimize → route path and the request / locator / scope message anatomy. The visual structure describes the actual information transition instead of presenting generic privacy badges, rights cards, or a legal checklist.
- **Information architecture:** privacy-minimization thesis → ordered request path → supported request types → minimum evidence signature and keep-out boundary → bounded intake form and maintained privacy/legal routes.
- **Typography:** inherited Fuma display, body, and mono roles. Display type carries decisions and section theses; body type explains safe action; mono is limited to boundary, stage, and evidence labels.
- **Layout:** a wide asymmetric opening resolves into a ruled three-stage path, a request-type definition list, one evidence anatomy with a restrained keep-out aside, and a dedicated two-column form section. The composition avoids repeated equal-weight cards.
- **Palette and effects:** semantic global roles only: background, foreground, muted foreground, border/line, primary control, and signal link decoration. The route adds no raw color, local alpha, gradient, shadow, glow, blur, inline style, stylesheet, image, or animation/effect class.
- **Aesthetic risk:** the page’s primary visual artifact is deliberately an incomplete envelope—only request, locator, and scope cross the boundary. The information excluded from the form is given equal structural weight, making minimization visible without turning caution into alarm styling.
- **Self-critique applied:** a first pass could have become four familiar “privacy right” cards with icons and confident legal language. That would imply legal classification, entitlement, or outcome and would not help someone decide what to send. The final design treats access, correction, deletion, and clarification as request labels, removes legal-right assertions, and makes data reduction and claim boundaries the organizing system.
- **Closed positioning:** Fuma is presented as the owner of the public request route. No open-source, self-hosting, deployment, infrastructure, database-ownership, alternative-platform, provider, or invented recipient positioning was introduced.

The required `frontend-design` skill was applied after reviewing the target route, shared `ContactForm`, current security/contact/trust/legal compositions, site shell, semantic role usage, trust-surface reference, focused trust architecture and acceptance tests, and prior Fuma design handoffs. No `graphify-out/graph.json` existed, so direct contract and code inspection was used rather than a graph query.

## Privacy and request contract

### Supported request paths

The page preserves and clarifies the existing request types without claiming that the labels establish legal rights or outcomes:

- **Access:** ask for access to personal information associated with a Fuma account or interaction the sender can identify.
- **Correction:** identify information believed to be inaccurate and state the requested correction.
- **Deletion:** identify the information or interaction to be considered and keep the requested scope specific.
- **Clarification or another concern:** ask a focused question about how information connected to a Fuma interaction is handled.

The person is told to put one label first in the free-text message. No unmaintained request-type selector, workflow, jurisdiction, recipient, department, case identifier, or legal classification was invented.

### Identity minimization

The minimum evidence signature asks for only:

1. one request label;
2. one account, site, reply address, or interaction locator the person already recognizes, choosing the least revealing useful option;
3. the narrow record, field, date range, interaction, or requested outcome.

The route explicitly keeps passwords, recovery codes, secret keys, session details, government identity material, payment/financial records, unrelated sensitive information, other people’s information, and unnecessary complete histories outside the public form. It states that separate verification may be required and must not be pre-empted by pasting identity documents into this intake.

### Routing and non-claims

The ordered path keeps the maintained boundary literal:

- the existing form submits a `privacy`-class request to the same-origin public contact route;
- the public form requires name and reply email, uses the existing bounded message contract, and attempts private routing without exposing or allowing selection of a recipient;
- an accepted result means accepted for routing only;
- the page does not confirm identity, delivery, eligibility, applicable law, legal determination, deletion, correction, completion, response timing, or any other downstream outcome.

No acknowledgement, case creation, fulfillment, deadline, service level, named team, email address, provider, external destination, or completed identity check is claimed.

## Form security, consent, and safe states

`ContactForm kind="privacy"` remains unchanged and is the sole intake mechanism. It therefore preserves:

- exact strict privacy-class payload construction and the maintained consent version;
- required labelled name, reply email, and bounded message controls;
- honeypot, canonical form-start timestamp, replay token, omitted credentials, redirect refusal, request timeout, and strict same-origin endpoint;
- the current privacy-notice consent copy and sensitive-information warning;
- disabled busy/sent behavior and a polite atomic feedback region;
- separate accepted-for-routing, rate-limited, unavailable, and invalid states;
- no-store/no-cookie/non-reflection behavior at the unchanged server boundary.

The route does not reinterpret those states. It tells the sender to keep a local copy until the form reports acceptance for routing and does not convert acceptance into delivery or completion.

## SEO, links, and accessibility

- `publicMetadata(...)` retains canonical `https://fuma.co.ke/privacy-request`, legal-route metadata behavior, locale alternates, feed discovery, and app-owned social metadata while using a claim-bounded description.
- One H1 states the page thesis. Major content uses ordered H2 sections; the keep-out aside uses an H3.
- Every major section is connected through `aria-labelledby`.
- The real request lifecycle is a semantic ordered list within a figure, with a figcaption naming the public/private boundary and non-claims.
- Request types and evidence anatomy are native definition lists; excluded material is a native list; related routes use distinctly labelled navigation landmarks.
- The signature does not depend on color, position, icons, hover, JavaScript, or animation for meaning.
- Route-owned interactive targets retain at least 44px target height and inherited focus-visible behavior.
- The existing form preserves explicit labels, autocomplete/input modes, length limits, honeypot semantics, consent text, and live status/alert behavior.
- Internal route navigation uses `next/link`; the local in-page target uses a native anchor.
- Maintained links resolve to `/legal/privacy`, `/legal`, `/trust`, and `/contact`.
- Responsive grids collapse without fixed-width content, decorative media, or route-local effects.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate suite, full build, full typecheck, full lint, development/production server, browser/E2E process, screenshot, or snapshot was run.

- Language-service diagnostics for `apps/web/app/privacy-request/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/privacy-request/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-trust.test.tsx tests/public-web-trust-architecture.test.ts tests/public-web-links.test.ts tests/public-web-seo.test.ts` from `apps/web` — **PASS**, 29 tests, 0 failures, 183 expectations. This verifies the strict contact boundary, minimized payload/replay/rate/unavailable behavior, labelled consent form, safe legal links, architecture exclusions, internal route integrity, canonical metadata, and fabricated-claim rejection.
- Direct Bun/React no-server render of `app/privacy-request/page.tsx` — **PASS**, 11,983-byte HTML. It verified 15 required route/form/link markers, exactly one H1, canonical `https://fuma.co.ke/privacy-request`, the request-path and evidence-signature hooks, all four request labels, initial consent/form state, privacy/legal/trust/contact links, and absence of prohibited assurance/completion text.
- Forbidden route-source audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH colors, gradients, shadows, glows, blur/rim-light effects, inline styles, certification/uptime/SLA/guaranteed language, recipient addresses, or open-source/self-host/deployment/database positioning.
- `git diff --check -- apps/web/app/privacy-request/page.tsx` — **PASS**, exit status 0.

## Acceptance boundary

Per ticket scope, no build, server, browser, Playwright/E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.
