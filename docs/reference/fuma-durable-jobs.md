# Fuma Durable Jobs

FUMA-009 adds the hosted durable-job substrate. PostgreSQL is the authority for admission, idempotency, status, attempts, claims, fences, cancellation, retry timing, dead letters, durable effects, and schedule cursors. Redis is only a rebuildable ready-delivery accelerator and short scheduler-lock coordinator. There is no Kafka or external queue dependency.

## Hosted schema

Additive hosted migration `000002_durable_jobs` creates:

- `fuma_jobs`: organization/site-scoped ledger, active admission fields, idempotency keys, retry state, claim expiry, monotonically increasing PostgreSQL fence, cancellation, result, and terminal error;
- `fuma_job_attempts`: immutable attempt identity plus running/final/abandoned state for each claim fence;
- `fuma_job_effects`: one durable result per `(job_id, effect_key)`, allowing a restarted handler to observe an already committed result instead of creating another;
- `fuma_job_schedules`: interval cursor and durable enqueue fence used with a short Redis scheduler lease.

The migration is PostgreSQL-only and belongs to the FUMA-006 manifest. Historical Instatic migration evidence is unchanged.

## Enqueue and admission

`FumaJobService` validates enqueue input with TypeBox. `PostgresFumaJobRepository.enqueue` then:

1. returns an existing organization/site/kind/idempotency-key job;
2. takes transaction advisory locks for the organization and optional site;
3. counts active `queued`, `running`, and `retry_wait` jobs;
4. rejects a full scope with `FumaJobAdmissionError`;
5. inserts the ledger row and commits before notifying Redis.

A failed Redis notification does not roll back or lose the job. Reconciliation reads due work from PostgreSQL and atomically rebuilds the Redis list.

## Fair delivery and claims

A reconciliation batch is ordered with nested weighted round-robin: organization weight controls cross-organization share and site weight controls share inside one organization. Priority orders jobs only inside a site, preventing a high-volume tenant from globally monopolizing workers.

Redis list membership is deduplicated, but delivery is intentionally at-least-once. Every popped ID must pass a PostgreSQL claim transaction. A claim accepts due queued/retry work or an expired running claim, abandons the expired attempt, increments the attempt number and durable fence, and records a new attempt. Completion, failure, cancellation checks, and durable effects compare `(job_id, worker_id, fence)`; stale workers receive `FumaJobFenceError`.

## Effects, retries, cancellation, and dead letters

Handlers use `readDurableResult(effectKey)` before replay-sensitive work and `commitDurableResult(effectKey, result)` for durable idempotent output. The effect receipt and fence check commit in PostgreSQL before success acknowledgement. If a process dies after that commit, the expired job is reclaimed and the stable effect key returns the original result; a handler must replay that result instead of performing the next unit of work. `commitDurableResult` still returns `created: false` for a same-key race. This guarantee applies to the PostgreSQL effect itself; an external provider call must additionally use the same idempotency key at that provider.

Failures use bounded exponential backoff. Attempts below `maxAttempts` move to `retry_wait`; exhaustion moves to `dead_letter`. Queued/retry cancellation is terminal immediately. Running cancellation is cooperative and prevents the worker's eventual success acknowledgement from becoming `succeeded`.

## Scheduler locks

Schedulers scan due PostgreSQL cursors, acquire a short fenced Redis lease per schedule, and call `enqueueSchedule`. PostgreSQL accepts only a fencing token newer than the schedule's durable `enqueue_fence`, inserts an idempotent occurrence, and advances the cursor in one transaction. Redis loss fails the lease closed; duplicate schedulers cannot create duplicate occurrences.

## Runtime integration

`createFumaJobWorkerComponentFactory` and `createFumaJobSchedulerComponentFactory` live under `server/fuma/jobs/`. They implement the neutral FUMA-005 `FumaRuntimeComponentFactory` contract and do not import worker, scheduler, or web composition roots. Their components stop intake in `beginDrain`, run iterations through `FumaRuntimeContext.run`, await in-flight work, and close Redis during `stop`.

The factories accept injected repositories, queues, coordination, handlers, clocks, and instance IDs for integration tests. Without injection they apply hosted migrations, construct the PostgreSQL repository, and use Bun-native Redis clients.

## Fault acceptance

The focused deterministic suite covers duplicate Redis delivery, process death after durable effect and before acknowledgement, Redis loss/erasure and rebuild, stale claim fences, queued and running cancellation, backoff plus retry exhaustion, admission/idempotency, weighted organization/site ordering, and competing scheduler locks. The kill/restart demo prints one durable result after two attempts.

```sh
bun test src/__tests__/fuma/durableJobs.test.ts
bun test src/__tests__/fuma/hostedMigrationsTransition.test.ts
bunx eslint server/fuma/jobs server/fuma/db/migrations/000002_durable_jobs.ts \
  src/__tests__/fuma/durableJobs.test.ts src/__tests__/helpers/fuma/deterministicJobs.ts
```
