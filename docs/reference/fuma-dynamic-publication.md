# Fuma dynamic Publication templates and archives

FUMA-037 adds a data-only template and loop layer over the universal Publication content model. It does not introduce a second content store. Published post/page rows remain in `data_tables`/`data_rows`, normalized author/tag relations remain in `data_row_relations`, and lifecycle/access authority remains in `fuma_publication_metadata_authority`.

## Template and route model

`src/core/fuma/publication/dynamicPublication.ts` is the strict TypeBox contract. A template has a stable ID, monotonic version, target, explicit empty state, and bounded semantic blocks. Targets cover shared or specific post, page, author, tag, date, and collection routes. Blocks choose a safe semantic element and either literal text or one allowlisted binding; tenant JavaScript, JSX, raw HTML, and arbitrary URLs are not accepted.

Canonical public routes are:

- `/posts/:slug` and `/pages/:slug` for detail templates;
- `/authors/:authorId` and `/tags/:tagId` for live archives;
- `/archive/:year[/:month]` for UTC publication-date archives;
- `/collections/:collectionId` for built-in `posts`/`pages` and content carrying that stable collection ID.

Page one has no query. Later archive pages use only `?page=N`; explicit `?page=1`, tracking parameters, and noncanonical path forms redirect with 308. Out-of-range pages return a non-oracular 404. Empty first pages render the template's explicit empty state.

## Access and query guarantees

`PostgresDynamicPublicationRepository.queryLoop` performs one bounded SQL statement per loop page. It selects at most 50 items, batches author/tag relations in a CTE, and returns a single aggregate envelope; rendering never loads relations per item. Every query is constrained by exact platform, organization, workspace, site, owner key, owner generation, and profile. Current active owner authority and the site's current profile are revalidated under a transaction before reads or writes.

Only published, nondeleted rows whose publication time is at or before `asOf` qualify. Public rows are always eligible. Member, paid, and segment rows require the server-derived audience. Segment intersection happens inside SQL against immutable metadata authority. Caller body/query/header tenant coordinates are never accepted.

`DynamicPublicationPublicBoundary` derives scope from a trusted Host authority port and audience from a server authority port. It accepts only GET/HEAD, emits canonical metadata, uses private/no-store caching for personalized audiences, and never resolves tenant identity from visitor parameters.

## Studio integration

`DynamicPublicationTemplateEditor.tsx` is an app-local CSS Modules surface using the existing Studio `Button` primitive. It exposes route type, optional specific target, empty state, semantic element, block scope, and allowlisted binding controls, and preserves read-only authority visibly.

Primary composition should:

1. call `createDynamicPublicationComposition(db)` from `dynamicPublicationComposition.ts`;
2. append its `scopedRoutes` to the existing Publication scoped route list;
3. mount `composition.createPublicBoundary(...)` ahead of generic public fallback routing with production Host and audience authorities;
4. mount `DynamicPublicationTemplateEditor` from the Publication design surface using `DynamicPublicationHttpClient`.

No central composition, runtime, router, job-handler, package, or migration-registry file is modified by this ticket branch.

## Migration candidate

`server/fuma/db/migrations/000050_dynamic_publication_templates.ts` is additive and exact-scope. It stores only template authority and adds one partial unique active-target index. It is intentionally not present in the central migration index and has no finalized checksum; the primary integration owner must register and finalize it after resolving concurrent migration ownership.

## Focused evidence

- `dynamicPublication.test.ts`: all target kinds, private/foreign-site exclusion, member/paid/segment admission, constant query counts, canonical pagination, empty states, shared article-template update, live author/tag demo, and Host-derived public routing.
- `fuma-dynamic-publication.test.ts`: additive migration, TypeBox-only boundaries, exact scope qualifiers, batched SQL, no per-item DB calls, app isolation, CSS Modules, and composition seams.
- `fumaDynamicPublicationTemplateEditor.test.tsx`: labels, keyboard-native controls, read-only state, typed binding creation, and stable save payload.
- Existing module-size and cycle gates cover every new Studio/server module.
