# Fuma public Web launch gate

Status: **UNSIGNED — abort by default**. This artifact becomes a launch declaration only after every required owner signs concrete evidence. Coding completion is not launch acceptance.

## Required approvals

| Gate | Evidence | Owner | Decision/date |
|---|---|---|---|
| Product claims and Kenya-first journeys | reviewed claim inventory and route screenshots | Product/Editorial | pending |
| Legal and policy versions | terms/privacy/cookies/AUP approval and history | Legal/Privacy | pending |
| Pricing correctness | published book version, KES/cadence/quota/promotion comparison, withdrawal proof | Billing | pending |
| Discovery safety | approval, opt-out/revocation, purge and mediated-inquiry proof | Marketplace/Moderation | pending |
| Handoff security | tamper/replay/expiry/wrong-audience/open-redirect and authority re-resolution evidence | Identity/Product Security | pending |
| WCAG 2.2 AA | keyboard, screen reader, contrast, zoom, reduced-motion and 320px audit | Accessibility | pending |
| Performance | Kenyan low-end mobile lab and field budgets | Web Performance | pending |
| SEO/indexation | canonical, robots, sitemap, feed, JSON-LD and withdrawn-record crawl | Growth/Web | pending |
| Privacy analytics | consent/GPC/DNT, payload, retention/deletion and provider-blockage proof | Privacy/Data | pending |
| Operations | probes, alerts, on-call, DNS/TLS, canary, independent rollback | Platform Operations | pending |
| Recovery | backup/restore evidence for owning mutable authorities | Platform/Data | pending |

## Host/browser/crawler matrix

Record success and cookie jar for `trimly.co.ke`, `auth.trimly.co.ke`, `app.trimly.co.ke`, `admin.trimly.co.ke`, two tenant subdomains, and one activated custom host. Cover Chromium, Firefox, WebKit, narrow mobile, keyboard, screen reader, crawler user agent, GPC, DNT, JavaScript failure, image/font failure, and projection outage. Public browser acceptance uses `https://3002.blyss.co.ke` for this environment.

Required journeys: home→Website→create site; home→Publication→create publication; pricing→plan intent→app→auth→app resume; template→immutable preview→onboarding; expert browse→approved work→mediated inquiry; reviewed plugin evidence; docs search/redirect/feed; contact; policy history; status degradation. Separately prove internal admin login and prove its session reaches none of public/app/tenant/custom surfaces.

## Mutation and failure matrix

Switch and withdraw a published price book; withdraw a template; opt an expert out; revoke a reviewed plugin; expire and replay an intent; fail Studio projections, status, analytics, contact and auth independently; block optional analytics; purge caches; roll the public digest forward and back. Every hidden record must disappear from browse, detail, sitemap, structured data, RSC and HTML without a stale fallback.

## Objective abort conditions

Abort for any parent-domain/shared cookie, wrong-host route, direct-origin exposure, public API host, private field/PII/secret, fabricated claim, stale or hardcoded price, failed authority re-resolution, unapproved discovery record, missing legal/privacy approval, WCAG critical issue, crawler collision, unbounded performance regression, absent alert/on-call, unsuccessful canary, or unproven independent rollback.

## Decision

Candidate Web digest: pending
Paired product digest: pending
Canary start/end: pending
Rollback digest and measured duration: pending
Open accepted risks and expiry: none accepted until listed

Public Web owner: pending
Product owner: pending
Security/Privacy/Legal: pending
Platform on-call: pending
Final decision: **ABORT (unsigned)**
