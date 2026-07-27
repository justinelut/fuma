# Fuma public Web scaffold

FUMA-WEB-005 establishes `apps/web` as the independent public Next.js application. It is presentation-only at this stage: FUMA-WEB-006 owns public projections and the BFF, while FUMA-WEB-007 owns the production acquisition shell and pages.

## Implemented boundary

- Next.js **16.2.9**, React/React DOM **19.2.5**, App Router, strict TypeScript, React Compiler, MDX compilation, and `output: 'standalone'` are exact-pinned in `apps/web`.
- Tailwind CSS and `@tailwindcss/postcss` are exact-pinned at **4.3.3**. `components.json`, semantic variables, `lib/utils.ts`, and reviewed `Button`/`Card` shadcn source are app-local.
- `packages/design-tokens` remains framework-neutral. `scripts/sync-design-token-css.ts` deterministically writes the committed `styles/generated/fuma-design-tokens.css`; build and tests fail on byte drift.
- Web consumes only the `@fuma/brand` and `@fuma/design-tokens` leaf barrels. It does not import Studio, Zod, platform authority, or `@fuma/public-contracts` before WEB-006.
- Root `bun.lock` remains the only install authority. Root commands retain Studio defaults and add explicit Web lifecycle commands; aggregate build/lint cover both apps.
- `infra/docker/web.Dockerfile` builds from the root frozen lock and runs the traced standalone server as UID 1001 in a Node 22 ARM64-compatible runtime. The legacy root Dockerfile remains Studio-only.

## Browser and route surface

WEB-005 exposes only `/` and the Next not-found surface. There are no `app/api` routes, auth/session behavior, public projections, prices, platform calls, or tenant fallback. Local development listens on port 3002; all browser acceptance uses `https://3002.blyss.co.ke` per `AGENTS.md`/`CLAUDE.md`.

## Verification evidence

Primary acceptance on 2026-07-25:

- focused WEB-005/workspace/shared-package/self-host/Docker gates: **168 passed, 0 failed, 381 assertions**;
- Web token tests: **2 passed, 0 failed**; strict Web typecheck passed;
- root build passed all three shared package typechecks, unchanged Studio TypeScript/Vite (**2,052 modules**), and Next standalone build;
- root lint and `git diff --check` passed;
- repository-wide suite: **7,131 passed, 8 environment skips, 25 historical unrelated failures, 145,994 assertions across 7,164 tests**; no WEB-005 test failed;
- architecture catalog contains **108** gates, including the new public Web scaffold gate;
- public-host Playwright at `https://3002.blyss.co.ke`: **1 passed**, covering hydration without console/page errors, semantic shell, generated styling, skip link, and custom 404;
- frozen install preserved the root lock byte-for-byte and no app lock exists;
- native ARM64 Docker build passed on an `aarch64` host; the resulting `arm64` image ran as user `web`, runtime UID **1001**, and repeated the public-host Playwright acceptance with **1 passed**.

## Enforcement

- `apps/studio/src/__tests__/architecture/fuma-public-web-scaffold.test.ts`
- `apps/web/tests/generated-design-tokens.test.ts`
- `apps/web/e2e/public-web-hydration.e2e.ts`
- `apps/studio/src/__tests__/architecture/fuma-shared-packages.test.ts`
- `apps/studio/src/__tests__/architecture/fuma-workspace-public-web-architecture.test.ts`
