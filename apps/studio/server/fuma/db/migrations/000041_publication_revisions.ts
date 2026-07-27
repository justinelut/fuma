import type { HostedMigration } from '../migrationPolicy'

const scopeColumns = `
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null`

const scopeKeys = 'platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id'
const streamKeys = `${scopeKeys}, resource_kind, resource_id`

export const publicationRevisionsMigration: HostedMigration = {
  id: '000041_publication_revisions',
  description: 'Add object-backed immutable publication revisions, checkpoints, retention, and audit',
  sql: `
    create table fuma_publication_revision_snapshots (${scopeColumns},
      snapshot_id text not null check (snapshot_id ~ '^[a-f0-9]{64}$'),
      object_key text not null,
      checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
      size_bytes bigint not null check (size_bytes > 0),
      state text not null check (state in ('available','deleting')),
      created_at timestamptz not null,
      primary key (${scopeKeys}, snapshot_id),
      unique (${scopeKeys}, object_key),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict
    );

    create table fuma_publication_revision_entries (${scopeColumns},
      resource_kind text not null check (resource_kind in ('post','page','template','newsletter')),
      resource_id text not null,
      revision_id text not null,
      sequence bigint not null check (sequence >= 0),
      parent_revision_id text,
      actor_id text not null,
      reason text not null check (reason in ('periodic','manual-checkpoint','publish','restore')),
      checkpoint_name text,
      snapshot_id text not null check (snapshot_id ~ '^[a-f0-9]{64}$'),
      checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
      size_bytes bigint not null check (size_bytes > 0),
      retained_until timestamptz,
      created_at timestamptz not null,
      primary key (${streamKeys}, revision_id),
      foreign key (${streamKeys})
        references fuma_publication_collaboration_heads(${streamKeys}) on delete restrict,
      check ((reason = 'manual-checkpoint' and checkpoint_name is not null and retained_until is null)
        or (reason <> 'manual-checkpoint' and checkpoint_name is null))
    );
    create unique index fuma_publication_revision_entries_sequence_idx
      on fuma_publication_revision_entries (${streamKeys}, sequence, revision_id);
    create index fuma_publication_revision_entries_created_idx
      on fuma_publication_revision_entries (${streamKeys}, created_at desc);

    create table fuma_publication_revision_heads (${scopeColumns},
      resource_kind text not null check (resource_kind in ('post','page','template','newsletter')),
      resource_id text not null,
      revision_id text not null,
      updated_at timestamptz not null,
      primary key (${streamKeys}),
      foreign key (${streamKeys}, revision_id)
        references fuma_publication_revision_entries(${streamKeys}, revision_id) on delete restrict
    );

    create table fuma_publication_revision_snapshot_refs (${scopeColumns},
      resource_kind text not null check (resource_kind in ('post','page','template','newsletter')),
      resource_id text not null,
      revision_id text not null,
      snapshot_id text not null,
      protected boolean not null,
      retained_until timestamptz,
      created_at timestamptz not null,
      primary key (${streamKeys}, revision_id),
      foreign key (${streamKeys}, revision_id)
        references fuma_publication_revision_entries(${streamKeys}, revision_id) on delete restrict,
      foreign key (${scopeKeys}, snapshot_id)
        references fuma_publication_revision_snapshots(${scopeKeys}, snapshot_id) on delete restrict,
      check ((protected and retained_until is null) or (not protected and retained_until is not null))
    );
    create index fuma_publication_revision_snapshot_refs_retention_idx
      on fuma_publication_revision_snapshot_refs (${scopeKeys}, protected, retained_until);
    create index fuma_publication_revision_snapshot_refs_snapshot_idx
      on fuma_publication_revision_snapshot_refs (${scopeKeys}, snapshot_id);

    create table fuma_publication_revision_audit (${scopeColumns},
      event_id text not null,
      action text not null check (action in ('revision-created','revision-restored','snapshot-reference-expired','snapshot-collected')),
      resource_kind text,
      resource_id text,
      revision_id text,
      snapshot_id text,
      actor_id text not null,
      details_json jsonb not null,
      created_at timestamptz not null,
      primary key (${scopeKeys}, event_id),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict
    );
    create index fuma_publication_revision_audit_scope_idx
      on fuma_publication_revision_audit (${scopeKeys}, created_at, event_id);

    create function fuma_publication_revisions_reject_mutation() returns trigger
    language plpgsql as $$
    begin
      raise exception 'publication revision history is immutable';
    end;
    $$;
    create trigger fuma_publication_revision_entries_immutable
      before update or delete on fuma_publication_revision_entries
      for each row execute function fuma_publication_revisions_reject_mutation();
    create trigger fuma_publication_revision_audit_immutable
      before update or delete on fuma_publication_revision_audit
      for each row execute function fuma_publication_revisions_reject_mutation();
  `,
}
