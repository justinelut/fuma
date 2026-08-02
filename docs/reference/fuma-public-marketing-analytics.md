# Public marketing analytics and conversion measurement

FUMA-WEB-016 adds first-party acquisition measurement without creating a visitor identity. Public Web remains presentation-only; Studio owns the central collector and aggregate conversion authority. Publication/tenant/member analytics remain separate.

## Collection policy

The cookieless baseline is one closed `page_view` event containing only a coarse route class, UTC timestamp, optional closed campaign class, and consent state. It contains no path, query, URL, referrer, IP address, user agent, visitor/session/device identifier, identity, tenant, member, staff, or payment field. Baseline collection uses no cookie or durable browser storage.

`cta_selected` and `handoff_started` are optional events. The client does not request `/api/events` for them unless the versioned, host-local `sessionStorage` preference is explicitly `optional`. Essential-only, absent, malformed, and obsolete preferences do not authorize an optional request. Withdrawal changes the preference to essential-only immediately. GPC and DNT remove the preference, hide the optional control, and suppress collection at both the Web route and central collector. Bot and internal traffic are acknowledged without storage.

The Web service forwards only `x-fuma-gpc`, `x-fuma-dnt`, and `x-fuma-traffic` coarse classifications over its existing private service credential. It does not forward browser cookies, authorization, IP addresses, user agents, or arbitrary headers. Provider/storage blockage cannot prevent page rendering or the public-to-app handoff.

## Opaque funnel authority

A consented handoff event may carry the WEB-013 authority-issued opaque correlation. Studio hashes it with SHA-256 before persistence. Existing signup, site, publish, and paid authorities can inject the strict `PublicMarketingAuthorityEvent` sink only after their own authoritative transaction commits. The sink accepts only an authority event ID, closed stage, opaque handoff correlation, and timestamp. It cannot accept user, site, organization, workspace, tenant, member, staff, session, price, payment, or provider data.

Exact event hashes make public and product-stage retries idempotent. Funnel reports group only the SHA-256 correlation, tolerate stage arrival in any order, and require nondecreasing authoritative timestamps for the nested sequence `handoff → signup → site → publish → paid` before counting each deeper conversion. No opaque hash is returned by the report or dashboard.

## Retention and dashboard

Minimized raw events and opaque joins expire after 30 days. Coarse daily aggregates expire after 400 days. Reports are end-exclusive UTC ranges limited to 30 days because the complete funnel join is intentionally unavailable after raw correlation expiry. The retention job accepts an empty payload; its clock and cutoffs are server-owned.

`PublicMarketingAnalyticsDashboard` displays only aggregate totals, nested funnel counts/rates, coarse route classes, coarse campaign classes, and the retention policy. The stored-event and daily-row TypeBox unions structurally bind each event kind to its one allowed collection basis, route/campaign nullability, and correlation shape; conversion rates are bounded to 0–10,000 basis points. `PublicMarketingAnalyticsHttpClient` accepts only a same-origin path (including rejection of protocol-relative/backslash paths), validates request ranges before fetch, and expects the existing authenticated Studio authority to mount it; it has no token or session implementation.

## Existing authority reuse

WEB-016 creates no identity, onboarding, session, payment, or audit authority. WEB-013 remains the sole issuer of the opaque handoff correlation and the existing auth/app session flow remains the sole identity continuation. Signup, site, first-publish, and verified paid-settlement owners emit the minimized post-commit sink event; analytics never decides that those transitions occurred. The paid sink follows the existing metering/payment post-commit pattern but accepts no amount, price, payment reference, entitlement, provider, or metering subject.

Public events are not copied into the staff audit log because doing so would create a second raw-event store and defeat retention. Existing internal-console auth/capability checks and access auditing must guard the aggregate report mount. Retention follows the durable-job pattern with an empty strict payload and server-owned clock; unlike tenant-scoped FUMA-040 Publication analytics, this one central platform job carries no organization/site/member scope. The 30/400-day policy and suppression decisions otherwise reuse the established FUMA-040 privacy model.

## Persistence serialization and central mounting

The additive PostgreSQL candidate is `000079_public_marketing_analytics`. It is intentionally not imported by `migrations/index.ts` while candidate `000078_next_source_portability_authority` occupies the open serialization slot. `createHostedPublicMarketingAnalyticsRuntime` returns `undefined` unless central composition supplies the exact `000079_public_marketing_analytics:applied` schema sentinel. There is no process-memory production fallback.

After 000078 is finalized, the primary migration integrator must:

1. register/finalize/apply 000079 in source order;
2. pass the exact applied-schema sentinel and the existing private Web host/service token to the hosted runtime;
3. compose its collector boundary beside the existing private public-projection boundary;
4. inject `recordAuthorityStage` into the existing WEB-013 signup continuation, site creation, first successful publish, and verified paid-settlement post-commit seams without changing those authorities;
5. mount the report client/dashboard through existing internal-console authentication and `internal.console.access` authorization;
6. schedule the empty-payload retention job durably.

Until those steps occur, persistence and production endpoint/dashboard mounting remain deliberately blocked rather than silently using an incomplete schema or parallel identity/session authority.

## Focused validation

The focused suite covers strict payload rejection, baseline/optional consent behavior, GPC/DNT, bot/internal filtering, duplicate and reordered events, complete opaque funnel joins, storage blockage, report bounds, retention, exact private-service authority, dashboard accessibility, migration isolation, and architecture bans. Optional PostgreSQL acceptance is reported only when executed against a disposable schema. No browser, provider, deployment, DNS/TLS, or production acceptance is implied by unit tests.
