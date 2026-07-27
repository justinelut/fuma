# Fuma governance-to-launch phase (FUMA-063–085 + tracker 86)

This phase is isolated in `packages/fuma-governance-launch`, `apps/control-surfaces`, and `infra/fuma-phase-13-18`. It deliberately does not edit the hosted migration index, central router, transfer registry, shared public-contract barrel, root lockfile, or legacy Studio styling while those hotspots have concurrent owners. `handoff/central-integration.yaml` is the binding integration checklist. The code is authored but unvalidated because this coding-only phase prohibited all test, typecheck, build, lint, Playwright, Docker, cloud, and validation execution.

## Dependency-ordered inventory

| Ticket | Production boundary | Main evidence files |
|---|---|---|
| FUMA-063 | strict provider/model catalog, exact micro pricing, refresh staleness, visibility and kill switches, secret-free projection | `src/contracts.ts`, `src/ai.ts`, `config/ai-catalog.example.json`, migration 000013 |
| FUMA-064 | version-fenced credit accounts, reserve/settle/refund/expiry, budget checks, encrypted BYOK metadata and transfer states | `src/ai.ts`, migration 000013, AI unit/fault tests |
| FUMA-065 | exact actor/org/workspace/site/owner-generation/capability AI invocation boundary | `authorizeSiteAi`, unit/security tests |
| FUMA-066 | hashed expiring/revocable MCP connectors, scoped capabilities, publish step-up and usage dimensions | `authorizeMcp`, migration 000013 |
| FUMA-067 | immutable package artifacts, isolated installations, quota/state, generation-fenced secret rekey transfer | `src/plugins.ts`, migration 000014 |
| FUMA-068 | hash-bound review, scanner state, reviewer separation, signature verification, reviewed marketplace UI/contribution | review service, migration 000014, `/marketplace` |
| FUMA-069 | reviewed first-party payment plugin consuming shared merchant bindings only | `plugins/customer-payments` |
| FUMA-070 | AI proposal disclosure and nonce confirmation; direct secure UI credential handoff | confirmation boundary, `/secure-payment`, secure route |
| FUMA-071 | admin-host contribution registry and redacted console surface; domain services retain mutation authority | `src/operations.ts`, `/internal` |
| FUMA-072 | stepped-up expiring non-nested support and isolated dual-approver break glass; immutable moderation evidence | operations policy, migration 000015 |
| FUMA-073 | opted-in approved expert profiles, PII-free bounded ranking, moderation invalidation and encrypted inquiry storage | operations policy, migration 000015 |
| FUMA-074 | current paid-contract handoff authority, destination/quotas/legal revalidation, registered asset owners, `en-KE`/KES/Africa-Nairobi UX | operations policy, `/transfers` |
| FUMA-075 | Ghost 5 structured mapping, provenance/count/relation/media manifests, secret rejection, idempotent rollback receipt | `src/imports.ts`, Ghost fixture, migration 000016 |
| FUMA-076 | complete Lawyer inventory, custom excerpt quarantine, provider-verified payment reconciliation, staff/member reauth and OCI mail migration | import adapter, Lawyer fixture |
| FUMA-077 | complete route bindings through reusable templates/loops/tokens/assets/access state, with zero flattened copies | design manifest fixture/assertion |
| FUMA-078 | digest-required non-root amd64/ARM64 Dockerfiles, GHCR workflow, SBOM/provenance and paired release template | `infra/.../docker`, workflow, release template |
| FUMA-079 | pinned Oracle k3s/Traefik inputs, exact-host routes, no default tenant, restricted pods, network policy and digest workloads | `infra/.../oracle`, `infra/.../k3s` |
| FUMA-080 | suspended serialized migration, encrypted off-host backup, isolated restore verification and promotion evidence policy | `operations.yaml`, launch policy, backup runbook |
| FUMA-081 | tenant-safe telemetry, RED/USE/provider/Web Vitals alerts, measured HPA/KEDA and explicit scheduler uniqueness | launch policy, autoscaling/observability manifests |
| Tracker 86 | public-web deployment seam: same SHA/contract versions, private audience, canary cap, independent public rollback with product/tenant continuity | seam contract/config, routing, integration/fault tests |
| FUMA-082 | IDOR/scope/host/secret/import adversarial controls, subject export/delete plan with legal exceptions and incident process | security tests, migration 000017, security runbook |
| FUMA-083 | ARM64 performance/isolation budgets and complete cost model with ≤30% variable COGS and ≥70% customer gross margin | capacity config and policy/tests |
| FUMA-084 | fail-closed SQLite/Ghost/Lawyer pilot evidence, immutable grandfathered contract, OCI mail, parity/provider reconciliation and rollback | pilot checklist and policy |
| FUMA-085 | paired signed gate, objective abort, host/session/public/security/accessibility/provider/economics approvals, canary and rollback | launch gate, policy/tests/runbook |

## Security and authority invariants

1. All untrusted boundaries are strict TypeBox objects with `additionalProperties: false`; there is no Zod.
2. Tenant authority requires the full platform/organization/workspace/site/owner-key ancestry and, for mutable site resources, owner generation.
3. Catalog credentials, BYOK ciphertext references, payment secrets, MCP token material, inquiry bodies, support evidence, provider webhook bodies and raw PII never appear in public responses or telemetry.
4. Plugin review binds exact bytes and permissions. Submitters cannot approve themselves; revoked/unreviewed/unsigned packages cannot one-click install.
5. AI can propose payment setup but cannot supply or read credentials and cannot write until explicit actor confirmation.
6. Internal console host checks do not confer authority. Existing sessions, step-up, capability resolution, protected-owner policy, auditing and domain services remain central prerequisites.
7. Public expert publication is explicit and reversible. Opt-out or moderation immediately removes read/search/inquiry eligibility.
8. Launch defaults to abort. Template digests, false evidence booleans, empty approvals and pending checksums are intentionally non-promotable.

## Migration policy

`migrations/000013` through `000017` are phase-local additive PostgreSQL source artifacts, not hosted IDs. Because Publication owns hosted `000013`–`000020` and Commercial Edge reserves `000021`–`000034`, the central integrator must convert/register these sources as hosted `000035_ai_governance` through `000039_launch_evidence_privacy`, calculate immutable checksums, verify source order, and obtain authorization before execution. `pending-central-integration` is a blocker, not a runnable checksum. Every paired release must declare `000039_launch_evidence_privacy` as its governance high-water mark.

## UI policy

`apps/control-surfaces` is a bounded Next app with exact versions: Next 16.2.9, React 19.2.5, Tailwind 4.3.3, shadcn 4.14.1, and TypeBox 0.34.49. Its shadcn components and CSS are app-local. It creates no shared UI package and does not import or modify legacy Studio CSS. Production host policy is exact `app.fuma.co.ke` or `admin.fuma.co.ke`; the only development acceptance exception is the mandated `https://5174.blyss.co.ke` proxy.

## Evidence status

The test files cover unit, integration, security, fault, architecture, and Playwright categories. `tooling/evidence.ts --dry-run` can inventory/hash source and assemble an explicitly unsigned, zero-evidence, non-promotable candidate from CI digest files; it cannot represent acceptance. `handoff/dry-run-plan.json` records every intended command with `executed: false`, and `handoff/requirement-matrix.json` records source completion plus exact central/external blockers. No evidence file was generated and no dry-run command was executed in this phase because running even dry-run validation/tooling was prohibited.
