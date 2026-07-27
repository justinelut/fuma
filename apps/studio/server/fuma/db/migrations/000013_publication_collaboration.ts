import type { HostedMigration } from '../migrationPolicy'

const scopeColumns = `
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null`

const streamColumns = `platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, resource_kind, resource_id`

export const publicationCollaborationMigration: HostedMigration = {
  id: '000013_publication_collaboration',
  description: 'Create immutable ordered publication collaboration operations, replay receipts, and revisions',
  sql: `
    create table fuma_publication_collaboration_heads (${scopeColumns},
      resource_kind text not null check (resource_kind in ('post','page','template','newsletter')),
      resource_id text not null,
      sequence bigint not null default 0 check (sequence >= 0),
      document_json jsonb not null,
      updated_at timestamptz not null default current_timestamp,
      primary key (${streamColumns}),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict
    );

    create table fuma_publication_collaboration_operations (${scopeColumns},
      resource_kind text not null check (resource_kind in ('post','page','template','newsletter')),
      resource_id text not null,
      mutation_id text not null,
      operation_id text not null,
      operation_index integer not null check (operation_index >= 0 and operation_index < 128),
      actor_session_id text not null,
      base_sequence bigint not null check (base_sequence >= 0),
      accepted_sequence bigint not null check (accepted_sequence > base_sequence),
      operation_json jsonb not null,
      created_at timestamptz not null,
      primary key (${streamColumns}, operation_id),
      unique (${streamColumns}, accepted_sequence, operation_index),
      foreign key (${streamColumns})
        references fuma_publication_collaboration_heads(${streamColumns}) on delete restrict
    );
    create index fuma_publication_collaboration_operations_sequence_idx
      on fuma_publication_collaboration_operations (${streamColumns}, accepted_sequence, operation_index);

    create table fuma_publication_collaboration_mutations (${scopeColumns},
      resource_kind text not null check (resource_kind in ('post','page','template','newsletter')),
      resource_id text not null,
      mutation_id text not null,
      actor_session_id text not null,
      accepted_sequence bigint not null check (accepted_sequence > 0),
      command_json jsonb not null,
      receipt_json jsonb not null,
      document_json jsonb not null,
      created_at timestamptz not null,
      primary key (${streamColumns}, mutation_id),
      unique (${streamColumns}, accepted_sequence),
      foreign key (${streamColumns})
        references fuma_publication_collaboration_heads(${streamColumns}) on delete restrict
    );

    create table fuma_publication_revisions (${scopeColumns},
      resource_kind text not null check (resource_kind in ('post','page','template','newsletter')),
      resource_id text not null,
      revision_id text not null,
      sequence bigint not null check (sequence >= 0),
      parent_revision_id text,
      actor_id text not null,
      reason text not null check (reason in ('autosave','manual-checkpoint','publish','restore')),
      document_json jsonb not null,
      checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
      created_at timestamptz not null,
      primary key (${streamColumns}, revision_id),
      foreign key (${streamColumns})
        references fuma_publication_collaboration_heads(${streamColumns}) on delete restrict
    );
    create index fuma_publication_revisions_sequence_idx
      on fuma_publication_revisions (${streamColumns}, sequence, created_at);
  `,
}
