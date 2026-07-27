# Fuma isolated orchestrator worktrees

Status date: 2026-07-27

Integration branch: `integration/fuma-batch-7-20260727`; FUMA-057 worker commit `e21ce3764073051d0a2b7a611543cd5a1adc7378` is integrated as `3bd3060de990dd2242986562bcf6b7f341d9837f`, with conductor-owned migration/API/worker/publication/UI finalization recorded below. The worker ref is pushed only to private `fuma/orchestrator/07-quotas-fuma057`; final integration is pushed only to private `justinelut/fuma`.

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
| 04 | `/home/ubuntu/worktrees/fuma-orch-04` | `orchestrator/04-deliverability` | **Closed:** FUMA-047 integrated as `9d19430e`; validated worker commit `e94580b1` is pushed to `fuma`. Migration `000054` is conductor-finalized at checksum `b08f316eb43349a1b3cc281a12fdf1eba90262d49bd504b959b6954e3a548c1a`. |
| 05 | `/home/ubuntu/worktrees/fuma-orch-05` | `orchestrator/05-edge-delivery` | **Closed:** FUMA-051 integrated as `456fd948`; validated worker commit `fac826e6` is pushed to `fuma`. No migration was required. |
| 06 | `/home/ubuntu/worktrees/fuma-orch-06` | `orchestrator/06-metering` | **Closed:** FUMA-052 worker commit `f742d1f0` is pushed to `fuma` and integrated as `0b50f418`; migration `000055` is conductor-finalized at checksum `e5462ac7ea62f35fce1925fffc51894a2964ec61a5cec08d33c7f35d372f18b7`. |
| 07 | `/home/ubuntu/worktrees/fuma-orch-07` | `orchestrator/07-quotas-fuma057` | **Closed:** FUMA-057 worker commit `e21ce376` is pushed to `fuma` and integrated as `3bd3060d`; migration `000060_quota_self_service` is conductor-finalized at checksum `af8a6667a5a2bc2275e2c48f07679a8547193c0a1d9bacf5f1424be523c429e7`. Prior FUMA-056 worker `b45bdca3` remains integrated as `b08d542c` with finalized migration `000059`; FUMA-055 worker `d963de8d` remains integrated as `33240b7f` with finalized migration `000058`; FUMA-054 worker `53204bda` remains integrated as `7e9b8a2a` with finalized migration `000057`. |
| 08 | `/home/ubuntu/worktrees/fuma-orch-08` | `orchestrator/08-public-authority` | **Closed:** FUMA-WEB-010 worker commit `0e9bec2d` is pushed to `fuma` and integrated as `a17c7151`; migration `000056` is conductor-finalized at checksum `ca89eeadaf781bd806217a5b74d58849c851372a8c838806d4953641c259789e`. |
| 09 | `/home/ubuntu/worktrees/fuma-orch-09` | `orchestrator/09-domains` | **Ready:** FUMA-059 is dependency-ready after FUMA-057; later FUMA-060..062 remain dependency ordered. |
| 10 | `/home/ubuntu/worktrees/fuma-orch-10` | `orchestrator/10-governance-launch` | **Implementation integrated, tracker open:** FUMA-WEB-014 worker commit `1c56e998` is pushed to `fuma` and integrated as `ee4f44a6`; independent legal/privacy approval, production status authority, and cross-replica contact-delivery evidence remain external/authority blockers. |

## Agent release rule

After FUMA-057 closure, exactly four complete, independent, dependency-ready implementation assignments exist: FUMA-058, FUMA-059, FUMA-063, and FUMA-WEB-009. Their prerequisite rows in `docs/plans/fuma-execution-backlog.md` are all closed. The next authorized wave must therefore start exactly four parallel no-dependency stages, one complete ticket per stage: route heavy FUMA-058, FUMA-059, and FUMA-063 backend/data/migration work to `claude-opus-5`, and public-Web pricing FUMA-WEB-009 to `gpt-5.6-sol`. FUMA-078 remains unauthorized for protected image publication/signing/scanning, and FUMA-076 remains blocked on FUMA-058. Recompute dependencies again after that wave closes.
