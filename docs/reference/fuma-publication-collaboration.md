# Fuma Publication collaboration reconciliation

FUMA-030 extends the FUMA-028 monotonic draft boundary and FUMA-029 advisory presence with a durable, ordered operation stream. Presence remains a separate read-authorized channel and never grants mutation authority.

## Authority and ordering

Each collaborative stream is keyed by platform, organization, workspace, site, stable owner key, owner generation, profile, resource kind, and resource ID. PostgreSQL reloads active, transfer-free owner authority inside every transaction and locks one authoritative head containing `{ sequence, document }`.

A strict TypeBox reconcile command contains a server-independent `mutationId`, the expected head sequence, and one atomic batch of 1–128 closed operations: `set`, `insert`, `remove`, or `move`. Every operation has a unique `operationId`, the same `baseSequence`, and a bounded path. The server derives actor session and acceptance time; clients cannot submit them.

A matching batch applies to a clone, appends immutable ledger rows ordered by `(accepted_sequence, operation_index)`, advances the head exactly once, and stores one immutable mutation receipt in the same transaction. Any invalid operation or persistence conflict rolls the entire transaction back. Exact mutation replay returns the original receipt and accepted document with `replayed: true`; reusing an ID with different input or actor is a visible conflict.

A stale command returns `rebase-required` with the authoritative sequence/document and ordered operations since the caller's base. It never silently overwrites local state. The browser coordinator preserves local work until an explicit `accept-authoritative` or `retry-local` choice. Retry rewrites operation bases and deterministically reapplies them to the authoritative document; an unsupported path conflict throws without replacing either tree.

## Transport and reconnect

`/publication/collaboration/socket/:resourceKind/:resourceId` is a dedicated same-origin WebSocket channel. Upgrade requires trusted Publication read authority. Every reconcile frame revalidates Publication write authority and exact scope before touching durable state.

Accepted commits publish strict acknowledgement frames through owner-generation-qualified Redis pub/sub. The initiating tab receives its receipt and every same-stream tab receives the accepted batch plus authoritative document. Duplicate/out-of-order frames are ignored by sequence. Redis fan-out is an optimization, not durability: on every connect/reconnect the client sends `collaboration-catch-up` with its last sequence and receives the authoritative document plus ordered ledger suffix. Pending mutation IDs survive reconnect and are resent unchanged, so an ambiguous disconnect resolves by exact replay rather than double application.

The production Bun server multiplexes this durable channel with the separate presence channel. Presence retains its 4 KiB frame check, heartbeat/TTL, rate limits, and advisory failure semantics; collaboration uses a bounded 64 KiB frame and write reauthorization.

## Tree safety and convergence

Operation paths are bounded and reject `__proto__`, `prototype`, and `constructor`. Values must be finite acyclic JSON composed of arrays, primitives, and plain objects without accessors or forbidden prototype keys. Application never mutates the caller's tree.

Focused deterministic evidence covers atomic rollback, exact replay, mutation-ID conflict, concurrent writers, stale rebase, retry, duplicate/out-of-order frames, reconnect catch-up, owner-generation isolation, and unsupported conflicts. A seeded 80-batch run exercises add, move, rename, and style operations and proves that replaying the accepted ledger yields byte-structurally equivalent final trees. The socket suite separately demonstrates accepted fan-out, disconnect/reconnect catch-up, and final authoritative state.

## Implementation map

- Contracts and dispatcher: `apps/studio/src/core/fuma/publication/contracts.ts`, `operations.ts`
- Durable service/repository: `apps/studio/server/fuma/publication/collaboration.ts`
- Transport and server multiplexer: `collaborationSocket.ts`, `socketHub.ts`
- Browser coordinator/transport: `apps/studio/src/admin/fuma/publication/collaborationCoordinator.ts`
- Additive schema: `apps/studio/server/fuma/db/migrations/000013_publication_collaboration.ts`
- Evidence: `publicationCollaboration.test.ts`, `publicationCollaborationSocket.test.ts`, `fumaPublicationCollaborationCoordinator.test.ts`, and the FUMA-030 case in `fuma-publication-phase.test.ts`
