# FUMA member accounts, segments, and access

FUMA-039 adds the Publication member profile and entitlement layer above the isolated FUMA-038 site-member identity realm. It does not reuse Better Auth staff identities, cookies, sessions, roles, or permissions.

## Authority and persistence

Every row is qualified by `platform_id`, `organization_id`, `workspace_id`, `site_id`, `owner_key`, `owner_generation`, and `profile_id`. `fuma_publication_member_accounts` has an exact composite foreign key to `fuma_member_identities` and a member foreign key to the existing Publication audience record. Consent and privacy rows reference the exact `(account_id, member_id)` pair; a caller cannot attach provenance or erasure to a different member.

Migration `000047_member_accounts_access` is the only migration owned by this feature. The migration index, checksums, and sentinel remain integration-owner responsibilities.

## Consent

Newsletter consent is an append-only event stream. The current state is derived deterministically by `(occurredAt, eventId)` from publication-wide events plus events for the requested newsletter. Results include the winning event as provenance. Staff and member-profile events cannot claim receipt provenance; staff-import and one-click events require a receipt ID. PostgreSQL rejects update/delete of provenance rows.

## Segments

Member segments are separate from the legacy campaign audience definition:

- **Explicit** segments contain only unique member IDs.
- **Dynamic** segments contain one or more strict TypeBox rules and no explicit IDs.
- Recalculation excludes blocked and unsubscribed members, sorts/deduplicates IDs, records the definition version, and atomically replaces the previous snapshot.
- Subject export queries return only the requested member in each matching snapshot; they never aggregate another member's IDs into the export.

## Access and presentation

Access sources are `complimentary`, `manual`, and `paid`. Paid rows require a verified payment reference SHA-256; other sources reject one. The evaluator applies publication, post, and tag grants to the exact content record. Timestamps derive active, grace, and expired state, while explicit revocation always wins. State transitions are monotonic; restoring revoked access requires a new grant.

The evaluator supplies member, paid, and current segment audience facts to the existing semantic `decidePublicationPresentation` authority. It never executes tenant markup and returns the exact render, deny, redirect, or unavailable decision for the content status, path, and audience.

## Export and deletion

Exports contain the account, Publication member, consent provenance, subject-only segment snapshots, and access records. Export and deletion operations are rate-limited per exact tenant scope and subject. Unknown and cross-tenant account IDs produce the same generic not-found error.

Deletion has two steps: request and completion. Completion runs in one PostgreSQL transaction and:

1. marks the privacy request complete and profile deleted;
2. removes segment membership and revokes access;
3. pseudonymizes the legacy Publication member;
4. revokes every active FUMA-038 member session;
5. erases the identity email, display name, and credential while preserving the FUMA-038 origin invariant; and
6. retains append-only consent provenance without retaining the original email or credential.

## Scoped routes and Studio

All APIs are declarations in the central Publication scoped boundary and require `publication.members.read` or `publication.members.write`. List routes accept `limit` (1–200) and an optional cursor. Request and response bodies use strict TypeBox schemas with `additionalProperties: false`; tenant/profile/actor claims are not accepted from bodies.

The Members workspace includes a CSS-Modules `MemberAccessSurface` built with current `Button`, `FormField`, `Input`, `Textarea`, and `Select` primitives. It supports realm-bound profiles, current consent provenance, explicit/dynamic segment recalculation, access grant/revoke, export, and deletion requests with labelled controls, fieldsets, table captions, live status output, and responsive layouts.

## Focused verification

```sh
bun test apps/studio/src/__tests__/fuma/memberAccess.test.ts \
  apps/studio/src/__tests__/fuma/memberAccessPostgresArchitecture.test.ts \
  apps/studio/src/__tests__/fuma/memberAccess.demo.test.ts

bunx tsc --noEmit -p apps/studio/tsconfig.node.json
bunx tsc --noEmit -p apps/studio/tsconfig.app.json
bunx eslint apps/studio/server/fuma/publication/memberAccess.ts \
  apps/studio/server/fuma/publication/memberAccessPostgres.ts \
  apps/studio/server/fuma/publication/routes.ts \
  apps/studio/server/fuma/publication/composition.ts \
  apps/studio/src/admin/fuma/publication/MemberAccessSurface.tsx \
  apps/studio/src/__tests__/fuma/memberAccess*.ts
```
