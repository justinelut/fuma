# WEB-DESIGN-013 — Showcase detail redesign

## Result

Redesigned the complete `/showcase/[slug]` route as a premium, consent-backed project folio. The approved state now gives the authority-provided project media first-class scale, presents only exact public-release facts, resolves reciprocal expert credits through current public projections, and explains the withdrawal boundary without inventing case-study outcomes or customer evidence.

## Changed files

- `apps/web/app/showcase/[slug]/page.tsx`
- `docs/handoffs/agent-results/WEB-DESIGN-013.md`

No shared component, global style, test, generated asset, contract, lockfile, tracker, or other route was edited.

## Design direction

- **Page job:** let a visitor inspect a currently approved project, open the real public work safely, and understand exactly which project facts and expert credits the current public authority supports.
- **Audience:** prospective site owners and collaborators evaluating real Fuma work without concept mockups, borrowed marks, invented performance claims, or implied endorsement.
- **Signature:** a continuous **consent chain**. The current-state hero, full-scale project artifact, ruled fact record, reciprocal expert credits, and withdrawal explanation read as one release folio rather than a generic portfolio template.
- **Information architecture:** canonical breadcrumb and project thesis → current project record → authority-provided media → exact profile/industry facts → reciprocal expert credits → consent/withdrawal close.
- **Visual system:** inherits the approved Fuma display/body/mono type roles, measured section rhythm, semantic surface and line hierarchy, live-state treatment, shared rim light, shared ambient media pool, and shared control behavior. The route introduces no local palette, raw color, shadow, gradient, or bespoke effect.
- **Aesthetic risk and restraint:** the authority-provided artifact occupies the page’s largest visual field, while a ledger-like chain of facts and credits carries the evidence. This project-specific scale shift is the one expressive move; surrounding sections stay typographic and ruled.
- **Closed positioning:** copy describes one Fuma-owned public authority and Fuma-mediated release lifecycle. It does not introduce self-hosting, open-source, infrastructure, deployment, database, licence, marketplace, or vendor-stack positioning.

## Authority and evidence integrity

Every project-specific value comes from the exact current `PublicShowcase` projection:

- title and summary
- required authority-provided `imageUrl`
- public `previewUrl`
- Website/Publication profile labels
- industry labels
- stable linked-expert IDs
- approval timestamp, formatted deterministically in UTC with `en-KE`

Linked expert cards are not derived from IDs. The route performs a separate current, no-store public expert projection read, matches the authority IDs, and requires each expert record to point reciprocally back to the current showcase ID before emitting a name, slug, location, type, summary, or profile link. If that bounded enrichment cannot resolve every linked ID, the entire credit-detail list fails closed to an explicit unavailable state; no partial, stale, or manufactured attribution is rendered. An empty authoritative `expertIds` array gets a distinct zero-credit state.

The image is rendered from the authority URL without copying or transforming it. Because `PublicShowcase` currently supplies no image dimensions or descriptive alt text, the layout reserves a responsive aspect-ratio field to avoid an unbounded media box and treats the image as decorative (`alt=""`) beside the already-labelled figure and project title rather than fabricating a visual description. The caption identifies only provenance and current release state.

The page does not infer or invent client identity, logo ownership, project goals, services, process, launch date, results, metrics, testimonials, ratings, awards, accessibility review, image description, expert role on the work, or endorsement.

## Approved and missing/withdrawn states

### Approved

- The hero announces a current approved public record with the shared semantic live-state role.
- The project record exposes only profile, industry count, expert count, and approved date.
- Real authority media is the dominant artifact, not a fabricated browser or product mockup.
- Profile and industry labels retain their exact authority vocabulary.
- Expert credits become links only after current reciprocal projection checks.
- Both preview actions use the shared external CTA branch, producing `target="_blank"` plus `rel="noopener noreferrer"` and screen-reader new-tab context.

### Missing, malformed, unavailable, or withdrawn

- Metadata still performs the exact slug read and returns the generic unavailable title/description with `!item`, preserving the canonical noindex/follow-false tombstone.
- Page rendering performs the same exact slug read and calls `notFound()` for every non-approved result.
- This intentionally preserves one indistinguishable 404 boundary for missing, malformed, projection-unavailable, and withdrawn records. The route does not leak prior title, media, expert, consent, moderation, or approval history.
- A custom status-bearing tombstone cannot be composed inside this page after `notFound()` throws; doing so would require a route-level `not-found.tsx` or shared app `not-found.tsx`, both explicitly outside this ticket’s two-file ownership. The implementation therefore preserves the established global noindex 404 instead of weakening status or privacy behavior with a designed `200` substitute.

## Preserved and strengthened contracts

- Route remains `dynamic = 'force-dynamic'`.
- Metadata and rendering retain `readPublicItem('showcases', slug)`, preserving strict slug validation, authority-side slug filtering, exact returned-slug equality, and no retained fallback.
- Non-approved results retain `notFound()`.
- Unavailable metadata retains `publicMetadata(..., !item)` and the exact requested canonical route.
- Canonical approved breadcrumb links use `/showcase/{item.slug}` and continue to emit the shared safe Breadcrumb JSON-LD. No unsupported CreativeWork, customer, review, image, or expert-role schema was invented.
- Preview URLs remain strict public-contract HTTPS values and are opened only through the shared safe external CTA implementation.
- Showcase and expert projection reads remain server-owned and no-store; no browser credentials, private authority import, internal identity, or direct data provider enters the page.
- The project survives expert-enrichment failure without hiding the still-current showcase, while the credit section itself fails closed.
- Withdrawal copy follows the implemented authority: expert and site-owner attribution consent, approval, moderation, active ownership, expert availability, and reciprocal linkage all gate public visibility.

## Accessibility and semantic review

- One authority-backed H1 labels the project.
- Each major section has an ordered H2 and explicit `aria-labelledby` relation; nested fact/credit groups use H3s.
- Current project facts use a labelled `aside` and definition list.
- Profiles, industries, and expert credits use semantic lists.
- Approval uses `<time dateTime={item.approvedAt}>`.
- The dominant image uses empty alt rather than an invented description; the figure is already named by its heading/caption and project context.
- The large expert count includes screen-reader context.
- Credit-enrichment failure uses `role="status"` and `aria-live="polite"`.
- External preview controls include destination context and an explicit screen-reader new-tab announcement.
- Focus, forced-colour, responsive wrapping, and reduced-motion behavior remain inherited from the global Fuma system. This server route adds no client JavaScript, inline animation values, or page-local focus treatment.

## Focused validation evidence

Validation followed the ticket restriction: route diagnostics, ticket-scoped ESLint, whitespace validation, and source audits only. No full test suite, root typecheck, root lint, build, server, browser/E2E run, or snapshot was executed.

- Language-service diagnostics for `apps/web/app/showcase/[slug]/page.tsx` — **PASS**, `No diagnostics`.
- `bunx eslint 'app/showcase/[slug]/page.tsx'` from `apps/web` — **PASS**, exit status 0 with no output.
- `git diff --check -- 'apps/web/app/showcase/[slug]/page.tsx'` — **PASS**, exit status 0 with no output.
- Forbidden-style/private-data/positioning audit — **PASS**, zero matches for raw hex; `rgb`/`rgba`; `hsl`/`hsla`; `oklch`; arbitrary shadows; local white/black color utilities; private authority identities/coordinates; fabricated review/rating/testimonial evidence; and self-host/open-source/infrastructure/deployment/database/licence language.
- Contract source review — **PASS**: the route retains two exact `readPublicItem('showcases', slug)` reads, `force-dynamic`, `notFound()`, `publicMetadata(..., !item)`, canonical breadcrumbs, a safe authority media URL, safe external preview actions, reciprocal expert verification, approval `<time>`, and explicit enrichment failure handling.
- Semantic source review — **PASS**: one H1, ordered labelled H2/H3 regions, labelled aside, definition lists, semantic lists, figure/caption, status state, screen-reader context, and safe linked records were manually reviewed.

## Acceptance boundary

Per ticket scope, no server, browser session, screenshot, hydration check, or E2E test was started. This handoff therefore does not claim Blyss HTTPS visual, responsive, routing, hydration, TLS, proxy, network, or browser accessibility acceptance. Any later browser acceptance must use `https://3002.blyss.co.ke` under repository policy.

No commit or push was made.
