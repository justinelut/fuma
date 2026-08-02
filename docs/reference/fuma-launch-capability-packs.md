# Fuma launch capability packs

## Scope decision (2026-08-02): verticals ship as content, not engines

**Owner decision: Events, Hospitality and Ecommerce are not built as separate engines.** The universal data model, Better Auth, Paystack and the existing AI tool surface already serve those businesses. Only behaviour those primitives genuinely cannot express is implemented.

Evidence, verified against code rather than the tracker:

- Site AI already exposes **48 site tools and 15 content tools**. It can list collections, read a collection schema, create/update/delete documents, set fields and status, search, list media, list loop sources and post types, and compose pages. Presentation and content authoring need no pack.
- `data_tables`/`data_rows` already support `text`, `longText`, `richText`, `number` (with currency), `boolean`, `date`, `dateTime`, `select`, `multiSelect`, `url`, `email`, `media` and `relation`. Services, team, case studies, testimonials, FAQs, locations, events, rooms, tours and menu items are all ordinary collections.
- Forms already validate and bound submissions into a target collection, so lead capture needs no new storage.
- The one class of behaviour the data model cannot provide is **contention**: capacity, short-lived holds, availability across working hours and time zones, idempotent confirmation, and cancellation windows. A form row cannot prevent a double booking.

### What was implemented instead

1. **FUMA-093 bookings authority** — fenced holds, DST-correct availability, idempotent confirmation, append-only events, and additive migration `000081` (physical and unindexed behind the `000078` sentinel). Nine reviewed capabilities.
2. **Bounded collection provisioning** — `describe`/`provision`/`extend`, so AI can *define* collections rather than only populate them. This was the single decisive gap. Owner-confirmed for schema mutation; additive only; drop, field removal, retype, slug rename and direct SQL are withheld with explicit diagnostics.
3. **Thirteen content-only starter blueprints** covering business, agency, events and hospitality. Blogging uses the built-in `posts` collection.
4. **Error reporting** — Sentry-compatible envelope over `fetch`, inert without `SENTRY_DSN`, redacting credentials and personal data.

### Disposition of the pack tickets

`FUMA-089`, `FUMA-090`, `FUMA-091` and `FUMA-092` are **closed as superseded**: their content surface ships as blueprints, their operations surface reuses the existing Data and Content workspaces, and their only irreplaceable primitive is the bookings authority. Directories and ecommerce remain deferred; ecommerce still requires separate catalog, inventory, tax, order, fulfilment, refund, merchant-risk and accounting design, and Paystack transport is not an ecommerce engine.

Integration proof: `apps/studio/server/fuma/collectionProvisioning/__tests__/agencyJourney.test.ts` provisions a full agency model, captures and rejects leads through the existing form authority, serves the events and hospitality cases as content plus bookings capacity, and completes a visitor journey through reviewed capabilities. It asserts that no blueprint field encodes capacity, seats, stock, cart or checkout.

The sections below record the original pack design and remain accurate about the shared contract, security rationale and Kenyan sequencing.

## Product decision

**Scheduling hold (2026-07-30):** FUMA-089 through FUMA-093 remain future roadmap tasks and are not part of the current integration frontier. Current execution stays on FUMA-077, FUMA-073, WEB-014/015/016 and their acceptance dependencies. Events registration/live capacity, Hospitality live availability/reservations, Bookings holds/calendar synchronization, WebSockets, presence and other real-time behavior are deferred. No temporary polling, in-memory authority, fake availability or partial booking engine may be integrated to simulate them. Content-only schemas/templates may be designed later, but production capability and dashboard mounting wait for an explicit restart decision.

Fuma keeps two product profiles: **Website** and **Publication**. Publishing, General Business/Agency/Landing, Events, Hospitality & Tourism, and Bookings/Appointments ship as composable capability packs and starter-template families. A site can combine packs without changing profile identity or creating profile-specific database forks.

This model gives AI broad creative freedom in frontend composition while keeping backend authority reviewed, reusable, secure, and operable.

## Why AI does not generate hosted backends

Running generated code in a Next.js route handler or Server Action does not make it safe. It gives that code server execution and can expose database credentials, payment/auth authority, tenant data, internal networking, and provider secrets. Auth and payments alone are not enough. Production backends also require tenant isolation, authorization, validation, idempotency, concurrency controls, audit, metering, rate limits, abuse prevention, privacy/retention, jobs, webhook verification, secret management, output minimization, observability, backup/restore, export/deletion, and rollback.

AI may generate:

- original frontend structure and responsive presentation;
- editable CMS/data-table schemas within bounded field contracts;
- pages, reusable sections, components, content and style rules;
- forms and declarative workflows over approved capabilities;
- bounded query/filter/sort/pagination configurations;
- adapter bindings and standalone-export implementations that do not carry hosted secrets;
- isolated client behavior accepted through existing component review.

AI may not generate or execute hosted production database clients, SQL, migrations, repositories, arbitrary Next.js server modules, unrestricted Server Actions, credentials, or internal-provider calls. New business behavior becomes a reviewed capability or a sandboxed extension with explicit grants and no direct database access.

## Shared pack contract

Every pack contributes through existing registries:

1. strict TypeBox data and operation contracts;
2. domain services/repositories scoped by immutable Fuma request authority;
3. permissions, grants, confirmation classes and revocation;
4. Site AI and MCP tools over the same implementation;
5. Website/Publication onboarding and starter-template contributions;
6. app navigation and a focused operations-dashboard contribution;
7. audit, metering, rate limits, health and data-retention policy;
8. standalone Next.js replaceable adapter interfaces;
9. Kenyan fixtures, KES presentation where relevant, mobile/accessibility tests and Blyss-host browser acceptance.

Packs do not create their own auth, onboarding, AI runtime, MCP server, editor, publisher, payment system, database console or application shell.

## Launch portfolio

### Publishing

Productizes accepted Publication/Ghost foundations: posts, pages, authors, tags, collections, SEO/social/canonical metadata, redirects, search, navigation, media, members, newsletters, subscriptions/access, podcasts/audio feeds, analytics and immutable releases.

### General Business, Agency and Landing

The default Website pack for professional services and Kenyan SMEs. Structured collections cover services, team, work/case studies, portfolios, testimonials, clients, FAQs, locations and leads. Landing pages are frontend compositions over these general primitives, not a special backend or profile.

### Bookings and Appointments

A reusable scheduling primitive for salons, consultants, trainers, photographers, venues and other service businesses. It owns availability, holds, resource/staff schedules and booking lifecycle. Events and Hospitality compose it instead of implementing competing reservation systems.

### Events

Adds event series, sessions, schedules, speakers, venues, sponsors, RSVP/waitlist, attendee communications, calendar feeds and bounded operations. Ticket commerce is not part of launch; payment links or existing reviewed payment authority may be composed later without turning registration into ecommerce.

### Hospitality and Tourism

Targets hotels, lodges, camps, restaurants, tour operators, guides and experience businesses with rich content, packages/itineraries, rooms/unit types, amenities, galleries, seasonal availability, inquiry/quote and optional booking composition. It is not a directory marketplace or online travel agency.

## Kenyan-market sequencing

Recommended implementation order:

1. **Publishing** and **General Business/Agency/Landing** first: most behavior already exists in the universal content model, editor, forms, media and publisher, so these deliver the fastest breadth.
2. **Bookings/Appointments** next: one difficult but reusable availability/concurrency authority unlocks many service businesses and becomes a dependency for Events and Hospitality.
3. **Events** and **Hospitality & Tourism** on top of the general and booking packs: both are strong Kenyan use cases, but should reuse scheduling, forms, communications and content rather than duplicate them.
4. **Directories** later: they add discovery moderation, ranking, ownership claims, abuse controls, marketplace trust and cross-organization concerns.
5. **Ecommerce** later: it needs a separate catalog/inventory/order/tax/fulfillment/refund/merchant-risk/accounting architecture. Paystack transport is not an ecommerce engine.

The KNBS maintains dedicated MSME and tourism statistics programs, supporting the decision to treat SMEs and tourism as first-class Kenyan launch fixtures. Final commercial sequencing still requires customer interviews, willingness-to-pay evidence, support-cost estimates and FUMA-083 margin gates; category popularity alone is not acceptance evidence.

## Design quality: Framer-caliber, not a Framer clone

Fuma must avoid generic “AI dashboard” and generated-template aesthetics. However, copying Framer's exact protected assets, composition, copy or trade dress is not an acceptable product strategy. The target is **Framer-caliber craft with Fuma identity**:

- use the existing Fuma/Instatic tokens, typography, spacing, controls, interaction patterns and UI primitives;
- Studio remains Tailwind-free and does not import public-Web or application UI;
- dashboard panels are deliberately designed first-party components, not AI-generated admin markup;
- AI-built public sites use approved component primitives but can produce genuinely different layouts, visual systems and content hierarchies;
- no repetitive gradient cards, oversized empty hero copy, arbitrary glassmorphism, fake charts, placeholder metrics, decorative pills, excessive rounded containers or ungrounded motion;
- every dashboard datum comes from a real authority with useful empty/loading/error/degraded states;
- keyboard, screen-reader, forced-colors, reduced-motion, 320px/200% zoom and Kenyan low-end mobile performance are acceptance criteria;
- public visual acceptance uses the original Fuma direction and matching Blyss HTTPS hosts, never copied third-party screenshots or localhost evidence.

AI can be creative on the canvas because the design system provides disciplined primitives and the backend packs provide reliable data behavior. It cannot redesign the product shell or capability dashboard ad hoc.

## Explicit deferrals

- **Directory/marketplace profile or pack:** deferred until discovery/moderation/ranking/claim/abuse authorities and demand are proven.
- **Ecommerce:** deferred; no catalog, cart, inventory, order or checkout engine is implied by payments, Events, Hospitality or Bookings.
- **Clinical systems:** Bookings supports non-clinical appointment logistics only; diagnosis, treatment records and regulated health workflows require separate professional, privacy and compliance scope.
