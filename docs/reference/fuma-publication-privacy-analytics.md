# Publication privacy analytics

FUMA-040 replaces the legacy visitor-correlating Publication analytics path with an isolated, exact-scope aggregate authority. Dependencies FUMA-036 and FUMA-039 supply public/member access decisions; analytics records only the resulting coarse audience class and member access source.

## Collection policy

The public request is a strict TypeBox object containing only event kind, optional content/newsletter object IDs, a closed referrer class, public/member audience, and a closed member-source class. It cannot contain tenancy, clocks, consent claims, URLs, IP addresses, emails, member IDs, session IDs, user agents, visitor hashes, or fingerprints.

The public host supplies an immutable trusted context separately: server timestamp, explicit consent state, GPC, DNT, and a precomputed `human | known-bot | suspected-bot` class. Collection is suppressed when consent is denied/unknown, GPC or DNT is active, or traffic is bot-classified. Suppressed traffic leaves no opt-out or bot record. Accepted rows carry the fixed `explicit-consent` basis and a server-generated write-idempotency ID that is never returned or reused as a visitor key.

Dimensions are intentionally bounded: six event kinds, six referrer classes, two audience classes, and five member-source classes. Site reads have no content ID; post reads require one; newsletter metrics require a newsletter ID and have no content ID. Public events must use member source `none`.

## Scope, aggregates, and retention

Migration candidate `000051_publication_privacy_analytics` adds minimized raw events and daily aggregates. Every primary key and query includes platform, organization, workspace, site, stable owner key, owner generation, and profile. Repository entry checks the active owner generation, transfer fences, and current site profile before each operation.

Accepted events atomically increment one daily aggregate. Reports use UTC date ranges, end-exclusive and limited to 366 days. Output is bounded to 100 content rows, six referrer rows, four member-source rows, and 100 newsletters with deterministic count/order rules. CSV exports are deterministic, bounded, and include a SHA-256 digest.

Raw events are retained for 30 days and daily aggregates for 400 days. `publication.analytics-retention` has an empty payload; trusted job context supplies exact site/profile/owner authority and the service clock supplies cutoffs. Deletion is exact-scope. No subject deletion is necessary because subject identifiers are never stored.

## Studio and primary integration seam

`PublicationAnalyticsSurface` is an accessible local CSS-Modules dashboard using Studio `Button`, `FormField`, and `Input` primitives. It provides labelled UTC range controls, live status, captioned tables, policy text, and deterministic CSV export. `PublicationPrivacyAnalyticsHttpClient` validates all response bodies with TypeBox.

Primary integration should:

1. Create `createPublicationPrivacyAnalyticsFeature({ db, ids, now })` in the central Publication graph.
2. Append `feature.scopedRoutes` to central scoped routes.
3. Merge `feature.jobHandlers` into the trusted worker map and schedule one empty-payload retention job per trusted active Publication site.
4. Mount `feature.publicAdapter` behind FUMA-036 public/member resolution, deriving exact scope and privacy context server-side.
5. Mount `PublicationAnalyticsSurface` with its dedicated client in the existing Analytics workspace.
6. Register migration `000051_publication_privacy_analytics`, calculate its checksum, and finalize the shared registry only after integration acceptance.

This ticket intentionally does not edit central composition, job handlers, runtime/router, migration registry/checksum, release migration tests, tracker, manifests, or lockfiles.

## Focused verification

```sh
bun test apps/studio/src/__tests__/fuma/publicationPrivacyAnalytics.test.ts \
  apps/studio/src/__tests__/fuma/publicationPrivacyAnalyticsAdapters.test.ts \
  apps/studio/src/__tests__/fuma/publicationPrivacyAnalytics.demo.test.ts \
  apps/studio/src/__tests__/fuma/publicationPrivacyAnalyticsSurface.test.tsx \
  apps/studio/src/__tests__/architecture/fuma-publication-privacy-analytics.test.ts
bunx tsc --noEmit -p apps/studio/tsconfig.node.json
bunx tsc --noEmit -p apps/studio/tsconfig.app.json
```
