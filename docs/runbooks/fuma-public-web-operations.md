# Fuma public Web operations runbook

## Ownership and scope

Service: `fuma-public-web`. Runtime owner: Public Web on-call. Edge/DNS/TLS owner: Platform Operations. Public projection owner: each Studio domain owner. The public image rolls independently; never roll product, auth, tenant runtime, or databases to repair a Web-only regression.

## Pre-deploy

1. Resolve a multi-architecture Web image to an immutable digest and pair it with the approved product digest in release evidence.
2. Confirm the image runs as UID/GID 1001 with a read-only root filesystem and exposes only port 3002.
3. Inject the private projection origin/token, preview token, metrics token, and revision from secret management. Never place values in Compose, Git, browser variables, or image layers.
4. Confirm exact edge ownership: apex to public Web, `www` permanent redirect, auth/app/admin to their owners, wildcard/custom domains to tenant runtime, unknown direct origins denied.
5. Confirm crawler, legal, pricing, consent, alert, and on-call approvals in the launch gate.

## Canary

Deploy one canary replica by digest. Route only the approved canary cohort. Observe health, server error rate, projection failures, p95 latency, and core Web Vitals. Exercise home, Website, Publication, docs, pricing unavailable/available states, one approved discovery detail, and opaque handoff issuance. Abort on host leakage, any staff/app cookie, private-field rendering, malformed structured data, pricing disagreement, availability below objective, or sustained latency/error threshold.

## Safe degradation

Projection failure must return the generic unavailable state and suppress pricing/action authority. Do not enable stale caches or editorial fixtures. Status provider failure renders `unknown` and links to the independent status host. Analytics provider failure is non-blocking. Contact/handoff failure returns no-store generic errors without exposing internal details.

## Cache purge and withdrawal

Studio moderation owns purge publication. For a withdrawn expert/showcase/plugin, verify the no-store detail and browse response no longer includes the record, then purge edge HTML and segmented sitemap keys. For templates/pricing/product facts, invalidate by dataset version/ETag and purge affected Next caches. Never manually recreate a withdrawn record in Web content.

## Rollback

1. Stop canary traffic.
2. Set only `fuma-public-web` to the last approved digest.
3. Wait for readiness and graceful drain; do not terminate active replicas before replacement readiness.
4. Verify apex and `www`; verify auth/app/admin and two tenant/custom hosts remain on their original services.
5. Re-run public smoke, crawler, cookie, and projection-degradation checks.
6. Record old/new digest, trigger, timestamps, alert state, and owner. If mutable authority is wrong, withdraw/pause it at the owning domain rather than rolling unrelated Web code.

## Incident triage

- 5xx only on content: inspect Web revision and Git content parser errors.
- projection 503: inspect private network, service token rotation, Studio boundary, Redis rate coordination, and authority registration.
- stale discovery record: verify purge event, no-store response, edge cache key, and sitemap regeneration.
- wrong price: immediately suppress/withdraw the price book through billing authority; do not patch an amount into Web.
- cookie observed: remove public traffic from the candidate and inspect edge middleware and upstream ownership. A parent-domain cookie is launch-blocking.
- direct origin reachable: close the origin security group/edge route before restoring traffic.

## Evidence

Attach immutable digests, edge route snapshot, TLS/DNS output, alert links, canary timeline, rollback timeline, crawl reports, Web Vitals, secret/SBOM scan, and the signed launch decision. Browser acceptance evidence must use `https://3002.blyss.co.ke`; loopback evidence is liveness-only.
