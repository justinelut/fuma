import type { HostedMigration } from '../migrationPolicy'

export const transitionBookkeepingMigration: HostedMigration = {
  id: '000001_transition_bookkeeping',
  description: 'Create resumable legacy transition bookkeeping',
  sql: `
    create table if not exists fuma_legacy_imports (
      source_fingerprint text primary key,
      artifact_hash text not null,
      state text not null check (state in ('running', 'complete')),
      source_table_count integer not null,
      source_row_count bigint not null,
      started_at timestamptz not null default current_timestamp,
      completed_at timestamptz
    );

    create table if not exists fuma_legacy_import_tables (
      source_fingerprint text not null references fuma_legacy_imports(source_fingerprint),
      table_name text not null,
      row_count bigint not null,
      content_hash text not null,
      completed_at timestamptz not null default current_timestamp,
      primary key (source_fingerprint, table_name)
    );
  `,
}
