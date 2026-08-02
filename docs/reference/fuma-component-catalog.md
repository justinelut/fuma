# Component catalog and native AI/MCP authoring (FUMA-SITE-008)

FUMA-SITE-008 adds one owner-bound component catalog and authoring authority over the existing SITE-004 registry, SITE-007 component-pack contracts, FUMA-067 installations, FUMA-068 review marketplace, FUMA-065 native site AI, and FUMA-066 MCP connectors. It does not create another editor, AI runtime, MCP server, review service, signing service, installation authority, publisher, or arbitrary tenant server-code path.

## Catalog sources

The catalog keeps four sources distinct:

- official starter components compiled into the runtime;
- private declarative site-owned immutable releases;
- private restricted-client source compiled and validated without execution;
- currently reviewed/signed component-pack releases read through FUMA-068 and installed through FUMA-067.

Every release and installation uses an exact coordinate and integrity hash. Durable usage covers page nodes, Visual Components, templates, and retained releases; those references block unsafe uninstall and drive upgrade/rollback evidence.

## Private authoring and restricted source

Declarative components support create, immutable edit/version, visual variant, preview, insert, usage listing, and publish checks. Restricted React/Tailwind source is accepted only as an isolated draft. Static policy rejects server APIs, dynamic imports, direct network, secrets/cookies, parent escape, dynamic evaluation, dynamic Tailwind, undeclared dependencies, inaccessible primitives, and budget overflow. Bun transpiles TSX without importing or executing it.

Validation emits hash-bound compiled bytes, security/accessibility/dependency/budget receipts, and exact permission disclosure. Native AI can request validation but cannot confirm executable bytes. A direct owner—or an MCP connector with the separate `component.confirm` grant—must confirm the exact source hash, disclosure hash, owner key, and owner generation before a restricted-client release is sealed.

## Existing native AI and MCP surfaces

The existing site tool registry gains exact tools for create/edit/variant/preview/source validation/confirmation/search/get/install/insert/upgrade/usage/uninstall/publish-check. Each tool reuses the component authority through one neutral port.

FUMA-066 retains one MCP server and one hashed/revocable site connector authority. Component grants are distinct:

```text
component.read
component.create-source
component.install
component.mutate
component.confirm
component.publish
```

List, dispatch, and result commit revalidate the live connector. Existing tool capabilities, owner generation, rates, AI credits, replay receipts, revocation, audit, and operation-bound publish confirmation remain authoritative. `component.publish` cannot bypass the existing explicit publish step-up.

## Hosted boundary and public projection

The existing scoped hosted API contributes:

```text
GET  /components/catalog
POST /components/actions/:action
```

Scope and actor come only from trusted request context. The Studio UI is CSS-module based and Tailwind-free. Public component projection is separate from plugin projection and includes only approved display-safe reviewed metadata; private drafts, source, tenant identifiers, secrets, and usage remain private.

## PostgreSQL authority

Migration `000075_component_catalog_authority` adds exact-scope releases, source drafts, installations, usage, upgrade receipts, and audit evidence. Final checksum:

```text
760f409e118eaffcd72323ffd2f70aaf008bbde3e732e3372afcaf8e64657f61
```

Releases, usage, receipts, and audit are append-only. Source drafts allow only `validated -> confirmed` with exact immutable evidence. Installation updates use compare-and-set versions. Tenant-owner relational transfer may cascade scope columns without rewriting immutable JSON; repository reads compare stored JSON scope with the current relational scope and fail closed, invalidating stale authority until the owning transfer workflow explicitly rebinds it.

## Acceptance

- Focused component/MCP/architecture/UI/public-projection gates: 30 pass, one expected no-URL PostgreSQL skip, 0 fail, 225 assertions.
- Native PostgreSQL 16 on `aarch64`: 1 pass, 20 assertions. Eight-way release, draft-confirmation, installation-CAS, and usage contention converge; immutable evidence and transfer invalidation pass; cleanup leaves zero schemas.
- Strict Studio TypeScript and targeted ESLint pass.
- Native ARM64 Chromium browser acceptance navigates only `https://5174.blyss.co.ke` and proves three-source discovery, installed state, preview/create/variant/insert controls, action response, and filtering. Browser transcript SHA-256: `b87ce3756f72e2613a5237b45e8150639f337d294df54dc3dfc9738acc079c17`.
- Hosted/runnable migrations are `75/75`, next is `000076_release_followup`, and no checksum sentinel remains.
- Root `bun.lock` remains `e9688c20f69e32aa0df7cea681b5c4971ef5a7d272d3e644bc96486384c4c1b9` with no lock diff.

No live provider call, production migration/deployment, external publication, protected signing/scanning, Docker/buildx/QEMU/emulation, DNS/TLS change, purchase, or push is part of this ticket evidence.
