# Multiple newsletters and EmailDocument composer (FUMA-044)

FUMA-044 adds a dedicated, central-ready newsletter profile and composer boundary. It composes existing Publication authorities rather than replacing them:

- FUMA-033 universal content remains the sole web-content authority. A newsletter stores only a stable `webContentId`; profile writes verify it through `PublicationDomainStore.getContent`, and send readiness blocks a linked entry that is not published.
- FUMA-039 remains the member, segment, membership-recalculation, and newsletter-consent authority. `PublicationMemberAudienceAuthority` recalculates selected segments through `PublicationMemberAccessService`, applies `all`/`any`, and calls the existing consent-state resolver for every bounded candidate.
- FUMA-042 remains the only tenant EmailDocument renderer. Drafts accept its strict data-only `EmailDocumentSchema`, while preview and readiness invoke `renderEmailDocument`.
- FUMA-043 remains the only sender, reply-to, physical-address, footer, and theme authority. Newsletter detail/readiness resolve the immutable settings hierarchy and retain provenance; no sender fields are copied into newsletter profiles.

## Records and scope

`PublicationNewsletterProfile` supplies stable newsletter identity, slug, state, default segment, optional universal-content linkage, and optimistic profile versioning. `NewsletterComposerDraft` supplies one stable draft ID per newsletter, monotonic sequence, subject/preview text, the FUMA-042 document, and a closed audience query. All PostgreSQL keys include the exact immutable tuple:

`platform + organization + workspace + site + owner key + owner generation + profile`

Every repository operation reloads the active, transfer-free owner and current assigned profile before accessing a row. Profiles, drafts, mutation receipts, and sender verification cannot cross that tuple. Lists are capped at 200.

Draft autosave is compare-and-swap. The client submits `draftId`, `expectedSequence`, and a stable `mutationId`. A successful mutation advances exactly one sequence. Its command digest and exact result are written to an immutable receipt, allowing the same mutation to replay the same result while rejecting mutation-ID reuse with different content. Simultaneous writers at one expected sequence cannot both win.

## Audience builder and subscription state

An audience query selects one to eight FUMA-039 segments, uses `all` or `any`, fixes subscription policy to `subscribed`, and has a hard scan limit from 1 to 500. The response exposes counts and segment versions, never member IDs:

- `exact` means every candidate was checked;
- `lower-bound` means candidates exceeded the scan limit;
- send readiness rejects lower-bound estimates and empty subscribed audiences.

Global and newsletter-specific consent precedence is evaluated by FUMA-039's append-only consent service. Missing/deleted accounts are not counted. The composer neither stores nor derives a second consent state.

## Sender ownership and send gate

Resolved sender/reply-to values come only from FUMA-043. A trusted provider reconciler may call `NewsletterComposerRepository.recordSenderVerification`; there is deliberately no client route that can mark an address verified. Verification is exact-scope, lower-cased by the PostgreSQL repository, monotonic by `checkedAt`, and valid only when the verified address exactly matches the currently resolved sender.

Readiness renders the EmailDocument and requires all of:

1. active newsletter profile;
2. current verified sender identity;
3. exact non-empty subscribed audience estimate;
4. published linked web content when a link exists.

The returned reasons are closed TypeBox literals. The later campaign/sending ticket must call `assertSendAllowed` immediately before snapshot creation; it must not infer readiness independently.

## Scoped routes and permissions

All bodies and responses are strict TypeBox contracts. Route bodies cannot select tenant ancestry, owner generation, profile, actor, role, or session authority.

| Method | Path | Exact permission |
|---|---|---|
| GET | `/publication/newsletter-composer` | `publication.newsletters.read` |
| GET | `/publication/newsletter-composer/:newsletterId` | `publication.newsletters.read` |
| POST | `/publication/newsletter-composer/profile` | `publication.newsletters.write` |
| POST | `/publication/newsletter-composer/autosave` | `publication.newsletters.write` |
| POST | `/publication/newsletter-composer/audience-estimate` | `publication.newsletters.read` |
| POST | `/publication/newsletter-composer/preview` | `publication.newsletters.read` |
| POST | `/publication/newsletter-composer/send-readiness` | `publication.newsletters.send` |

`NewsletterComposerSurface` is a standalone Studio contribution. It uses the app-local `Button`, CSS Modules, labelled regions/fields, keyboard-visible focus, live status, responsive single-column fallback, permission-aware controls, a structured EmailDocument editor, segment query builder, 600 ms optimistic autosave, audience estimates, and readiness feedback. It has no Tailwind or cross-app/shared-UI import.

## Primary integration seams

This ticket intentionally does not edit central composition, runtime, routes, jobs, migration registries, manifests, or the audit tracker. Primary integration should:

1. Register and checksum-finalize candidate migration `000052_publication_newsletter_composer` only after disposable PostgreSQL acceptance. Do not renumber it.
2. Construct `createNewsletterComposerServiceGraph` with the existing universal content store, `PublicationMemberAccessService`, `HierarchicalEmailSettingsService`, ID/hash authority, and database.
3. Append `graph.scopedRoutes` to the central scoped API declarations.
4. Mount `NewsletterComposerSurface` for the newsletter route and connect its callback props to those endpoints; do not import another app.
5. Feed trusted OCI sender-identity reconciliation into `repository.recordSenderVerification`. Never mount that method as a user-write endpoint.
6. Update FUMA-043's newsletter-existence repository check to recognize the exact-scope composer profile table when adopting this seam; the legacy mutable newsletter table must not become a second authority.
7. Make campaign snapshot creation call `service.assertSendAllowed` and consume its resolved settings/draft/audience versions rather than reconstructing the gate.

Until steps 1–3 and 6 are done centrally, this seam is repository-complete but intentionally unmounted. The candidate checksum is intentionally not reported as final.

## Focused evidence

- `newsletterComposer.test.ts` covers multiple stable profiles, universal linkage, FUMA-039 segment/subscription composition, bounded estimates, CAS replay/conflict, concurrent first-save exclusion, verified-sender and published-content gates, and exact tenant isolation.
- `newsletterComposerArchitecture.test.tsx` covers additive candidate DDL, immutable receipts, full qualifiers/current-profile authority, route permissions, absence of sender self-verification, TypeBox-only/app boundaries, app-local Button use, labels, permission denial, focus CSS, and responsive CSS.
- `newsletterComposer.demo.test.ts` emits `FUMA-044_DEMO` for `Founder Dispatch` (direct newsletter sender, founders segment) and `Weekend Edition` (inherited site sender, weekend segment), each with a different linked web entry and exact subscribed count.
- `newsletterComposerPostgresAcceptance.test.ts` optionally installs the candidate into a disposable schema when `FUMA_TEST_POSTGRES_URL` is present, exercises real CAS/replay and sender rows, proves receipt immutability, and drops the schema in `finally`.

Browser/E2E is not required for this dedicated repository/service/SSR surface ticket and is not claimed. Any future browser acceptance must use the configured Blyss HTTPS endpoints, never loopback.
