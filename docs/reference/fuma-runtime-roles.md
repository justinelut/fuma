# Fuma Runtime Roles

FUMA-005 composes the hosted runtime as one Bun modular monolith with three independently started, pooled process roles. It does not change the self-hosted `server/index.ts` boot path.

## Role roots and ownership

| Role | Composition root | Owned runtime component | Default control port |
|---|---|---|---|
| `web` | `server/fuma/runtime/web.ts` | `web-runtime` | `3101` |
| `worker` | `server/fuma/runtime/worker.ts` | `worker-runtime` | `3102` |
| `scheduler` | `server/fuma/runtime/scheduler.ts` | `scheduler-runtime` | `3103` |

Each root imports only neutral modules under `server/fuma/runtime/`; no role root imports another role root. The component names are ownership boundaries. FUMA-009 supplies durable worker/scheduler component factories under `server/fuma/jobs/`; those factories implement this lifecycle contract without importing sibling roots. Redis, MinIO, hosted migrations, auth, and provider adapters remain outside the FUMA-005 core.

All roles use `readFumaConfig` and require `FUMA_ROLE` to match the invoked root. `FUMA_HEALTH_PORT` overrides the control port (`0` is allowed only for local ephemeral-port tests). `FUMA_DRAIN_TIMEOUT_MS` defaults to 30 seconds and accepts 1–300000 milliseconds.

## Health and readiness

Every role exposes:

- `GET /healthz` — liveness and role identity;
- `GET /readyz` — `200` only while the lifecycle state is `ready`, otherwise `503`.

The JSON response identifies `service: "fuma"`, `topology: "pooled"`, the role, lifecycle state, owned component IDs, and in-flight count. This makes web, worker, and scheduler health output operationally distinct without exposing configuration or provider secrets.

## Graceful shutdown

`SIGINT` and `SIGTERM` follow one neutral lifecycle:

1. transition from `ready` to `draining`, rejecting newly submitted work;
2. call each component's `beginDrain` hook in reverse startup order;
3. wait for tracked in-flight promises;
4. stop components in reverse startup order;
5. emit the final `stopped` event and exit cleanly.

Duplicate component IDs are rejected before startup. A bounded drain prevents a permanently stuck operation from keeping a process alive forever; timeout or component shutdown errors produce a non-zero exit.

## Local demo

Start the three roles in separate terminals:

```sh
bun run fuma:web
bun run fuma:worker
bun run fuma:scheduler
```

Inspect their distinct output:

```sh
curl http://127.0.0.1:3101/healthz
curl http://127.0.0.1:3102/healthz
curl http://127.0.0.1:3103/healthz
```

Send `Ctrl+C` in each terminal. The structured stderr sequence ends with `draining` and then `stopped`. The focused lifecycle test additionally sends a real `SIGTERM` while work is in flight and proves the work finishes before component and process shutdown.

## Verification

```sh
bun test src/__tests__/fuma/runtimeRoles.test.ts
```

No global build, lint, architecture suite, Playwright suite, database, Redis, or object-storage service is required for this task.
