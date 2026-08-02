import type { HostedMigration } from '../migrationPolicy'

export const artifactInstallationAuthorityMigration: HostedMigration = Object.freeze({
  id: '000070_artifact_installation_authority',
  description: 'Add immutable plugin and component-pack artifact installation authority',
  sql: `
    create table fuma_artifact_releases_v2 (
      artifact_id text primary key,
      artifact_kind text not null check (artifact_kind in ('plugin','component-pack')),
      package_id text not null,
      exact_version text not null check (exact_version ~ '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
      execution_policy text not null check (execution_policy in ('plugin-sandbox-worker','component-declarative','component-restricted-client')),
      object_key text not null unique,
      mime_type text not null check (mime_type in ('application/zip','application/json')),
      content_hash_sha256 text not null check (content_hash_sha256 ~ '^[a-f0-9]{64}$'),
      size_bytes bigint not null check (size_bytes between 1 and 26214400),
      permissions_json jsonb not null check (jsonb_typeof(permissions_json)='array'),
      provenance_json jsonb not null check (jsonb_typeof(provenance_json)='object'),
      artifact_json jsonb not null check (jsonb_typeof(artifact_json)='object'),
      created_at timestamptz not null,
      unique (artifact_kind,package_id,exact_version,content_hash_sha256),
      check ((artifact_kind='plugin')=(execution_policy='plugin-sandbox-worker')),
      check (artifact_kind<>'plugin' or mime_type='application/zip')
    );

    create table fuma_artifact_installations_v2 (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation>0),
      installation_id text not null,
      artifact_id text not null references fuma_artifact_releases_v2(artifact_id) on delete restrict,
      artifact_kind text not null check (artifact_kind in ('plugin','component-pack')),
      package_id text not null,
      exact_version text not null,
      content_hash_sha256 text not null check (content_hash_sha256 ~ '^[a-f0-9]{64}$'),
      execution_policy text not null check (execution_policy in ('plugin-sandbox-worker','component-declarative','component-restricted-client')),
      settings_object_key text null,
      secret_json jsonb null check (secret_json is null or jsonb_typeof(secret_json)='object'),
      state text not null check (state in ('active','suspended','crashed','transferring')),
      worker_generation bigint null check (worker_generation is null or worker_generation>0),
      storage_quota_bytes bigint not null check (storage_quota_bytes>0),
      schedule_quota integer not null check (schedule_quota between 0 and 10000),
      calls_per_minute integer not null check (calls_per_minute>0),
      previous_artifact_id text null references fuma_artifact_releases_v2(artifact_id) on delete restrict,
      version bigint not null check (version>0),
      installation_json jsonb not null check (jsonb_typeof(installation_json)='object'),
      installed_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (platform_id,owner_key,installation_id),
      unique (platform_id,owner_key,owner_generation,installation_id,artifact_kind),
      unique (platform_id,owner_key,owner_generation,installation_id),
      foreign key (platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation)
        references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
        on update cascade on delete restrict,
      check ((artifact_kind='plugin')=(execution_policy='plugin-sandbox-worker')),
      check ((artifact_kind='plugin' and worker_generation is not null)
        or (artifact_kind='component-pack' and worker_generation is null and secret_json is null and state<>'crashed'))
    );
    create index fuma_artifact_installations_scope_v2 on fuma_artifact_installations_v2
      (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,state,artifact_kind);

    create table fuma_artifact_schedules_v2 (
      platform_id text not null, owner_key text not null, owner_generation bigint not null check (owner_generation>0),
      installation_id text not null, artifact_kind text not null default 'plugin' check (artifact_kind='plugin'),
      schedule_id text not null, cron_expression text not null, handler_name text not null,
      enabled boolean not null, next_run_at timestamptz null, schedule_json jsonb not null,
      primary key(platform_id,owner_key,installation_id,schedule_id),
      foreign key(platform_id,owner_key,owner_generation,installation_id,artifact_kind)
        references fuma_artifact_installations_v2(platform_id,owner_key,owner_generation,installation_id,artifact_kind) on update cascade on delete restrict
    );
    create index fuma_artifact_schedules_due_v2 on fuma_artifact_schedules_v2(enabled,next_run_at) where enabled;

    create table fuma_artifact_crashes_v2 (
      platform_id text not null, owner_key text not null, owner_generation bigint not null check (owner_generation>0),
      installation_id text not null, artifact_kind text not null default 'plugin' check (artifact_kind='plugin'),
      crash_id text not null, worker_generation bigint not null check (worker_generation>0),
      error_code text not null, evidence_hash_sha256 text not null check (evidence_hash_sha256 ~ '^[a-f0-9]{64}$'),
      crash_json jsonb not null, occurred_at timestamptz not null,
      primary key(platform_id,owner_key,installation_id,crash_id),
      foreign key(platform_id,owner_key,owner_generation,installation_id,artifact_kind)
        references fuma_artifact_installations_v2(platform_id,owner_key,owner_generation,installation_id,artifact_kind) on update cascade on delete restrict
    );

    create table fuma_artifact_storage_usage_v2 (
      platform_id text not null, owner_key text not null, owner_generation bigint not null check (owner_generation>0), installation_id text not null,
      object_count bigint not null check (object_count>=0), bytes_used bigint not null check (bytes_used>=0),
      version bigint not null check (version>0), usage_json jsonb not null,
      primary key(platform_id,owner_key,installation_id),
      foreign key(platform_id,owner_key,owner_generation,installation_id)
        references fuma_artifact_installations_v2(platform_id,owner_key,owner_generation,installation_id) on update cascade on delete restrict
    );

    create table fuma_artifact_call_windows_v2 (
      platform_id text not null, owner_key text not null, owner_generation bigint not null check (owner_generation>0), installation_id text not null,
      window_started_at timestamptz not null, units integer not null check (units>0),
      primary key(platform_id,owner_key,installation_id,window_started_at),
      foreign key(platform_id,owner_key,owner_generation,installation_id)
        references fuma_artifact_installations_v2(platform_id,owner_key,owner_generation,installation_id) on update cascade on delete restrict
    );

    create table fuma_artifact_transfer_receipts_v2 (
      transfer_id text not null, installation_id text not null, artifact_id text not null,
      source_owner_key text not null, source_owner_generation bigint not null check (source_owner_generation>0),
      destination_owner_key text not null, destination_owner_generation bigint not null check (destination_owner_generation>source_owner_generation),
      receipt_json jsonb not null check (jsonb_typeof(receipt_json)='object'), transferred_at timestamptz not null,
      primary key(transfer_id,installation_id)
    );

    create function fuma_artifact_release_immutable_v2() returns trigger language plpgsql as $artifact_immutable$
    begin raise exception 'artifact release evidence is immutable' using errcode='55000'; end;
    $artifact_immutable$;
    create trigger fuma_artifact_release_immutable_v2 before update or delete on fuma_artifact_releases_v2
      for each row execute function fuma_artifact_release_immutable_v2();
    create trigger fuma_artifact_transfer_immutable_v2 before update or delete on fuma_artifact_transfer_receipts_v2
      for each row execute function fuma_artifact_release_immutable_v2();

    create function fuma_artifact_crash_guard_v2() returns trigger language plpgsql as $artifact_crash_guard$
    begin
      if tg_op='DELETE'
        or new.platform_id<>old.platform_id or new.installation_id<>old.installation_id
        or new.artifact_kind<>old.artifact_kind or new.crash_id<>old.crash_id
        or new.worker_generation<>old.worker_generation or new.error_code<>old.error_code
        or new.evidence_hash_sha256<>old.evidence_hash_sha256 or new.crash_json<>old.crash_json
        or new.occurred_at<>old.occurred_at or new.owner_key=old.owner_key
        or new.owner_generation<=old.owner_generation then
        raise exception 'artifact crash evidence is immutable' using errcode='55000';
      end if;
      return new;
    end;
    $artifact_crash_guard$;
    create trigger fuma_artifact_crash_immutable_v2 before update or delete on fuma_artifact_crashes_v2
      for each row execute function fuma_artifact_crash_guard_v2();

    create function fuma_artifact_installation_guard_v2() returns trigger language plpgsql as $artifact_installation_guard$
    begin
      if tg_op='DELETE' or new.platform_id<>old.platform_id or new.installation_id<>old.installation_id
        or new.artifact_kind<>old.artifact_kind or new.package_id<>old.package_id or new.version<>old.version+1 then
        raise exception 'artifact installation identity or version transition is invalid' using errcode='55000';
      end if;
      if (new.owner_key,new.organization_id,new.workspace_id,new.site_id) is distinct from (old.owner_key,old.organization_id,old.workspace_id,old.site_id)
        and new.owner_generation<=old.owner_generation then
        raise exception 'artifact installation ownership generation did not advance' using errcode='55000';
      end if;
      if new.artifact_id<>old.artifact_id and new.previous_artifact_id<>old.artifact_id then
        raise exception 'artifact replacement lacks rollback evidence' using errcode='55000';
      end if;
      return new;
    end;
    $artifact_installation_guard$;
    create trigger fuma_artifact_installation_guard_v2 before update or delete on fuma_artifact_installations_v2
      for each row execute function fuma_artifact_installation_guard_v2();
  `,
})
