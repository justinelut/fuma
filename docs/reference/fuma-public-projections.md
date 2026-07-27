# Fuma public projections and Web BFF

This reference defines the FUMA-WEB-006 server-owned anonymous projection boundary and private-cluster Next.js client.

Platform domains publish display-safe records through `apps/studio/server/fuma/publicProjections/`. Public browsers call only the same-origin BFF in `apps/web/app/api/public/v1/[resource]/route.ts`; `apps/web/lib/public-projections.ts` sends a separate service credential to Studio and validates the response again before presentation.

---

## TL;DR

- Public resources are `product-facts`, `pricing`, `templates`, `showcases`, `experts`, and `plugins`; opaque handoff envelopes are defined for the later product-transition owner.
- Every request filter, authority result, safe error, page, and versioned envelope is a strict TypeBox boundary from `packages/public-contracts/src/`.
- Public IDs are domain-owned stable opaque IDs. Studio rejects duplicate IDs within a page; Web never substitutes database IDs or editorial values.
- Studio owns dataset versions, deterministic ETags, Redis-backed cache/rate policy, strict host/service authentication, and generic failures.
- Next accepts only allowlisted public hosts, bounded filters, and conditional ETags. It constructs private headers from scratch and never forwards browser Cookie or Authorization values.
- Missing authority, timeout, Redis limit failure, malformed JSON, schema drift, extra fields, mismatched ETags, and untrusted upstream failures return a generic no-store unavailable response.

## Data flow

```text
browser GET /api/public/v1/product-facts?profile=website
  → apps/web/app/api/public/v1/[resource]/route.ts
  → apps/web/lib/public-projections.ts
      validates host/resource/filter; drops visitor credentials
      GET http://studio-internal.service/_fuma/private/public/v1/product-facts
      Authorization: Bearer <service token>
  → apps/studio/server/router.ts
  → apps/studio/server/fuma/publicProjections/boundary.ts
      validates private host/token/filter/rate/cache/authority result
      assigns schemaVersion + datasetVersion + deterministic ETag
  ← strict @fuma/public-contracts envelope
  ← strict revalidation and allowlisted response headers
```

`apps/studio/server/index.ts` mounts the boundary only when `FUMA_HOSTED=true`. Self-hosted Instatic does not initialize Redis or expose this namespace. `apps/studio/server/fuma/publicProjections/authority.ts` has no fallback catalog: each domain owner registers a projection authority, and an unregistered resource returns unavailable rather than guessed content.

## Contracts and stability

`packages/public-contracts/src/projections.ts` owns record, filter, page, and envelope schemas. `packages/public-contracts/src/reads.ts` fixes `schemaVersion: 1`, bounded dataset-version syntax, and quoted ETags. `packages/public-contracts/src/handoff.ts` owns only closed, opaque public-to-product intent shapes; issuing and consuming handoffs remains FUMA-WEB-013 work.

A domain authority returns:

```ts
{
  datasetVersion: 'product-facts:42',
  data: {
    items: [/* strict display-safe records with stable public IDs */],
    page: { hasMore: false, nextCursor: null },
  },
}
```

The ID for one public entity must remain unchanged across dataset versions, renames, and pagination. IDs cannot be tenant selectors, paths, credentials, or mutable ranks. Pages contain at most 100 records, cursors are bounded opaque strings, filters are resource-specific, duplicate query keys fail, and unknown filters fail.

## Cache, rate, and failure policy

`apps/studio/server/fuma/publicProjections/specs.ts` is the resource policy catalog:

- product facts, pricing, and templates use a 30-second Redis projection cache and publish bounded browser/shared-cache headers;
- showcases, experts, and reviewed plugins are `no-store` for immediate moderation withdrawal;
- all resources consume the fail-closed Redis limit before authority access;
- cache failure falls through to authority, while rate coordination failure returns 503;
- ETags hash canonical validated data plus dataset version; exact `If-None-Match` produces 304.

`apps/web/lib/public-projections.ts` caps private response bodies, enforces a 100–10,000 ms timeout, accepts only status/schema-consistent safe errors, checks response ETag against envelope metadata, strips all non-allowlisted headers, and never serves stale or editorial fallback values.

## Configuration

Studio requires these values in hosted production:

```text
FUMA_PUBLIC_PROJECTION_INTERNAL_HOST=studio-internal.service:3001
FUMA_PUBLIC_PROJECTION_SERVICE_TOKEN=<shared 32-256 character secret>
FUMA_REDIS_URL=<private Redis URL>
FUMA_REDIS_NAMESPACE=<deployment namespace>
```

The independent Web service requires:

```text
FUMA_PUBLIC_PROJECTION_INTERNAL_ORIGIN=http://studio-internal.service:3001
FUMA_PUBLIC_PROJECTION_SERVICE_TOKEN=<same shared secret>
FUMA_PUBLIC_PROJECTION_TIMEOUT_MS=3000
FUMA_PUBLIC_WEB_HOSTS=fuma.co.ke,www.fuma.co.ke,3002.blyss.co.ke
```

The internal origin must be a bare HTTP(S) origin outside every `*.fuma.co.ke` public host. There is no public API hostname. Production orchestration injects the token separately into Studio and Web; it is never emitted to a browser.

## Adding an authority

1. Keep mutable business authority in its existing Studio platform domain. Do not query it from Web.
2. Return only the matching page schema and a monotonic or content-addressed dataset version through `PublicProjectionAuthority` in `apps/studio/server/fuma/publicProjections/authority.ts`.
3. Register the adapter in hosted composition. Never add fixture fallback records to `apps/web`, Markdown, or the authority catalog.
4. Add focused strict-schema, withdrawal, pagination, stable-ID, ETag, cache, and safe-failure tests.
5. If a new public field or resource is needed, ratify it in `packages/public-contracts` and extend the hostile architecture gate before mounting it.

## Forbidden patterns

Public contracts, projections, BFF responses, RSC payloads, and HTML exclude provisional organizations, tenant/internal IDs, private offers, setup negotiations, internal grants, provider credentials or identifiers, COGS, margins, internal entitlements, grandfathered terms, payment or transfer state, staff/auth/admin session material, secrets, and PII. They also exclude direct databases/providers in Web, app-to-app imports, Zod, visitor credential forwarding, parent-domain or staff cookies, public API hosts, hardcoded business truth, stale pricing fallback, and unknown-host fallback.

## Related

- `docs/reference/fuma-workspace-public-web-architecture.md` — governing host/session/data ADR.
- `docs/reference/fuma-public-web-scaffold.md` — Next application foundation.
- Source contracts: `packages/public-contracts/src/projections.ts`, `packages/public-contracts/src/reads.ts`, `packages/public-contracts/src/handoff.ts`.
- Studio source: `apps/studio/server/fuma/publicProjections/`, `apps/studio/server/router.ts`, `apps/studio/server/index.ts`.
- Web source: `apps/web/lib/public-projections.ts`, `apps/web/app/api/public/v1/[resource]/route.ts`, `apps/web/app/contract-demo/page.tsx`.
- Gates: `apps/studio/src/__tests__/architecture/fuma-public-projection-boundary.test.ts`, `apps/studio/server/fuma/publicProjections/boundary.test.ts`, `apps/web/tests/public-projection-bff.test.ts`.
