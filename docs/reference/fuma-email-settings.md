# Hierarchical email settings and variables (FUMA-043)

FUMA-043 supplies a dedicated, central-ready email settings boundary. It does not modify the legacy mutable `fuma_email_settings_layers` table or mount itself into central Publication composition. Primary integration can adopt the new graph after candidate migration `000049_email_settings_versions` is registered and checksum-finalized.

## Resolution model

Settings resolve deterministically in this order:

```text
platform → organization → workspace → site → newsletter
```

The six required fields are `senderName`, `senderEmail`, `replyToEmail`, `physicalAddress`, `brandColor`, and `footerText`. Each field is resolved independently. The most specific current version containing an explicit override wins. A resolved field includes its source level, level ID, immutable version ID, ordinal, and whether the value is inherited by the requested target. Resolution fails closed if any required field is absent. The provider is not configurable: the resolved contract contains the literal `oci-email-delivery`.

Every durable call is qualified by platform, organization, workspace, site, stable owner key, owner generation, and assigned profile. The PostgreSQL adapter reloads the active, transfer-free owner generation and current site profile inside each transaction. Logical IDs therefore cannot cross a site, ownership generation, or profile boundary.

## Immutable versions and reset

A change command contains only a checked hierarchy target, expected current version ID, and one bounded mutation:

- `set` replaces explicit fields at that level;
- `reset` removes selected explicit fields so they inherit from the next available ancestor.

The service derives actor, timestamp, parent, ordinal, and version ID from trusted ports. It appends an immutable snapshot and compare-and-swap updates one current-head row. Stale heads fail without advancing the pointer. Reset is itself an immutable version; earlier snapshots are never edited. PostgreSQL rejects update/delete against version rows with an immutability trigger.

## Authorized variable catalog

The catalog is closed, typed, namespaced, and mode-specific. Supported namespaces are `platform`, `organization`, `workspace`, `site`, `newsletter`, `member`, `campaign`, and `unsubscribe`. Definitions declare `string`, `email`, `https-url`, or `secret`; public, personal, or secret classification; required status; and allowed preview/test/send modes.

Variable context values carry a server-derived complete scope binding. Resolution rejects:

- unknown names and duplicate values;
- requested values missing from context;
- values with the wrong declared type;
- values unavailable in the requested mode (for example `member.email` in preview);
- any secret-classified variable;
- any site, owner-generation, profile, or newsletter mismatch.

The public catalog excludes secret definitions. Diagnostic redaction preserves public values, replaces personal values with `[REDACTED]`, and replaces both secret names and values. Preview fixtures may provide non-secret personal display names, but never member email, unsubscribe URLs, or provider credentials.

## Production seams

- Contracts: `apps/studio/src/core/fuma/publication/emailSettingsContracts.ts`
- Resolver/service/repository port: `apps/studio/server/fuma/publication/emailSettings.ts`
- PostgreSQL adapter: `apps/studio/server/fuma/publication/emailSettingsPostgres.ts`
- Bounded declarations: `apps/studio/server/fuma/publication/emailSettingsRoutes.ts`
- Dedicated graph: `apps/studio/server/fuma/publication/emailSettingsComposition.ts`
- Candidate migration: `apps/studio/server/fuma/db/migrations/000049_email_settings_versions.ts`
- Standalone accessible Studio surface: `apps/studio/src/admin/fuma/publication/EmailSettingsSurface.tsx`

Routes are ready to append to the central scoped boundary:

| Method | Suffix | Permission |
|---|---|---|
| POST | `/publication/email-settings/versions` | `site.settings.write` |
| GET | `/publication/email-settings/resolved` | `site.settings.read` |
| GET | `/publication/email-settings/resolved/:newsletterId` | `site.settings.read` |
| GET | `/publication/email-settings/variables/:mode` | `site.settings.read` |

Request bodies cannot supply platform, ancestry, owner, generation, profile, actor, role, session, version ID, ordinal, or timestamp authority. Responses are strict TypeBox contracts with `no-store`; scope denial is indistinguishable from not found.

## Primary integration checklist

1. Confirm the concurrent `000048` owner, register `000049_email_settings_versions` in the hosted migration stream, compute its source checksum, and update the migration sentinel in one primary-owned change.
2. Construct `createEmailSettingsServiceGraph` from the hosted PostgreSQL database, cryptographic ID authority, and clock; append its four declarations to central scoped routes.
3. Adapt newsletter preview/campaign snapshot creation from the legacy `PublicationEmailSettingsService` to `HierarchicalEmailSettingsService.resolve` only after the migration is deployable.
4. Mount `EmailSettingsSurface` in the Publication settings contribution and refresh resolved state after every successful immutable change. `PublicationWorkspace` was intentionally not edited by this ticket.
5. Retire legacy mutable settings only in a separately planned, data-migrated compatibility change; no dual-write is introduced here.

## Verification and demo

`emailSettingsHierarchy.test.ts` covers all 30 level×field inheritance cells, immutable reset/history, stale CAS, incomplete settings, strict commands, and cross-site/owner-generation/profile isolation. It also covers typed variable success plus unknown, missing, secret, unauthorized-mode, wrong-type, cross-scope, and redaction failures.

`emailSettingsArchitecture.test.tsx` checks additive candidate DDL, immutable triggers, complete PostgreSQL qualifiers/current-profile authority, bounded exact-permission routes, dedicated composition, forbidden dependencies, and the responsive labelled Studio CSS Module surface. `emailSettings.demo.test.ts` emits a deterministic transcript with one sender/theme override at each level and final newsletter provenance; it contains no secrets or credentials.
