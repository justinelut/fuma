# Fuma Test Fixtures

This reference covers the deterministic Fuma tenant/profile factories, fake clock, provider servers, and database fixture boundaries used by tests.

FUMA-002 is reusable test scaffolding under `src/__tests__/helpers/fuma/`. It does not provide production tenancy, profile registries, hosted schema, runtime routes, configuration, or process roles.

---

## TL;DR

- `src/__tests__/helpers/fuma/fixtures.ts` creates deterministic users, organizations, colliding workspaces/sites/resources, and Website/Publication test profiles from an explicit seed.
- `src/__tests__/helpers/fuma/fakeClock.ts` is an injected monotonic clock; it never patches global `Date`.
- `src/__tests__/helpers/fuma/fakeProviders.ts` starts independent Bun servers for OCI Email, platform Paystack, customer Paystack, and Cloudflare on ephemeral `127.0.0.1` ports.
- `src/__tests__/helpers/fuma/postgresTenantHarness.ts` creates and drops ephemeral test-only PostgreSQL schemas. It rejects SQLite and secret-shaped fixture values before SQL runs.
- `src/__tests__/helpers/fuma/legacySqliteTransitionSource.ts` creates a branded transition-input fixture from the inherited SQLite migration stream. It is not hosted acceptance.
- `tests/e2e/helpers/fuma.ts` re-exports only pure fixture factories and types; it does not pull Bun server code into Playwright.

## Pure tenant and profile fixtures

The source of truth is `src/__tests__/helpers/fuma/fixtures.ts`:

```ts
const matrix = createFumaTwoTenantMatrix('explicit-test-seed')
const ids = stableFumaFixtureIds(matrix)
```

The matrix always contains two organizations. Each organization owns one workspace plus one Website site and one Publication site. Capability fixtures include explicit grants and revocations. Workspace IDs collide between organizations, Website and Publication site IDs collide with their counterpart in the other organization, and one resource ID collides across all four sites. Only the complete `organizationId/workspaceId/siteId/resourceId` address is unique.

`fumaFixtureId(seed, kind, label)` reads no clock, UUID generator, random source, environment variable, or database sequence. Product fixture IDs remain stable even though PostgreSQL schema names and SQLite temp paths are ephemeral.

`formatStableFumaFixtureIds(matrix)` is the demo-safe renderer. Its output is a JSON array of fixture IDs only; it contains no labels, email addresses, schema names, URLs, paths, request data, or credentials.

## Fake clock

`FumaFakeClock` in `src/__tests__/helpers/fuma/fakeClock.ts` accepts an explicit initial instant within JavaScript's valid `Date` range. `set()` and `advance()` reject backward, non-finite, or unrepresentable movement before changing state. `reset()` starts a new deterministic run at the constructor instant. Consumers inject the clock directly; global `Date` remains unchanged.

## Provider servers

`startFumaFakeProviderSuite()` in `src/__tests__/helpers/fuma/fakeProviders.ts` starts four independent local servers:

| Fixture | ID |
|---|---|
| OCI Email Delivery | `oci-email` |
| Fuma platform billing | `platform-paystack` |
| Customer merchant payments | `customer-paystack` |
| Fuma-owned edge control | `cloudflare` |

Routes have explicit method, path, status, response, and deterministic elapsed time. The suite validates every provider's complete route set before binding its first server, so invalid configuration cannot orphan a partially constructed instance. Servers bind only to `127.0.0.1` with port `0`; tests make no external provider calls.

Captured requests retain method, path, status, start/completion/duration timing, body length, SHA-256 body hash, and redacted headers. Raw bodies are discarded after hashing. Authorization, cookie, API-key, auth-key, access-key, token, secret, credential, and signature header values become `[REDACTED]`. `reset()` clears captures and resets time; `close()` is idempotent.

## Database boundaries

### PostgreSQL hosted-test harness

`createPostgresTenantFixtureHarness(db, label)` in `src/__tests__/helpers/fuma/postgresTenantHarness.ts` requires `db.dialect === 'postgres'`. Provisioning validates the complete matrix and rejects secret-shaped keys/values before creating an ephemeral `fuma_fixture_*` schema. The schema contains test tables only and is not a hosted migration or production schema.

`verifyIsolation()` compares every persisted full scope with the source matrix. `cleanup()` drops the schema with `CASCADE` and is idempotent. `cleanupIsComplete()` verifies the exact ephemeral schema is absent.

The live test in `src/__tests__/fuma/postgresTenantHarness.test.ts` runs only when `FUMA_TEST_POSTGRES_URL` is present:

```sh
FUMA_TEST_POSTGRES_URL=postgres://... bun test src/__tests__/fuma/postgresTenantHarness.test.ts
```

### Legacy SQLite transition source

`createLegacySqliteTransitionSource(seed)` in `src/__tests__/helpers/fuma/legacySqliteTransitionSource.ts` applies the complete inherited `server/db/migrations-sqlite.ts` stream in a temp directory and seeds a site, owner, page, published post, and version with stable IDs. `acceptLegacySqliteTransitionSource()` is the explicit transition-test boundary. The PostgreSQL harness rejects its `DbClient`.

FUMA-006 consumes this branded source through `exportLegacySqlite` and `importLegacySqliteToPostgres`. The focused demo in `src/__tests__/fuma/hostedMigrationsTransition.test.ts` proves deterministic counts/hashes, preserved IDs and auth/content links, PostgreSQL foreign-key validation, safe duplicate resume, and hosted SQLite refusal. `server/db/migrations-pg.ts` and `server/db/migrations-sqlite.ts` remain unchanged, and no hosted SQLite acceptance exists.

## Forbidden patterns

- Random UUIDs, current timestamps, environment-derived values, or database sequences in stable fixture IDs.
- Importing `fakeProviders.ts`, `postgresTenantHarness.ts`, or `legacySqliteTransitionSource.ts` from Playwright helpers.
- Raw request-body capture or retention of authorization, cookie, API-key, auth-key, access-key, token, secret, credential, or signature header values.
- Binding fake providers to non-loopback interfaces or contacting external providers.
- Accepting SQLite in the hosted PostgreSQL harness.
- Adding test tables to historical migrations or presenting ephemeral fixture schemas as hosted schema.
- Logging schema names, database URLs, temp paths, request data, or credentials in fixture demos.

## Related

- `docs/reference/fuma-platform-architecture.md` — Fuma hierarchy, PostgreSQL-only hosted acceptance, and task ownership boundaries.
- `docs/reference/database-dialects.md` — current self-hosted adapter rules and inherited migration behavior.
- Pure fixture source: `src/__tests__/helpers/fuma/fixtures.ts`
- Bun fixture source: `src/__tests__/helpers/fuma/`
- Playwright exports: `tests/e2e/helpers/fuma.ts`
- Unit and live gates: `src/__tests__/fuma/`
- Architecture gate: `src/__tests__/architecture/fuma-platform-architecture.test.ts`
