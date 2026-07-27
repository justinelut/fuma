import type { HostedMigration } from '../migrationPolicy'

export const editorDraftSequencesMigration: HostedMigration = {
  id: '000012_editor_draft_sequences',
  description: 'Create scoped editor draft sequences and mutation receipts',
  sql: `
    create table fuma_editor_draft_heads (
      platform_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null,
      resource_kind text not null check (resource_kind = 'site-document'),
      logical_id text not null,
      sequence bigint not null default 0 check (sequence >= 0),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (
        platform_id,
        owner_key,
        owner_generation,
        profile_id,
        resource_kind,
        logical_id
      ),
      constraint fuma_editor_draft_heads_owner_fk
        foreign key (platform_id, owner_key)
        references fuma_tenant_owner_keys(platform_id, owner_key)
        on update cascade
        on delete restrict,
      constraint fuma_editor_draft_heads_identity_nonempty check (
        btrim(platform_id) <> ''
        and char_length(platform_id) <= 255
        and btrim(owner_key) <> ''
        and char_length(owner_key) <= 255
        and btrim(profile_id) <> ''
        and char_length(profile_id) <= 255
        and btrim(logical_id) <> ''
        and char_length(logical_id) <= 255
      )
    );

    create table fuma_editor_draft_mutations (
      platform_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null,
      resource_kind text not null check (resource_kind = 'site-document'),
      logical_id text not null,
      mutation_id text not null,
      request_hash text not null,
      expected_sequence bigint not null check (expected_sequence >= 0),
      accepted_sequence bigint not null check (
        accepted_sequence = expected_sequence + 1
      ),
      document_json jsonb not null,
      created_at timestamptz not null default current_timestamp,
      primary key (
        platform_id,
        owner_key,
        owner_generation,
        profile_id,
        resource_kind,
        logical_id,
        mutation_id
      ),
      constraint fuma_editor_draft_mutations_head_fk
        foreign key (
          platform_id,
          owner_key,
          owner_generation,
          profile_id,
          resource_kind,
          logical_id
        ) references fuma_editor_draft_heads (
          platform_id,
          owner_key,
          owner_generation,
          profile_id,
          resource_kind,
          logical_id
        ) on update cascade on delete restrict,
      constraint fuma_editor_draft_mutations_identity_nonempty check (
        btrim(mutation_id) <> ''
        and char_length(mutation_id) <= 128
        and mutation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
        and request_hash ~ '^[a-f0-9]{64}$'
      ),
      constraint fuma_editor_draft_mutations_document_object check (
        jsonb_typeof(document_json) = 'object'
      )
    );

    create index fuma_editor_draft_mutations_sequence_idx
      on fuma_editor_draft_mutations (
        platform_id,
        owner_key,
        owner_generation,
        profile_id,
        resource_kind,
        logical_id,
        accepted_sequence
      );
  `,
}
