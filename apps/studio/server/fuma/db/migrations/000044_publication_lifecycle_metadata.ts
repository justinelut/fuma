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

export const publicationLifecycleMetadataMigration: HostedMigration = Object.freeze({
  id: '000044_publication_lifecycle_metadata',
  description: 'Add scoped Publication lifecycle, metadata, redirects, access decisions, and immutable authority revisions',
  sql: `
    create table fuma_publication_metadata_authority (${scopeColumns},
      content_id text not null,
      content_path text not null check (content_path like '/%'),
      lifecycle_status text not null check (lifecycle_status in ('draft','in-review','approved','scheduled','published','unpublished','archived')),
      workflow_version bigint not null check (workflow_version > 0),
      canonical_url text,
      canonical_path text,
      visibility_kind text not null check (visibility_kind in ('public','member','paid','segment')),
      metadata_sha256 text not null check (metadata_sha256 ~ '^[a-f0-9]{64}$'),
      snapshot_json jsonb not null,
      updated_at timestamptz not null,
      primary key (${scopeKeys}, content_id),
      unique (${scopeKeys}, content_path),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict
    );
    create unique index fuma_publication_metadata_authority_canonical_unique
      on fuma_publication_metadata_authority (${scopeKeys}, canonical_url)
      where canonical_url is not null;
    create index fuma_publication_metadata_authority_delivery_idx
      on fuma_publication_metadata_authority (${scopeKeys}, lifecycle_status, visibility_kind, content_id);

    create table fuma_publication_redirect_authority (${scopeColumns},
      content_id text not null,
      from_path text not null check (from_path like '/%'),
      to_path text not null check (to_path like '/%'),
      status_code integer not null check (status_code in (301,308)),
      created_at timestamptz not null,
      primary key (${scopeKeys}, from_path),
      foreign key (${scopeKeys}, content_id)
        references fuma_publication_metadata_authority(${scopeKeys}, content_id)
        on update cascade on delete cascade,
      check (from_path <> to_path)
    );
    create index fuma_publication_redirect_authority_target_idx
      on fuma_publication_redirect_authority (${scopeKeys}, to_path);

    create table fuma_publication_authority_revisions (${scopeColumns},
      content_id text not null,
      workflow_version bigint not null check (workflow_version > 0),
      revision_id text not null,
      reason text not null check (reason in ('metadata','lifecycle')),
      lifecycle_status text not null check (lifecycle_status in ('draft','in-review','approved','scheduled','published','unpublished','archived')),
      metadata_sha256 text not null check (metadata_sha256 ~ '^[a-f0-9]{64}$'),
      snapshot_json jsonb not null,
      created_at timestamptz not null,
      primary key (${scopeKeys}, content_id, workflow_version),
      unique (${scopeKeys}, revision_id),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict
    );
    create index fuma_publication_authority_revisions_history_idx
      on fuma_publication_authority_revisions (${scopeKeys}, content_id, workflow_version desc);

    create table fuma_publication_lifecycle_transitions (${scopeColumns},
      transition_id text not null,
      content_id text not null,
      from_status text not null check (from_status in ('draft','in-review','approved','scheduled','published','unpublished','archived')),
      to_status text not null check (to_status in ('draft','in-review','approved','scheduled','published','unpublished','archived')),
      actor_id text not null,
      expected_version bigint not null check (expected_version > 0),
      scheduled_at timestamptz,
      note text not null,
      created_at timestamptz not null,
      primary key (${scopeKeys}, transition_id),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict
    );
    create index fuma_publication_lifecycle_transitions_content_idx
      on fuma_publication_lifecycle_transitions (${scopeKeys}, content_id, created_at, transition_id);

    create function fuma_publication_authority_history_reject_mutation() returns trigger
    language plpgsql as $$
    begin
      raise exception 'publication authority history is immutable';
    end;
    $$;
    create trigger fuma_publication_authority_revisions_immutable
      before update or delete on fuma_publication_authority_revisions
      for each row execute function fuma_publication_authority_history_reject_mutation();
    create trigger fuma_publication_lifecycle_transitions_immutable
      before update or delete on fuma_publication_lifecycle_transitions
      for each row execute function fuma_publication_authority_history_reject_mutation();
  `,
})
