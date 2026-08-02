# Fuma immutable runtime-tree releases

Status: **Closed — FUMA-SITE-002 (2026-07-29).** Production composition and aggregate validation are complete.

This reference defines the immutable runtime-tree artifact published beside the existing semantic HTML/CSS release. It implements the amended SITE-002 boundary for official components, owner-private declarative components, and separately validated restricted-client artifacts. SITE-002 itself did not create `apps/site-runtime`; the separately closed SITE-003 now consumes these bytes through its private boundary. Neither ticket dynamically loads tenant Server Components, persists executable JSX, lets Next query draft/platform tables, or replaces the semantic compiler.

## Source map

```text
apps/studio/server/fuma/publishing/
├── composition.ts                      production AtomicPublishWorker composition
└── runtimeTree/
    ├── contracts.ts                    strict TypeBox release contracts
    ├── renderer.ts                     deterministic validator and renderer adapter
    └── projector.ts                    EditorSiteDocument production projection

tooling/site-runtime/
├── runtimeReleaseFixtures.ts           seeded two-release AI/designer fixture
└── tests/
    ├── site-runtime-release.harness.ts
    ├── site-runtime-release.architecture.test.ts
    ├── site-runtime-release.security.test.ts
    ├── site-runtime-release.fault.test.ts
    ├── site-runtime-release.demo.test.ts
    └── site-runtime-release.production.test.ts
```

The production contracts, projector, and renderer live inside Studio's publishing boundary. Tooling contains fixtures and tests only; production imports no tooling module. `RuntimeTreeRendererAdapter` is structurally assignable to the existing `SemanticReleaseRenderer` consumed by `AtomicPublishWorker`, and exact release identity is supplied from the worker's already validated durable claim. The closed SITE-003 runtime consumes immutable route bytes only through its app-local strict TypeBox private client and Studio-owned host/release authority; it imports neither Studio nor tooling at runtime.

## Artifact set

Each successful publication emits:

- the existing semantic HTML and Core Framework CSS unchanged;
- one deterministic `application/vnd.fuma.runtime-route+json` artifact per canonical route;
- one deterministic `application/vnd.fuma.runtime+json` snapshot at `/runtime/snapshot.json`;
- optional immutable media and safe public-data artifacts;
- separately validated, owner-confirmed restricted-client JavaScript, CSS, and source-map artifacts.

The runtime snapshot contains exact platform/organization/workspace/site/owner-generation/release/source-snapshot coordinates, exact component-registry version, routes, pages, layouts, Visual Components, declarative nodes, styles, tokens, media, safe public data, registry entries, and immutable artifact references. It states that semantic HTML/CSS coexists, old releases remain readable, runtime draft/platform-table reads are forbidden, and tenant Server Components are forbidden.

`canonicalRuntimeJson` sorts object keys and all semantically unordered release collections. The runtime-tree hash covers the canonical snapshot body before `runtimeTreeHashSha256` is added. Route hashes follow the same rule. `AtomicPublishWorker` then applies the existing release-scoped content-addressed object key and manifest hashes, so retries reproduce the same bytes and object identities.

## Component trust

Every node references `namespace + component ID + exact version`; no range or implicit latest version exists.

- **Official:** source is `fuma`, trust is `official`, execution is an official Server or Client Component already compiled into the runtime, and no source/definition artifact is persisted.
- **Owner-private declarative:** source carries exact owner/site and visual-designer, AI-designer, or source-import origin. Its definition is a strict data-only tree of exact approved component references. Private use does not require marketplace review.
- **Restricted client:** source carries exact owner/site, an immutable source hash, exact props/slot hashes, declared safe capabilities, complete validation evidence, and owner confirmation. The release stores only validated bundle/CSS/source-map bytes and metadata—not source JSX. It cannot claim server, network, secret, provider, or payment authority.

Validation rejects cross-owner/site substitution, absent exact versions, recursive private definitions, undeclared node capabilities, capability drift between a component and executable bundle, absent artifacts/data/layouts/styles/media, executable-source keys, and tenant Server Component promotion.

## Artifact and reference policy

Artifact descriptors bind logical path, role, exact MIME, byte count, SHA-256 hex, SHA-256 SRI, in-release references, exact component reference where applicable, and declared capabilities. References are canonical absolute release paths and must resolve inside the same manifest.

Allowed role/MIME pairs are closed:

| Role | MIME |
|---|---|
| semantic HTML | `text/html` |
| semantic/component CSS | `text/css` |
| runtime route | `application/vnd.fuma.runtime-route+json` |
| restricted client bundle | `text/javascript` or `application/javascript` |
| restricted source map | `application/json` |
| media | AVIF/JPEG/PNG/WebP/SVG/WOFF2 |
| safe public data | `application/json` |

Restricted bundle, CSS, and map logical paths include their exact content hash. Source maps must be UTF-8 version 3 maps with safe relative source names; embedded `sourcesContent`, `sourceRoot`, URLs, absolute paths, and traversal are rejected. A client bundle carries the component's exact capability set; non-executable CSS/maps carry none.

## Publication and lifecycle

The adapter first buffers the existing semantic renderer output, validates one exact immutable projection, emits legacy and restricted artifacts, emits route artifacts, and emits the root runtime snapshot last. Every generated reference is supplied to `AtomicPublishWorker`, whose existing release service verifies complete object inventory, bytes, MIME, hashes, references, build claim, and current owner scope before finalization and re-verifies before atomic activation.

SITE-002 adds no release tables or migration. Existing lifecycle authority remains unchanged:

```text
queue → claim exact snapshot → render/validate → immutable upload
  → finalize ready release → cancellation/fault check → atomic activate
```

Cancellation and any runtime validation failure occur before activation. Durable manifest effects make retry identity exact. Existing active/manual retention roots preserve old runtime/component artifacts. Existing active-pointer activation and rollback return atomically to a retained release without rewriting either release. Semantic HTML/CSS remains available for legacy rendering and rollback.

## Seeded dual-release demo

The fixture publishes `/menu` twice. Both releases contain semantic HTML/CSS, a private AI-designed declarative restaurant feature card, and a visual-designer restricted menu-reveal client with validated JavaScript/CSS/source-map artifacts. Release 2 changes the private exact version, restricted exact version, content, token values, and artifact hashes.

The demo:

1. publishes and activates release 1;
2. manually retains release 1;
3. finalizes release 2 but injects a fault before activation, leaving release 1 active;
4. retries release 2 to the exact finalized manifest and activates it once;
5. reads both old and new exact private component versions;
6. rolls the active pointer back to retained release 1 and verifies its original runtime-tree hash.

## Production composition

The conductor finalized production composition in `apps/studio/server/fuma/publishing/composition.ts`. It wraps the existing `CoreSemanticReleaseRenderer` with `RuntimeTreeRendererAdapter`, projects a validated immutable `EditorSiteDocument`, and retains the current `AtomicPublishWorker`, `ReleaseService`, durable job registration, object verification, active-pointer transaction, and retention authority.

The closed object-storage policy now admits runtime snapshot/route JSON, validated JavaScript, JSON source maps/public data, and the already approved media MIME set. `apps/studio/server/fuma/objectStorage/integrity.ts` accepts custom runtime MIME types only when their bytes are valid JSON and accepts JavaScript declarations only for safe UTF-8 text rather than HTML, CSS, JSON, or binary substitution. No schema migration was added.

The production test proves a real canonical editor document, semantic publisher output, one private Visual Component, exact durable release context, semantic HTML/CSS plus runtime routes/snapshot, MIME integrity, and release-context substitution denial.

## Focused verification

```sh
bun test \
  tooling/site-runtime/tests/site-runtime-release.architecture.test.ts \
  tooling/site-runtime/tests/site-runtime-release.security.test.ts \
  tooling/site-runtime/tests/site-runtime-release.fault.test.ts \
  tooling/site-runtime/tests/site-runtime-release.demo.test.ts \
  tooling/site-runtime/tests/site-runtime-release.production.test.ts
```

Integrated focused result: **23 pass, 0 fail, 84 assertions**.

No browser acceptance is required: this ticket publishes immutable artifacts but does not create or route the SITE-003 application.
