# FUMA-075 reusable Ghost import

The reusable Ghost 5 import authority is `packages/fuma-governance-launch/src/ghostImport.ts`. It is independent of Studio UI and transport code: callers collect a Ghost JSON export or all pages of the Ghost Admin API, then pass credential-free data into the strict TypeBox boundary. `ghostAdminApiSnapshotToExport` normalizes separate API posts/pages and expanded author/tag relations to the same canonical source used by JSON imports. Admin API credentials are transport-only and are not fields in any import contract.

## Mapping and evidence

`planStructuredGhostImport` validates Ghost 5 input and maps posts, pages, authors, tags, settings, members, newsletters, status and dates, SEO, social metadata, canonical URLs, visibility, relations, and media URLs. Member CSV accepts quoted fields and rejects missing/duplicate headers, malformed rows, duplicate/invalid email addresses, invalid timestamps, unterminated quotes, and files over 25 MiB. Authors and members are marked for reauthentication. Passwords, sessions, tokens, private keys, API keys, and provider-secret settings are rejected or omitted and can never become mapped destination objects.

A plan contains deterministic source, relation, media, object, and manifest hashes plus counts and a resumable cursor. A dry-run plan cannot execute mutations. `compareStructuredGhostSourceParity` requires JSON and Admin API sources to produce identical canonical hashes and counts.

## Execution and rollback

`GhostImportExecutionPort` is the storage/media boundary. Production adapters persist its run, object, cursor, receipt, and reauthentication state in the already-finalized hosted migration `000038_structured_imports` tables:

- `fuma_structured_imports`
- `fuma_import_objects`
- `fuma_import_rollback_receipts`
- `fuma_import_reauthentication`

No FUMA-075 follow-up migration is required. The execution service checks object and media state before every write, saves progress after every item, retries only incomplete work, and returns an existing applied receipt for an identical manifest. Media retrieval/storage remains behind the port so the hosted adapter can apply its existing outbound-host, byte-size, MIME, and object-key controls. Rollback verifies the exact manifest hash, removes media and objects in reverse order, and is idempotent.

## Acceptance

`tests/unit/ghost-import.acceptance.test.ts` uses a generic Ghost fixture in both JSON and Admin API shapes. It verifies complete mapping, CSV and relation failures, secret/session exclusion, deterministic import-twice manifests, an interrupted media transfer with resume, duplicate receipt reuse, and idempotent rollback. The architecture gate ties the boundary to finalized migration `000038` and forbids Studio/app imports.
