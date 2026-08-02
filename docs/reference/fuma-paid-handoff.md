# FUMA-074 paid site handoff

Status: **implementation-complete; ticket-scoped validation evidence is recorded below**.

FUMA-074 converts the existing FUMA-056 `paid-transfer-pending` outbox command into one FUMA-023 site-transfer saga. It does not create another identity system, payment flow, onboarding flow, admin application, or transfer engine. `createHostedPaidHandoffTransferService(...)` composes the canonical `TransferService` with `PostgresTransferRepository`, the launch registry, the complete injected step registry, server-owned manifest and eligibility authorities, the durable job enqueue port, and the append-only audit port. `createHostedPaidHandoffRuntime(...)` adds current paid-contract readiness, fresh Better Auth mutation checks, six registered asset-choice owners, notifications, managed-owner/quota completion, recovery, and refund-review escalation.

## Authority and invariants

- Every read reconstructs the accepted private offer and current paid contract from PostgreSQL, then re-resolves source/destination identity and current destination, quota, policy/legal, and metering decisions. Browser values are never authority.
- The exact destination organization, workspace, and site must equal the current accepted offer. Outbox transitions also prove the supplied transfer proposal has the paid contract’s exact site and destination.
- Every mutation re-resolves one fresh, direct Better Auth staff session matching the frozen request actor. Impersonated, stale, future, missing, or substituted sessions fail before a command delegate runs.
- Domain (`FUMA-062`), AI/BYOK (`FUMA-064`), MCP (`FUMA-066`), plugins (`FUMA-067`), customer payment credentials (`FUMA-069`), and collaborators (`FUMA-023`) each have exactly one registered choice owner. Recording is transfer-ID idempotent in the owning authority.
- The platform internal grant is not a selection, manifest resource, effect, receipt, completion input, or refund input. Every readiness/dashboard/completion contract carries `internalGrantExcluded: true`.
- Money and timestamps are fixed to KES, `en-KE`, and `Africa/Nairobi`. Exact minor units remain integers; formatting is presentation-only.

## Lifecycle and replay

1. `GET .../paid-handoffs/:commandId` returns current readiness plus canonical saga confirmations, progress, fence, failure, step states, managed ownership, and customer quota application.
2. `prepare` records all six owner choices, revalidates current authority, proposes through `TransferService`, and sends a deduplicated confirmation request.
3. Source and destination confirm independently through the existing dual-confirmation state machine. The browser supplies only side, transfer identity, and expected version.
4. `start` enqueues the canonical resumable saga, sends/audits deterministic start evidence, then marks the FUMA-056 command delivered. Replay through `reconcile` repairs a crash between any of those boundaries.
5. A compensated failure moves the outbox to `failed`, preserves verified payment, keeps managed ownership with the source, exposes the current fence, and sends one deterministic failure notification.
6. `recover` requests canonical resume and moves `failed` back to `pending`. Completion replays the idempotent customer-quota/managed-owner completion even when command delivery was already durable, then converges the outbox to `delivered` and sends the completed notification.
7. Admin reconciliation never bypasses saga state. Refund escalation records idempotent human review only; it does not mutate settlement or issue a refund.

## Scoped routes and Studio UX

The existing hosted Fuma boundary accepts `paidHandoffRoutes`; FUMA-074 declares only:

```text
GET  /transfers/paid-handoffs/:commandId
POST /transfers/paid-handoffs/:commandId/prepare
POST /transfers/paid-handoffs/:commandId/confirm
POST /transfers/paid-handoffs/:commandId/start
POST /transfers/paid-handoffs/:commandId/recover
POST /transfers/paid-handoffs/:commandId/reconcile
POST /transfers/paid-handoffs/:commandId/refund-escalations
```

All request/response boundaries are strict TypeBox and `private, no-store`. Mutations require `site.settings.write`; the admin command delegate separately requires fresh admin authority for reconcile/refund escalation.

`apps/studio/src/admin/fuma/paidHandoff/` is Studio-local React with CSS Modules. It displays the managed site, accepted offer/version, verified payment state, exact destination, localized setup/recurring amounts, six asset owners/selections, dual confirmations, progress/steps, compensated failure, recovery, managed ownership, customer quota, reconcile, and refund review. It imports neither another app nor a shared application UI package, and uses no Tailwind or Zod.

## PostgreSQL and browser acceptance

The optional native test creates and removes a disposable PostgreSQL schema. It proves strict paid-contract readiness, exact destination, eight-way concurrent command delivery convergence, mutated transfer-ID denial, eight-way recovery convergence, internal-grant exclusion, and zero leftover schema. It runs only when `FUMA_TEST_POSTGRES_URL` is present and never uses SQLite.

The focused Playwright harness is built by the Studio Vite preview and accepted only through `https://5174.blyss.co.ke`. It demonstrates managed-site/offer/payment review, all six selections, source/destination confirmation, start, compensated failure, payment-preserving reconcile and refund escalation, fenced recovery, completion, applied-once quota, source ownership removal, exact same-origin request paths, authority-free request bodies, 320 px layout, and zero page/console errors.

Final ticket-scoped evidence on native `aarch64`:

- Focused service/application/UI/console/architecture/migration/native PostgreSQL: **24 passed, 0 failed, 175 assertions across 8 files**. PostgreSQL reported `contention=8 delivery=converged recovery=converged exactTransfer=true exactDestination=true internalGrantExcluded=true currency=KES locale=en-KE timezone=Africa/Nairobi`.
- Studio application TypeScript, the complete Playwright TypeScript project, ticket-scoped ESLint, preview build, and `git diff --check`: passed.
- Approved-host Chromium through `https://5174.blyss.co.ke`: **1 passed**, covering the complete lifecycle above with 320 px no-overflow and zero browser errors.
- Exact-root TypeScript over all eight FUMA-074 server files passed. The project-wide Studio server TypeScript command is blocked only by concurrent `aiCapabilityDashboard` and `nextSource` diagnostics; it reports no FUMA-074 file diagnostic. Those unrelated primary files were not edited by this ticket.

## Focused commands

```sh
FUMA_TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres \
  bun test \
  apps/studio/src/__tests__/fuma/paidHandoff.test.ts \
  apps/studio/src/__tests__/fuma/paidHandoffApplication.test.ts \
  apps/studio/src/__tests__/fuma/paidHandoffPostgresAcceptance.test.ts \
  apps/studio/src/__tests__/admin/fumaPaidHandoff.test.tsx \
  apps/studio/src/__tests__/architecture/fuma-paid-handoff.test.ts \
  apps/studio/src/__tests__/fuma/platformConsole.test.ts \
  apps/studio/src/__tests__/architecture/fuma-support-operations.test.ts \
  apps/studio/src/__tests__/architecture/postgresql-migrations.test.ts

bunx eslint apps/studio/server/fuma/transfers/paidHandoff*.ts \
  'apps/studio/src/admin/fuma/paidHandoff/**/*.{ts,tsx}' \
  apps/studio/src/__tests__/fuma/paidHandoff*.test.ts \
  apps/studio/src/__tests__/admin/fumaPaidHandoff.test.tsx \
  apps/studio/src/__tests__/architecture/fuma-paid-handoff.test.ts \
  apps/studio/tests/e2e/fixtures/fumaPaidHandoffHarness.tsx \
  apps/studio/tests/e2e/fuma-paid-handoff.e2e.ts --max-warnings=0

bunx tsc -p apps/studio/tsconfig.node.json --noEmit
bunx tsc -p apps/studio/tsconfig.app.json --noEmit
bunx tsc -p apps/studio/tests/e2e/tsconfig.json --noEmit

E2E_PREVIEW_BUILD=1 bun run scripts/vite.ts build
E2E_ADMIN_BASE_URL=https://5174.blyss.co.ke \
E2E_PUBLIC_BASE_URL=https://3002.blyss.co.ke \
E2E_VITE_MODE=preview E2E_REUSE_SERVER=1 \
bunx playwright test tests/e2e/fuma-paid-handoff.e2e.ts --project=e2e --no-deps
```

FUMA-074 does not add, reorder, or edit a hosted migration. It uses accepted FUMA-008 transfer, FUMA-026/028/057/059 commercial, and FUMA-037 governance authorities. Candidate `000078_next_source_portability_authority` and later ticket-owned migrations remain untouched.
