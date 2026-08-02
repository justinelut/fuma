# Fuma component-pack and private-component SDK

Status: **Closed — FUMA-SITE-007 (2026-07-29).** This SDK/policy ticket is complete; persistence, signing/review authority, editor/AI/MCP integration, and tenant-runtime rendering remain owned by their dependent tickets.

## Open exact-version registry

`tooling/component-packs/` defines a strict TypeBox registry whose accepted sources are official Fuma, private site-created, AI-created, designer-created, source-imported, team packs, and reviewed marketplace packs. Registry coordinates are always `<namespace>/<pack>@<exact-version>`. Every release stores canonical bytes, byte length, and SHA-256 integrity. Re-registering a coordinate with different bytes fails; dependencies pin exact coordinates and integrity.

Namespaces are owner-bound. Private site ownership includes organization, workspace, site, owner key, and owner generation. Team ownership includes organization, workspace, owner key, and owner generation. Platform ownership is reserved for official source. Cross-owner namespace substitution and private use fail closed.

## Three execution lifecycles

### Private declarative

A declarative pack is canonical data, not executable JSX. Components expose typed props, named slots, variants, a flat canonical node tree, loops, conditions, bindings, styles, tokens, responsive rules, reduced-motion-aware animations, and bounded interactions. Valid site/team definitions can be sealed, versioned, and used immediately by the exact owner. Marketplace review is not required. Trees reject missing nodes, cycles, unreachable nodes, self-component references, schema-hash drift, privileged permissions, and mutable bytes.

### Private generated restricted client

React/Tailwind source exists only as an `isolated-draft`. Static policy rejects server directives/entrypoints, Node built-ins, dynamic imports, direct network primitives, secret/environment/cookie access, parent/opener escape, wildcard messaging, generated evaluation, dynamic Tailwind utilities, and undeclared dependencies.

A restricted client release requires exact source binding and passing evidence for static source, TypeScript, build, static Tailwind, accessibility, security, CSP, network, dependency, and budget checks. The permission disclosure must exactly equal requested permissions. Owner confirmation binds the source hash, disclosure hash, owner key, and owner generation. The resulting immutable release contains compiled JavaScript/CSS hashes and validation/disclosure/confirmation receipt hashes—not source JSX. Its sandbox contract denies server execution, dynamic imports, and direct network; only browser and disclosed typed Bun API authority are eligible.

### Trusted or privileged

Server, provider, unrestricted network, payment, and secret authority are never granted by private confirmation. A trusted privileged payload requires explicit reviewed distribution, declared privileged permissions, build provenance, and `fuma-review-authority` promotion evidence. Tenant-controlled Server Components are never dynamically imported into the shared Next process. Official server components remain platform-owned compiled source.

## Distribution and lifecycle

Private creation and marketplace distribution are separate. `promoteReviewedDistributable` creates a new exact immutable reviewed release and requires provenance, license, accessibility, compatibility, dependency, and security evidence plus the existing FUMA-067/FUMA-068 seams. It does not perform review or signing itself.

Installs pin exact versions. Upgrade previews report capability, permission, dependency, props/slot schema, compatibility, visual artifact, affected-node, confirmation, and rollback differences. Uninstall is blocked while page nodes, Visual Components, templates, or retained releases reference the pack. Marketplace withdrawal blocks new marketplace installation but preserves installed bytes, private definitions, and retained release resolution. Critical security revocation preserves evidence/bytes but blocks new installs, pins, and publishing pending audited remediation or fallback.

## Canonical boundary

Canonical pages and Visual Components may persist component references, exact versions, props, slots, children, classes, styles, rules, tokens, bindings, and other declarative data. They must not persist JSX/TSX, executable source, Server Component paths, dynamic imports, or Tailwind compilation input. Studio remains Tailwind-free. The SDK imports no application and adds no shared UI package.

## Authority seams and non-claims

- **FUMA-067 — closed:** production persistence for immutable artifacts/object bytes, exact installation state, transfer/rekey state, generation-qualified quotas, crashes, schedules, storage/calls, and authoritative usage references. Component packs remain denied backend-worker/schedule/secret/crash authority.
- **FUMA-068:** perform marketplace review, provenance/license decisions, scanning, signatures, withdrawal decisions, and audited security revocation.
- **FUMA-SITE-008:** add catalog/editor UI and extend the existing native AI and MCP tool authorities with authoring, validation, confirmation, install, and upgrade flows.
- **Tenant runtime tasks:** interpret release-bound artifacts and provide the actual restricted client sandbox and compiled official registry.

The in-memory `OpenComponentPackRegistry` is an executable policy model and test seam, not production persistence or installation authority. Validation receipts model required external compiler/a11y/security/CSP checks; SITE-007 verifies binding and lifecycle policy but does not introduce a compiler service. Promotion evidence is consumed, never issued or signed here. No migration is required.

## Verification

Focused suites are in `tooling/component-packs/tests/`:

- `component-packs.architecture.test.ts` — strict TypeBox and authority boundaries;
- `component-packs.behavior.test.ts` — private/restricted/reviewed lifecycle behavior;
- `component-packs.security.test.ts` — hostile source, integrity, tenant, schema, permission, and dependency cases;
- `component-packs.fault.test.ts` — compatibility, uninstall, withdrawal, retention, and revocation faults;
- `component-packs.demo.test.ts` — the complete amended restaurant demo.
