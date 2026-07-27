# Fuma isolated orchestrator worktrees

Status date: 2026-07-27

Base checkpoint: `integration/fuma-batch-7-20260727` at `be94761596c8b533587a172bbd0b0df5b454a0ee` in private `justinelut/fuma`.

## Conductor-owned integration surface

Worker branches must not edit these files unless the conductor gives that branch exclusive ownership in writing:

- `apps/studio/server/fuma/db/migrations/index.ts` and finalized migration checksums
- central composition, runtime, route, and worker registries
- `apps/studio/server/index.ts` and `apps/studio/server/router.ts`
- root `package.json`, `bun.lock`, workspace/config orchestration, and remote configuration
- `docs/plans/fuma-execution-backlog.md`
- `docs/handoffs/fuma-tracker-closure-audit.md`
- aggregate validation logs, tracker state, closure decisions, and release manifests

Workers may add ticket-local contracts, repositories, services, routes, adapters, UI, CSS Modules/app-local primitives, focused tests, architecture gates, demos, reference docs, and an unregistered candidate migration only when the ticket requires one. The conductor assigns/finalizes migration IDs, composes central seams, runs live PostgreSQL, resolves conflicts, executes aggregate validation, updates audit/tracker state, and pushes integration branches.

All work remains TypeBox-only with no app-to-app imports, no shared UI package, one root lock plus the approved vendor exception, Studio CSS Modules/app-local primitives, and Blyss HTTPS-only browser acceptance. Docker, buildx, QEMU, emulation, protected publication, signing, scans, deployment, and production/external operations remain unauthorized.

## Worktree and branch registry

| Orchestrator | Path | Branch | Ownership/readiness |
|---|---|---|---|
| 01 | `/home/ubuntu/worktrees/fuma-orch-01` | `orchestrator/01-email-preview` | **Closed:** FUMA-045 integrated as `08aef557`; validated worker commit `623a2a1b` is pushed to `fuma`. No migration was required. |
| 02 | `/home/ubuntu/worktrees/fuma-orch-02` | `orchestrator/02-ghost-import` | **Closed:** FUMA-075 integrated as `6c3008fe`; validated worker commit `017a0965` is pushed to `fuma`. Existing finalized migration `000038` was reused; no migration was added. |
| 03 | `/home/ubuntu/worktrees/fuma-orch-03` | `orchestrator/03-email-campaigns` | **Closed:** FUMA-046 integrated as `bd36d5c8`; validated worker commit `134c76d6` is pushed to `fuma`. Migration `000053` is conductor-finalized. |
| 04 | `/home/ubuntu/worktrees/fuma-orch-04` | `orchestrator/04-deliverability` | **Ready:** FUMA-047 suppression, unsubscribe, provider events, sender/domain health, and privacy-aware engagement/deliverability. Candidate migration ID `000054` is reserved only for a demonstrated additive gap. |
| 05 | `/home/ubuntu/worktrees/fuma-orch-05` | `orchestrator/05-edge-delivery` | Reserved for FUMA-051 only after FUMA-047 closes. |
| 06 | `/home/ubuntu/worktrees/fuma-orch-06` | `orchestrator/06-metering` | Reserved for FUMA-052 only after FUMA-051 closes. |
| 07 | `/home/ubuntu/worktrees/fuma-orch-07` | `orchestrator/07-entitlements` | Reserved for FUMA-054 and its commercial successors after FUMA-052 closes, one dependency wave at a time. |
| 08 | `/home/ubuntu/worktrees/fuma-orch-08` | `orchestrator/08-public-authority` | Reserved for FUMA-WEB-009/010 authority-backed public work after their server dependencies close. |
| 09 | `/home/ubuntu/worktrees/fuma-orch-09` | `orchestrator/09-domains` | Reserved for FUMA-059..062 after FUMA-057 and prerequisite edge/metering work close. |
| 10 | `/home/ubuntu/worktrees/fuma-orch-10` | `orchestrator/10-governance-launch` | Reserved for dependency-ready AI/plugin/operations/public launch work; no external launch operation is authorized. |

## Agent release rule

FUMA-047 is the only dependency-ready ticket after FUMA-075 closure. FUMA-076 remains blocked on open FUMA-058 even though its FUMA-075 dependency is now complete. One ready ticket is fewer than the four independent complete tickets required by the repository's exactly-four-agent delegation policy, so no subagent invocation is authorized for this wave. Worktrees 02 and 05–10 remain intentionally idle rather than populated with invented or dependency-blocked work. Recompute dependencies after each conductor closure; start an agent invocation only when exactly four non-overlapping complete-ticket/phase assignments are ready, with all four stages parallel and pinned to `gpt-5.6-sol`.
