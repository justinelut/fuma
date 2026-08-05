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

/** FUMA-036 candidate only. Primary integration owns registry/checksum finalization. */
export const publicationSchedulingAccessMigration: HostedMigration = Object.freeze({
  id: '000048_publication_scheduling_access',
  description: 'Add exact-scope Publication schedules and digest-only preview token authority',
  sql: `
    create table fuma_publication_schedules_v2 (${scopeColumns},
      schedule_id text not null,
      content_id text not null,
      action text not null check (action in ('publish','unpublish')),
      expected_workflow_version bigint not null check (expected_workflow_version > 0),
      due_at timestamptz not null,
      display_timezone text not null,
      state text not null check (state in ('pending','claimed','completed','superseded','cancelled')),
      claim_fence bigint not null default 0 check (claim_fence >= 0),
      claimed_by text,
      claim_expires_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz not null,
      primary key (${scopeKeys}, schedule_id),
      foreign key (${scopeKeys}, content_id)
        references fuma_publication_metadata_authority(${scopeKeys}, content_id) on update cascade on delete restrict,
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict,
      check ((state='claimed')=(claimed_by is not null and claim_expires_at is not null)),
      check ((state in ('completed','superseded','cancelled'))=(completed_at is not null))
    );
    create index fuma_publication_schedules_v2_due_idx
      on fuma_publication_schedules_v2 (${scopeKeys}, due_at, schedule_id)
      where state in ('pending','claimed');
    create unique index fuma_publication_schedules_v2_active_action_idx
      on fuma_publication_schedules_v2 (${scopeKeys}, content_id, action)
      where state in ('pending','claimed');

    create table fuma_publication_preview_tokens (${scopeColumns},
      token_id text not null,
      content_id text not null,
      token_digest_sha256 text not null check (token_digest_sha256 ~ '^[a-f0-9]{64}$'),
      expires_at timestamptz not null,
      created_at timestamptz not null,
      revoked_at timestamptz,
      last_used_at timestamptz,
      use_count bigint not null default 0 check (use_count >= 0),
      primary key (${scopeKeys}, token_id),
      unique (${scopeKeys}, token_digest_sha256),
      foreign key (${scopeKeys}, content_id)
        references fuma_publication_metadata_authority(${scopeKeys}, content_id) on update cascade on delete cascade,
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict,
      check (created_at < expires_at),
      check (revoked_at is null or revoked_at >= created_at),
      check (last_used_at is null or last_used_at >= created_at)
    );
    create index fuma_publication_preview_tokens_expiry_idx
      on fuma_publication_preview_tokens (${scopeKeys}, expires_at, token_id)
      where revoked_at is null;
  `,
})
