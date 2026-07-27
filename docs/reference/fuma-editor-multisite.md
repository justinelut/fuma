# Fuma multi-site editor sessions

FUMA-027 binds hosted editor loading, saving, history, imports, profile surfaces, and HTTP persistence to one complete organization/workspace/site authority. Legacy self-host Studio remains separately bound to `/admin/api/cms` and server-owned `SELF_HOST_SITE_ID`; hosted code never treats that singleton as tenant authority.

## Implemented boundary

- `server/fuma/editor/` defines strict TypeBox contracts, an owner/generation-qualified bound repository, PostgreSQL storage, scoped GET/PUT route declarations, and trusted session authority. Bound operations accept no replacement tenant coordinates and reload exact active/null-transfer owner authority inside every transaction.
- Additive hosted migration `000010_editor_resources` stores JSONB editor resources under `(platform_id, owner_key, owner_generation, resource_kind, logical_id)`. Earlier hosted checksums remain unchanged.
- `server/fuma/context/postgresRequestAuthority.ts` derives the exact site authorization snapshot from Better Auth membership, workspace overrides, site/profile assignment, and owner-key platform authority. `server/index.ts` constructs this boundary only in hosted mode; `server/router.ts` owns `/api/fuma/**` before legacy CMS routing.
- `src/admin/fuma/editorSession/` validates a complete target, binds one canonical scoped HTTP adapter, and keeps document/history/dirty/import state per target and coordinator instance. Load/save/import tokens reject late or out-of-order completion after edits or switches.
- `src/admin/fuma/profileEditor/` resolves pages, design, settings, media, import, and publish surfaces from composed capabilities plus permission decisions. It has no Website/Publication branch.
- `FumaScopedShell` exposes a frozen ready-context renderer; `HostedStaffShell` mounts the profile editor only after exact context resolution. Switching changes the full target key.
- The existing self-host persistence interface is now honestly target-bound: `loadSite()` carries no ignored site ID, while `CmsAdapter` remains bound to `/admin/api/cms`.

## Isolation model

Browser target keys contain organization, workspace, site, and profile. Server resource keys additionally contain platform, stable owner key, owner generation, resource kind, and logical ID. FUMA-028 draft heads add the trusted profile dimension to that server scope. Therefore profiles with colliding workspace/site/page/component/layout IDs cannot share documents, histories, imports, saves, sequences, or physical rows.

Every hosted request follows:

```text
canonical scoped URL
  → hosted Better Auth session
  → exact PostgreSQL site authorization
  → FUMA-026 request and repository scope
  → trusted editor session authority
  → owner/generation-bound PostgreSQL editor repository
```

Caller authority in headers or JSON is rejected before handler invocation. Transfer state, owner generation drift, wrong ancestry, revoked permission, malformed input, and stale browser operations fail closed.

## Verification evidence

Final focused acceptance on 2026-07-25:

- **97 passed, 1 optional live-PostgreSQL skip, 0 failed, 522 assertions** across repository, PostgreSQL storage/migration, live request/session authority, scoped routes/router, target-bound HTTP, session/history/import isolation, profile surfaces, shell mounting, migration immutability, and hostile architecture tests;
- public-host Playwright through `https://5174.blyss.co.ke` and `https://3002.blyss.co.ke`: **1 passed**, proving two tabs with colliding Website/Publication IDs independently edit, undo, import, save, reload, switch, and reject delayed stale loads;
- root build passed shared-package typechecks, Studio `tsc -b`, and Vite with **2,052 modules transformed**;
- root lint and `git diff --check` passed;
- architecture catalog contains **107** gates including `fuma-editor-multisite.test.ts`.

The optional live PostgreSQL transition suite remained environment-gated. Deterministic PostgreSQL recording tests verify exact SQL and transaction behavior; this task does not claim a deployed hosted production environment, hosted media/plugin/publication implementation, or FUMA-028 concurrent draft sequencing.

## Related

- [FUMA runtime boundary scoping](fuma-runtime-boundary-scoping.md)
- [FUMA repository scoping](fuma-repository-scoping.md)
- [Website parity](fuma-website-parity.md)
- Gate: `apps/studio/src/__tests__/architecture/fuma-editor-multisite.test.ts`
- Browser acceptance: `apps/studio/tests/e2e/fuma-editor-multisite.e2e.ts`
