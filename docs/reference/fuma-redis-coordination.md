# Fuma Redis coordination

FUMA-007 provides pooled, bounded **ephemeral coordination** under `apps/studio/server/fuma/redis/`. PostgreSQL remains authoritative. Redis loss, timeout, restart, cache content, presence, pub/sub delivery, counters, and lease ownership are never evidence that a durable business transition happened.

---

## TL;DR

- `FumaRedisCoordination` provides bounded cache, pub/sub, presence, admission-limit, and fenced-lease operations under one deployment namespace.
- Cache, pub/sub, and presence fail open only to their durable source of truth; admission and leases fail closed.
- FUMA-026's `createFumaScopedKeyFactory` creates active tenant-aware logical cache/pub-sub/lock keys before `FumaRedisKeyspace` applies deployment namespacing.
- The scoped key factory is implemented and tested but is not mounted by a central hosted runtime consumer.

## Public boundary

`apps/studio/server/fuma/redis/index.ts` exports:

- `FumaRedisCoordination` — namespacing, limits, operation deadlines, health tracking, and failure policy;
- `BunRedisDriver` — dependency-free production adapter using Bun's native `RedisClient`;
- `FumaRedisDriver` — contract implemented by the production driver and deterministic fake;
- cache, fixed-window limit, pub/sub, presence, and fenced-lease contracts;
- `decideFumaRedisAvailability` and `FUMA_REDIS_FAILURE_POLICY` for readiness/admission decisions.

A coordination instance receives a deployment namespace. Physical keys use `fuma:v1:<namespace>:<capability>:<base64url-key>`. Equal logical keys in different namespaces cannot collide. FUMA-026 implements tenant-aware logical keys through `createFumaScopedKeyFactory` in `apps/studio/server/fuma/runtime/scopedKeys.ts`: it binds frozen active request/site-job context, repository scope, profile, granted capability, owner generation, and explicit key version before callers pass the opaque result to `FumaRedisKeyspace`. The Redis module deliberately does not infer organization, workspace, or site scope, and no central runtime cache/pub-sub/lease consumer mounts the FUMA-026 factory yet.

Inputs are bounded before I/O: logical keys, cache values, pub/sub messages, presence payloads, limits, costs, TTLs, and operation deadlines all have finite maxima. Compound limit, presence, and lease operations are atomic Redis scripts. The command and subscriber connections are separate.

## Failure and health policy

Every call has a deadline. `health()` starts unavailable, becomes healthy after a successful operation/probe, and becomes unavailable after a timeout or driver error. `probe()` performs a bounded PING. Runtime composition roots are not changed by FUMA-007; their later integrator can project `health().ready` into role readiness.

| Capability | Redis unavailable or ambiguous timeout | Reason |
|---|---|---|
| Cache read/write/delete | Fail open as miss/unsaved (`null`/`false`) | Callers rebuild from PostgreSQL or another durable source. |
| Pub/sub | Fail open as undelivered (`0`/no-op subscription) | Durable consumers reconcile from their PostgreSQL ledger; delivery is not an acknowledgement. |
| Presence | Fail open as absent (`false`/empty list) | Presence is advisory and expires by TTL. |
| Limits/admission | **Fail closed** with `FumaRedisUnavailableError` | An unavailable counter cannot prove capacity. |
| Leases/fencing | **Fail closed** with `FumaRedisUnavailableError` | An unavailable lease cannot authorize mutating work. |

Fail-open here means the containing request may continue only through its durable source of truth. It never means accepting Redis data as a durable commit.

## Fenced leases

Acquisition requires caller-owned `ownerId` and stable `acquisitionId`. Repeating an ambiguous acquisition with the same IDs returns the same token and refreshes the short lease; a contender receives `null`. Tokens increase per namespaced resource and the fence counter is not deleted when a lease is released or expires. Renew and release compare owner, acquisition, and token atomically, so a stale holder cannot affect a successor.

A token only becomes authoritative when the PostgreSQL mutation stores/compares it in the same durable transaction owned by the consuming feature (durable jobs arrive in FUMA-009). If Redis data is restored without its fence counter, PostgreSQL must reject any token that is not newer than the resource's durable fence. This can reduce availability after Redis data loss, but it cannot make stale work durable.

## Reconnect behavior

`BunRedisDriver` enables bounded native reconnect attempts with the offline command queue disabled, preventing commands from executing long after their caller timed out. `reconnect()` replaces both clients and explicitly re-subscribes every registered listener. Existing listeners therefore survive an intentional client restart; messages emitted while Redis or the subscriber is unavailable are intentionally lost and must be reconciled from durable state.

## Contract tests

`apps/studio/src/__tests__/fuma/redisCoordination.test.ts` always runs against `DeterministicRedisServer`. Its injected clock makes cache, limit, presence, and lease expiry deterministic. It covers concurrent contention, namespace isolation, reconnect/resubscribe, payload bounds, ambiguous timeouts, health decisions, and erased ephemeral state without a durable-state mutation.

Run the narrow suite:

```sh
bun test src/__tests__/fuma/redisCoordination.test.ts
```

The same production API has opt-in real Redis coverage. The test uses a random namespace and does not flush a shared database:

```sh
FUMA_TEST_REDIS_URL=redis://127.0.0.1:6379/15 \
  bun test src/__tests__/fuma/redisCoordination.test.ts
```

The real contract covers server expiry, atomic contention, namespace isolation, fenced succession, and command/subscriber client restart with resubscription. It does not issue Redis `SHUTDOWN` or `FLUSH*`; destructive service lifecycle testing belongs in an isolated infrastructure harness.

## Related

- `docs/reference/fuma-runtime-boundary-scoping.md` — active tenant-aware cache, pub/sub, and lock key construction.
- `docs/reference/fuma-durable-jobs.md` — PostgreSQL-authoritative job claims and Redis readiness coordination.
- Source-of-truth files: `apps/studio/server/fuma/redis/`, `apps/studio/server/fuma/runtime/scopedKeys.ts`
- Focused tests: `apps/studio/src/__tests__/fuma/redisCoordination.test.ts`, `apps/studio/src/__tests__/fuma/scopedKeys.test.ts`
- Gate test: `apps/studio/src/__tests__/architecture/fuma-runtime-boundary-scoping.test.ts`
