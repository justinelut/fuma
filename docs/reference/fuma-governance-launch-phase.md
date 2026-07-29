# Fuma governance-to-launch phase (FUMA-063–085 + tracker 86 + planned FUMA-SITE-001..008)

This phase began as isolated work in `packages/fuma-governance-launch`, `apps/control-surfaces`, and `infra/fuma-phase-13-18`. The phase-local inventory below is retained as historical design evidence. Subsequent hosted conductor integrations supersede its original coding-only status only for tickets explicitly closed in `docs/handoffs/fuma-tracker-closure-audit.md`; central migration, runtime, and validation evidence is recorded there and in ticket references.

## Dependency-ordered inventory

| Ticket | Production boundary | Main evidence files |
|---|---|---|
| FUMA-063 | finalized strict provider/model catalog, exact micro pricing, refresh staleness, visibility and kill switches, secret-free projection | `apps/studio/server/fuma/aiCatalog/**`, hosted migration `000063_ai_catalog_authority`, focused/native PostgreSQL evidence |
| FUMA-064 | version-fenced credit accounts, reserve/settle/refund/expiry, budget checks, encrypted BYOK metadata and transfer states | `src/ai.ts`, migration 000013, AI unit/fault tests |
| FUMA-065 | exact actor/org/workspace/site/owner-generation/capability boundary for the existing native AI agent later extended by SITE-008 | `authorizeSiteAi`, unit/security tests |
| FUMA-066 | existing hashed expiring/revocable MCP connectors, scoped capabilities, publish step-up and usage dimensions later extended by SITE-008 | `authorizeMcp`, migration 000013 |
| FUMA-067 | immutable plugin/component-pack artifacts, distinct execution policy, isolated installations, quota/state, generation-fenced transfer | `apps/studio/server/fuma/artifacts/**`, hosted migration `000070_artifact_installation_authority`, focused/native PostgreSQL evidence |
| FUMA-068 | closed unified hash-bound plugin/component review, canonical package/SITE-007 scanners, reviewer separation, Ed25519 signatures, revocation and fail-closed marketplace UI/contribution | `apps/studio/server/fuma/artifactReviews/**`, hosted migration `000071_artifact_review_marketplace`, scoped `/marketplace/artifacts` routes |
| FUMA-069 | closed reviewed `fuma.customer-payments@1.0.0`; strict create/receipt/refund SDK and host binding; three sandboxed paid blocks; shared FUMA-058 credential/transport/webhook/ledger authority; exact live review/install/site revalidation; durable obligation/receipt/refund records | `packages/fuma-governance-launch/plugins/customer-payments`, `apps/studio/server/fuma/customerPayments/plugin*.ts`, hosted migration `000073_customer_payment_plugin` |
| FUMA-070 | closed fixed AI proposal over the reviewed payment plugin; exact grant/fee disclosure; browser nonce hash and fresh direct explicit confirmation; scoped HttpOnly one-time credential handoff; shared fixed KES 1.00 FUMA-069 preview | `apps/studio/server/fuma/aiPaymentSetup/**`, `apps/studio/server/ai/tools/site/paymentSetup*.ts`, `/secure-payment`, hosted migration `000074_ai_payment_setup` |
| FUMA-071 | admin-host contribution registry and redacted console surface; domain services retain mutation authority | `src/operations.ts`, `/internal` |
| FUMA-072 | stepped-up expiring non-nested support and isolated dual-approver break glass; immutable moderation evidence | operations policy, migration 000015 |
| FUMA-073 | opted-in approved expert profiles, PII-free bounded ranking, moderation invalidation and encrypted inquiry storage | operations policy, migration 000015 |
| FUMA-074 | current paid-contract handoff authority, destination/quotas/legal revalidation, registered asset owners, `en-KE`/KES/Africa-Nairobi UX | operations policy, `/transfers` |
| FUMA-075 | Ghost 5 structured mapping, provenance/count/relation/media manifests, secret rejection, idempotent rollback receipt | `src/imports.ts`, Ghost fixture, migration 000016 |
| FUMA-076 | complete Lawyer inventory, custom excerpt quarantine, provider-verified payment reconciliation, staff/member reauth and OCI mail migration | import adapter, Lawyer fixture |
| FUMA-077 | owned Lawyer Next/Tailwind source components plus canonical templates/loops/tokens/assets/access/data adapters, with zero flattened copies | design manifest fixture/assertion |
| FUMA-078 | digest-required non-root ARM64 Studio/public-web/site-runtime images, GHCR workflow, SBOM/provenance and release template | `infra/.../docker`, workflow, release template |
| FUMA-079 | pinned Oracle k3s/Traefik inputs, exact-host tenant site-runtime routes with legacy fallback, no default tenant, restricted pods and digest workloads | `infra/.../oracle`, `infra/.../k3s` |
| FUMA-080 | suspended serialized migration, encrypted off-host backup, isolated restore verification and promotion evidence policy | `operations.yaml`, launch policy, backup runbook |
| FUMA-081 | tenant-safe telemetry including RSC/client navigation/cache/component versions, RED/USE/provider/Web Vitals alerts and measured scaling | launch policy, autoscaling/observability manifests |
| Tracker 86 | public-web deployment seam: same SHA/contract versions, private audience, canary cap, independent public rollback with product/tenant continuity | seam contract/config, routing, integration/fault tests |
| FUMA-082 | IDOR/scope/host/secret/import adversarial controls, subject export/delete plan with legal exceptions and incident process | security tests, migration 000017, security runbook |
| FUMA-083 | ARM64 static/cached-React/dynamic/member/application route performance/isolation budgets and complete cost model with ≤30% variable COGS and ≥70% customer gross margin | capacity config and policy/tests |
| FUMA-084 | fail-closed SQLite/Ghost/Lawyer pilot evidence, immutable grandfathered contract, OCI mail, parity/provider reconciliation and rollback | pilot checklist and policy |
| FUMA-085 | paired signed gate, objective abort, host/session/public/security/accessibility/provider/economics approvals, canary and rollback | launch gate, policy/tests/runbook |
| FUMA-SITE-001 | approved architecture, exact-host/cache/trust hostile gates and rollback contract | tenant-runtime ADR/reference and architecture fixtures |
| FUMA-SITE-002 | immutable runtime-tree/route/component/style artifact beside legacy HTML/CSS | TypeBox release schema, renderer adapter, dual-release faults |
| FUMA-SITE-003 | one exact-host multi-tenant Next App Router runtime | `apps/site-runtime`, private client, cache/link/ARM64 tests |
| FUMA-SITE-004 | first-party React/Tailwind registry with semantic parity | tree walker, token bridge, module/VC/loop fixtures |
| FUMA-SITE-005 | member/application state plus bounded legacy renderer compatibility | context/providers/API adapters, shadow/cutover/rollback tests |
| FUMA-SITE-006 | Lawyer source-component runtime pilot | source/dependency/route manifest, component packs, parity/cutover |
| FUMA-SITE-007 | TypeBox component-pack SDK and official/declarative/trusted/sandboxed trust tiers | manifests, lifecycle, hostile pack fixtures |
| FUMA-SITE-008 | component catalog/editor plus extensions to existing AI and MCP systems | install/usage/upgrade authority, agent/MCP tools and security tests |

## Hosted integration status

FUMA-063 through FUMA-071 and FUMA-SITE-008 are conductor-finalized in the existing Studio AI, MCP, artifact, payment, and platform-console architectures; FUMA-SITE-006 is conductor-finalized in the one exact-host tenant runtime. The latest canonical migration is `000075_component_catalog_authority`, centrally registered at `760f409e118eaffcd72323ffd2f70aaf008bbde3e732e3372afcaf8e64657f61`, with **75/75** hosted/runnable migrations and zero sentinels. FUMA-071 mounts 17 complete redacted console views and only bounded delegates to existing domain authorities. SITE-008 extends the one current native AI/MCP runtime with distinct component read/create-source/install/mutate/confirm/publish capabilities, immutable exact-version catalog evidence, and owner-only executable-source confirmation. SITE-006 preserves the complete Lawyer route/content/member/access estate through six owned source components, exact-host cutover, retained-release fallback, and rollback. FUMA-078's three-image native-ARM64 manifest/workflow/rejection policy is repository-complete, but the ticket remains formally open because no authorized protected publication, signing, scanning, or published-image runtime evidence was executed. FUMA-079 consequently remains blocked. The formal tracker is **20/40 closed, 20 open**.


## Security and authority invariants

1. All untrusted boundaries are strict TypeBox objects with `additionalProperties: false`; there is no Zod.
2. Tenant authority requires the full platform/organization/workspace/site/owner-key ancestry and, for mutable site resources, owner generation.
3. Catalog credentials, BYOK ciphertext references, payment secrets, MCP token material, inquiry bodies, support evidence, provider webhook bodies and raw PII never appear in public responses or telemetry.
4. Plugin review binds exact bytes and permissions. Submitters cannot approve themselves; revoked/unreviewed/unsigned packages cannot one-click install.
5. The existing AI agent can propose payment setup or reviewed component installation but cannot supply/read credentials, bypass review, or write/install until explicit actor confirmation. Existing MCP connectors expose the same catalog operations only through exact scoped capabilities, metering, audit, revocation and publish step-up.
6. Internal console host checks do not confer authority. Existing sessions, step-up, capability resolution, protected-owner policy, auditing and domain services remain central prerequisites.
7. Public expert publication is explicit and reversible. Opt-out or moderation immediately removes read/search/inquiry eligibility.
8. Launch defaults to abort. Template digests, false evidence booleans, empty approvals and pending checksums are intentionally non-promotable.

## Migration policy

`migrations/000013` through `000017` are phase-local additive PostgreSQL source artifacts, not hosted IDs. Because Publication owns hosted `000013`–`000020` and Commercial Edge reserves `000021`–`000034`, the central integrator must convert/register these sources as hosted `000035_ai_governance` through `000039_launch_evidence_privacy`, calculate immutable checksums, verify source order, and obtain authorization before execution. `pending-central-integration` is a blocker, not a runnable checksum. Every paired release must declare `000039_launch_evidence_privacy` as its governance high-water mark.

## UI policy

`apps/control-surfaces` is a bounded Next app with exact versions: Next 16.2.9, React 19.2.5, Tailwind 4.3.3, shadcn 4.14.1, and TypeBox 0.34.49. Its shadcn components and CSS are app-local. It creates no shared UI package and does not import or modify legacy Studio CSS. Production host policy is exact `app.fuma.co.ke` or `admin.fuma.co.ke`. The manifestless `apps/site-runtime` is an isolated Next app with app-local exact dependencies, strict private TypeBox authority, exact tenant/customer host routing, the closed first-party/private component registry, persistent member/application state, and bounded retained-release compatibility; production traffic cutover still waits on infrastructure, pilot, and launch gates. Blyss HTTPS remains mandatory for browser acceptance.

## Evidence status

The test files cover unit, integration, security, fault, architecture, and Playwright categories. `tooling/evidence.ts --dry-run` can inventory/hash source and assemble an explicitly unsigned, zero-evidence, non-promotable candidate from CI digest files; it cannot represent acceptance. `handoff/dry-run-plan.json` records every intended command with `executed: false`, and `handoff/requirement-matrix.json` records source completion plus exact central/external blockers. No evidence file was generated and no dry-run command was executed in this phase because running even dry-run validation/tooling was prohibited.
