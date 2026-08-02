# WEB-DESIGN-031 — Security reporting redesign

## Result

Recomposed `/security` as a whole-page Fuma security disclosure and reporting surface. The route now leads with one explicit three-stage report path—prepare, report, confirm—then establishes safe investigation limits, documents the human/machine-readable disclosure relationship, and closes on the maintained bounded security contact form.

The page does not imitate a compliance dashboard or present security as a card collection. Its signature is the report boundary itself: researcher context → public request boundary → private routing attempt. The composition makes that transition visible while stating exactly what an accepted request does and does not establish.

## Changed files

- `apps/web/app/security/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-031.md`

No shared component, global style, contact boundary, contract, security.txt route, test, dependency, lockfile, server file, generated artifact, or other route was edited for this ticket.

## Design direction

- **Subject:** Fuma’s public security disclosure and report path.
- **Audience:** a researcher or user who has identified a possible Fuma security concern and needs a safe, unambiguous reporting route.
- **Page job:** reduce uncertainty before submission: what to include, when to stop, which route is authoritative, where the public boundary ends, and what acceptance means.
- **Signature:** a semantic `<figure>` containing the ordered prepare → report → confirm path and a hardened boundary caption. This is a real sequence, so ordered structure is meaningful rather than decorative numbering.
- **Information architecture:** report thesis → ordered report path → safe practice and stop conditions → `security.txt`/human policy relationship → explicit non-claims → security contact form → related trust routes.
- **Typography:** inherited Fuma display, body, and mono roles. Display type carries the thesis and section decisions; body copy carries guidance; mono is reserved for route/boundary labels.
- **Layout:** a wide, asymmetric opening resolves into ruled sequential and definition-list structures. The form is given a dedicated closing section and enough width for safe entry on small and large viewports.
- **Palette:** inherited semantic roles only—background, foreground, muted foreground, primary control, signal link decoration, and soft/strong lines. There are no route-local color values.
- **Effects:** none. The route adds no gradient, bloom, glow, shadow, rim-light, inline style, stylesheet, or animation class.
- **Aesthetic risk:** the primary visual artifact is a disclosure boundary rather than a product screenshot, certification badge, metric, shield illustration, or generic dashboard. The restraint is intentional: the page’s authority comes from precise routing language and visible limits.
- **Self-critique applied:** the previous “Do / Do not” card pair was interchangeable with generic security pages. The final design preserves that maintained guidance but turns the actual report lifecycle and disclosure boundary into the organizing system. A generic ARIA-labelled container was also removed during review in favor of native figure, ordered-list, and figcaption semantics.
- **Closed positioning:** Fuma remains the owned product and reporting authority. No self-hosting, open-source, infrastructure, deployment, database, or operator positioning was introduced.

The required `frontend-design` skill was applied after reviewing the target route, Fuma homepage, measured public-web design reference, global semantic roles/type system, shared shell, contact form, `.well-known/security.txt`, trust/contact routes, SEO helper, public contracts, architecture ADR, and focused trust/security gates.

## Maintained fact and claim boundary

The redesigned route uses only facts already maintained by its Fuma-owned sources:

- `/.well-known/security.txt` names `https://fuma.co.ke/security` as both `Contact` and `Policy`, declares English as the preferred language, and exposes no private recipient.
- `ContactForm kind="security"` sends the minimum security-class request through the same-origin `/api/contact` route with omitted credentials and redirect refusal.
- The server-owned contact boundary strictly validates bounded requests and attempts private routing; callers cannot select or discover a recipient.
- A `202` result means accepted for routing only. The existing form explicitly says that this does not confirm delivery or promise a response time.
- An unavailable result does not confirm acceptance, and the existing form instructs the sender to keep a local copy and try later.
- The previous route’s approved safe-practice and stop-condition language is preserved without broadening scope.

The route explicitly does **not** claim certification, compliance, an audit, encryption posture, safe harbour, a bounty, an SLA, delivery, acknowledgement, eligibility, remediation, disclosure timing, or a reward. No email address, security team identity, provider, auditor, certification body, or response target was invented. Repository-root `SECURITY.md` describes the separate Instatic repository’s GitHub reporting path and was therefore not repurposed as Fuma’s public recipient.

## Report and disclosure path

1. **Prepare:** provide affected public behavior, impact, and repeatable plain-text steps; redact credentials and sensitive evidence.
2. **Report:** use the existing security-class same-origin form; the public request cannot choose or expose a recipient.
3. **Confirm:** interpret “accepted” as accepted for private routing only, not as proof of delivery or any downstream commitment.

The page preserves two coordinated discovery surfaces:

- the machine-readable `/.well-known/security.txt` record for automated tooling;
- `/security` as the human-readable contact and policy route with handling guidance and the maintained form.

The relationship is linked directly and described without publishing a private destination.

## SEO, links, and accessibility

- `publicMetadata(...)` retains the exact canonical `https://fuma.co.ke/security`, index/follow behavior, locale alternates, feed discovery, and app-owned social image contract.
- The bounded metadata description describes reporting and disclosure limits without advertising unsupported security outcomes.
- One H1 labels the route. Major sections are H2-led; the two bounded guidance subsections use H3s.
- The real sequential report path is an ordered list within a figure, with a figcaption naming the boundary transition.
- Safety groups use native sections and lists; disclosure facts use a native definition list.
- The in-page action points directly to the labelled reporting section. All interactive targets retain inherited focus-visible treatment and at least 44px minimum height where route-owned.
- Internal route navigation uses `next/link`; the local fragment uses a native anchor because it does not change routes.
- The security form retains explicit labels, autocomplete/input modes, bounded lengths, honeypot handling, consent copy, a polite live feedback region, alert/status semantics, and failure-specific instructions.
- Responsive layouts collapse to one column without fixed-width content, client-only page structure, decorative media, or motion.
- Related links resolve to `/trust`, `/legal/privacy`, and `/contact` without implying those routes replace the security path.

## Focused validation evidence

Validation followed the ticket restriction. No aggregate test suite, full/root build, full lint, server, browser/E2E process, screenshot, or snapshot was run.

- Language-service diagnostics for `apps/web/app/security/page.tsx` — **PASS**, `No diagnostics` after final semantic refinement.
- `bunx eslint 'app/security/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `bun test tests/public-web-security.test.ts tests/public-web-trust.test.tsx tests/public-web-trust-architecture.test.ts tests/public-web-links.test.ts tests/public-web-seo.test.ts` from `apps/web` — **PASS**, 33 tests, 0 failures, 199 expectations. This covers minimized/closed public contracts, strict private contact routing, claim-free trust behavior, architecture boundaries, safe route links, canonical metadata, and fabricated schema/claim rejection.
- Direct no-server static render of `app/security/page.tsx` — **PASS**, 10,626-byte HTML. It verified the main landmark, exactly one H1, ordered report path, figure/figcaption signature, `security.txt` relationship, explicit non-claims, report-section target, maintained security form description, privacy/trust/contact links, canonical `/security` metadata, and absence of unsupported certification/SLA/recipient strings.
- `git diff --check -- apps/web/app/security/page.tsx` — **PASS**, exit status 0.
- Forbidden route-source audit — **PASS**, zero matches for raw hex/RGB/HSL/OKLCH colors, gradients, local shadows/glows, Fuma effect classes, named certification/compliance claims, uptime figures, encryption claims, recipient addresses, or self-host/open-source/deployment positioning.

## Acceptance boundary

Per ticket scope, no server, browser, Playwright/E2E process, screenshot, or snapshot was started. This handoff does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, runtime accessibility, or browser acceptance. Any later user-facing acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.
