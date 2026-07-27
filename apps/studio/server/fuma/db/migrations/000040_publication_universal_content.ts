import type { HostedMigration } from '../migrationPolicy'

/**
 * FUMA-033 forward adapter for Publication content in the universal store.
 *
 * Finalized migrations 000014..000020 remain immutable. Their legacy tables
 * are retained for rollback compatibility, but Publication content and tags
 * are read and written through data_tables/data_rows after this migration.
 * Relations are normalized here rather than embedded as JSON ID arrays.
 */
export const publicationUniversalContentMigration: HostedMigration = Object.freeze({
  id: '000040_publication_universal_content',
  description: 'Add universal Publication content relations',
  sql: `
    create table data_row_relations (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      profile_id text not null,
      source_row_id text not null references data_rows(id) on delete cascade,
      relation_kind text not null check (relation_kind in ('author', 'tag')),
      target_kind text not null check (target_kind in ('staff-profile', 'data-row')),
      target_id text not null,
      target_row_id text null references data_rows(id) on delete cascade,
      position integer not null check (position >= 0),
      is_primary boolean not null default false,
      created_at timestamptz not null default current_timestamp,
      primary key (
        platform_id, owner_key, profile_id,
        source_row_id, relation_kind, target_id
      ),
      constraint data_row_relations_owner_fk
        foreign key (
          platform_id, owner_key, organization_id, workspace_id, site_id
        ) references fuma_tenant_owner_keys (
          platform_id, owner_key, organization_id, workspace_id, site_id
        ) on update cascade on delete restrict,
      constraint data_row_relations_target_shape check (
        (target_kind = 'staff-profile' and target_row_id is null and relation_kind = 'author')
        or (target_kind = 'data-row' and target_row_id is not null and relation_kind = 'tag')
      )
    );

    create unique index data_row_relations_position_unique
      on data_row_relations (
        platform_id, owner_key, profile_id,
        source_row_id, relation_kind, position
      );

    create unique index data_row_relations_primary_unique
      on data_row_relations (
        platform_id, owner_key, profile_id,
        source_row_id, relation_kind
      ) where is_primary;

    create index data_row_relations_target_idx
      on data_row_relations (
        platform_id, organization_id, workspace_id, site_id,
        owner_key, profile_id, relation_kind, target_id
      );
  `,
})
