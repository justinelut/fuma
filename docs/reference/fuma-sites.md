# Fuma Sites and Legacy Bootstrap

This reference defines organization/workspace-owned site lifecycle and the one-time legacy Instatic site bootstrap seam.

The site module persists profile assignments in `fuma_sites`, validates them through the registry, and upgrades the singleton historical `site` authority by adding an owned Website record with the same ID. The upgrade does not migrate or rewrite content.

---

## TL;DR

- A site belongs to exactly one `organizationId` and `workspaceId`; every normal operation in `server/fuma/sites/service.ts` carries both scopes.
- `LegacySiteBootstrapService` in `server/fuma/sites/legacyBootstrap.ts` reads the historical `site` row and inserts a `fuma_sites` Website with exactly that row's ID.
- Bootstrap accepts only a caller-supplied organization, its active default workspace, a site slug, and capability overrides. The Website profile ID is fixed by the seam and composed through `FumaRegistry`.
- Bootstrap is transactional, takes an ID-global site ownership lock, rejects conflicting ownership, and returns the same owned Website on reruns.
- The historical `site` row and all existing content/media IDs and references remain untouched. No `data_tables`, `data_rows`, upload, or media rewrite occurs.
- Website and Publication use the same `SiteService`; shared persistence, infrastructure, and lifecycle code do not branch on profile IDs.
- Hosted sites remain on pooled PostgreSQL, Redis coordination, object storage, process, and edge infrastructure by default.
- No site HTTP route is mounted here. FUMA-021 owns request-context composition and central routing.

## Module shape

`server/fuma/sites/index.ts` is the public server module barrel:

| File | Responsibility |
|---|---|
| `server/fuma/sites/contracts.ts` | TypeBox site IDs, commands, profile assignment, status, and persisted record contracts |
| `server/fuma/sites/profileAssignment.ts` | Slug policy and registry-backed profile/override validation |
| `server/fuma/sites/repository.ts` | PostgreSQL tenant-scoped site reads, writes, locks, and active-site count guard |
| `server/fuma/sites/service.ts` | Normal create, read, update, archive, and restore lifecycle |
| `server/fuma/sites/legacyBootstrap.ts` | One-time exact-ID legacy ownership bootstrap |
| `server/fuma/sites/schemaManifest.ts` | Hosted schema authority manifest |

The hosted table is created by `server/fuma/db/migrations/000006_sites.ts`. Its primary key and foreign keys retain the complete organization/workspace/site scope. The historical migration sources in `server/db/migrations-pg.ts` and `server/db/migrations-sqlite.ts` remain immutable.

## Normal lifecycle

`SiteService` validates every untyped command against `server/fuma/sites/contracts.ts`. Create, slug updates, archive, and restore run in repository transactions and acquire the workspace lock before checking parent ownership and status.

A creation command contains an explicit profile assignment:

```ts
const publication = await sites.create({
  id: 'editorial-publication',
  organizationId,
  workspaceId,
  slug: 'editorial',
  name: 'Editorial publication',
  profileId: 'publication',
  capabilityOverrides: { grant: [], revoke: [] },
})
```

The service passes the assignment to `createSiteProfileAssignment`, which delegates composition to `FumaRegistry.compose`. The same path creates Website, Publication, and injected registry profiles. Site profile identity is immutable after creation; capability overrides remain replaceable through `SiteService.update`.

Archive and restore are idempotent. Archived sites remain addressable but cannot be updated until restored. Active-site counting through `PostgresSiteRepository.countActiveOwnedSites` composes with the workspace archive guard in `server/fuma/workspaces/service.ts`.

## Legacy bootstrap

The bootstrap input is deliberately narrower than normal site creation:

```ts
const website = await bootstrap.bootstrap({
  organizationId,
  workspaceId: defaultWorkspaceId,
  slug: 'primary-site',
  capabilityOverrides: { grant: [], revoke: [] },
})
```

The caller cannot replace the Website profile. `LegacySiteBootstrapService` composes the fixed `website` assignment through the injected registry, so a registry without Website and malformed, unknown, duplicate, or conflicting capability overrides fail before persistence.

Inside one repository transaction, `PostgresLegacySiteBootstrapRepository` performs these steps:

1. Takes a `SHARE` lock on the historical `site` table and a `SHARE ROW EXCLUSIVE` lock on `fuma_sites`, stabilizing even an empty legacy authority and giving the one-time seam an ID-global ownership view while writes are excluded.
2. Reads the historical `site` authority. Exactly one representable row must exist.
3. Reads and row-locks the caller's workspace by `(organization_id, id)`. It must be active and `is_default = true`.
4. Searches all `fuma_sites` owners for the exact historical site ID.
5. Rejects any organization/workspace ownership conflict; returns an already-owned Website unchanged on a valid rerun.
6. Checks the workspace-qualified slug and inserts one active Website using the historical ID and name.

The transaction rolls back as a unit. The seam never updates or deletes the historical `site` row. It also never writes `data_tables`, `data_rows`, media records, uploads, page trees, or their references. Existing content continues to retain its current IDs and links; the new `fuma_sites` row adds hosted ownership metadata rather than replacing content authority.

## Infrastructure and routing boundaries

Site profile assignment does not allocate infrastructure. The hosted defaults in `docs/reference/fuma-platform-architecture.md` remain shared PostgreSQL, pooled Redis coordination, pooled object storage, pooled Bun process capacity, and pooled edge capacity. A Website and a Publication beside it use the same persistence and lifecycle services.

`server/fuma/sites/` contains no HTTP handler and does not modify `server/router.ts`. FUMA-021 must provide immutable authenticated request context, exact organization/workspace/site scope, authorization, mutation-Origin policy, and central route composition before site endpoints are mounted. This matches the unmounted workspace boundary described in `docs/reference/fuma-workspaces.md`.

## Forbidden patterns

- Generating a replacement ID for the historical site or copying content under new IDs.
- Updating/deleting `site`, `data_tables`, `data_rows`, media, uploads, page trees, or stored references during ownership bootstrap.
- Treating any non-default or archived workspace as the legacy site's parent.
- Returning an ID match owned by another organization/workspace as an idempotent success.
- Bypassing `FumaRegistry.compose` for profile or override validation.
- Branching shared persistence, lifecycle, routing, permission, infrastructure, or navigation behavior on Website/Publication profile IDs.
- Allocating per-site databases, caches, buckets, processes, or edge capacity by default.
- Mounting site routes before FUMA-021 provides immutable request context and authorization composition.

## Related

- `docs/reference/fuma-platform-architecture.md` — tenant hierarchy, pooled topology, profile-composition policy, and migration boundaries.
- `docs/reference/fuma-profiles.md` — Website/Publication registry composition and override guarantees.
- `docs/reference/fuma-workspaces.md` — workspace ownership, default lifecycle, and deferred HTTP composition.
- Source-of-truth site barrel: `server/fuma/sites/index.ts`
- Legacy bootstrap: `server/fuma/sites/legacyBootstrap.ts`
- Normal lifecycle: `server/fuma/sites/service.ts`
- Hosted site migration: `server/fuma/db/migrations/000006_sites.ts`
- Contract and integration tests: `src/__tests__/fuma/siteContracts.test.ts`, `src/__tests__/fuma/siteService.test.ts`, `src/__tests__/fuma/siteBootstrap.test.ts`
