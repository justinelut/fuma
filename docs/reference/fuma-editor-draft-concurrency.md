# Fuma sequenced draft concurrency

FUMA-028 prevents hosted editor drafts from silently overwriting one another by assigning every profile-qualified site-document stream a server-authoritative monotonic sequence.

## Protocol

A hosted `GET /editor/document` returns `{ document, sequence }`. A write is a strict TypeBox mutation batch:

```json
{
  "mutationId": "tab-7.42",
  "expectedSequence": 12,
  "operations": [
    { "kind": "incremental-save", "save": { "...": "editor changes" } }
  ]
}
```

The server derives all authority from the scoped request. Organization, workspace, site, profile, owner key, and generation are never accepted from headers or the mutation body.

Inside one PostgreSQL transaction the repository:

1. reloads and exclusively locks the exact active/null-transfer owner authority;
2. creates or locks the draft head for `(platform, owner key, generation, profile, resource kind, logical ID)`;
3. checks an immutable mutation receipt for exact replay;
4. compares `expectedSequence` with the locked head;
5. applies every operation in the batch or rolls all of them back;
6. stores the receipt and advances the head by exactly one.

An accepted write returns its authoritative sequence. Exact mutation replay returns the original accepted document and sequence with `replayed: true`; it does not apply twice. Reusing a mutation ID for different content returns a visible conflict.

## Conflict envelope

A stale precondition returns HTTP `409` with a strict deterministic envelope:

```json
{
  "outcome": "conflict",
  "code": "draft-sequence-conflict",
  "mutationId": "tab-8.9",
  "expectedSequence": 12,
  "authoritativeSequence": 13,
  "document": { "...": "authoritative draft" }
}
```

The client keeps the local edit dirty, records the authoritative sequence/document, and enters `saveState: "conflict"`. It cannot save again until the caller explicitly chooses either `accept-authoritative` or `retry-local`. A late accepted response advances the target's sequence without clearing newer local work.

## Isolation

Server streams and receipts include platform, stable owner key, owner generation, profile, resource kind, and logical ID. Every transaction revalidates fresh organization/workspace/site authority before touching a head. Old owner generations cannot observe or advance new heads.

Client state keys include organization, workspace, site, and profile. Mutation ID generators and histories belong to each coordinator instance, so separate tabs share server concurrency but not local history, imports, dirty state, conflict state, or pending responses.

## Storage and migration

Additive hosted migration `000012_editor_draft_sequences` creates:

- `fuma_editor_draft_heads`, whose composite primary key is the complete stream scope;
- `fuma_editor_draft_mutations`, whose primary key adds `mutation_id` and whose immutable receipt stores request hash, expected/accepted sequences, and the accepted document.

The migration follows concurrent `000011_releases`; all earlier SQL and checksums remain unchanged. Its finalized checksum is `92048e16ad1a019569731cbcfcfbb39dbfd6bd439b62ea448af7107a28ed4070`.

## Enforcement

- Repository races, replay, rollback, stale generation: `apps/studio/src/__tests__/fuma/editorDraftConcurrency.test.ts`
- PostgreSQL SQL and migration: `apps/studio/src/__tests__/fuma/editorDraftPostgres.test.ts`
- Strict HTTP and 409 envelope: `apps/studio/src/__tests__/fuma/editorScopedRoutes.test.ts`
- HTTP client decoding: `apps/studio/src/__tests__/admin/fumaEditorScopedHttpAdapter.test.ts`
- Client reconciliation/conflict isolation: `apps/studio/src/__tests__/admin/fumaEditorDraftCoordinator.test.ts`
- Hostile structural gate: `apps/studio/src/__tests__/architecture/fuma-editor-draft-concurrency.test.ts`

## Related

- [Fuma multi-site editor sessions](fuma-editor-multisite.md)
- [Fuma runtime boundary scoping](fuma-runtime-boundary-scoping.md)
- [Hosted migrations transition](fuma-hosted-migrations-transition.md)
