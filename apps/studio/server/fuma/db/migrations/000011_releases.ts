import type { HostedMigration } from '../migrationPolicy'

export const releasesMigration: HostedMigration = {
  id: '000011_releases',
  description: 'Create immutable release lifecycle, active pointers, and retention roots',
  sql: `
    create table fuma_releases (
      platform_id text not null,
      owner_key text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      release_id text not null,
      source_snapshot_hash text not null,
      status text not null default 'queued' check (
        status in ('queued', 'building', 'ready', 'active', 'failed')
      ),
      build_job_id text null,
      build_job_fence numeric(39, 0) null,
      manifest_json jsonb null,
      manifest_hash text null,
      failure_json jsonb null,
      version bigint not null default 1 check (version > 0),
      queued_at timestamptz not null,
      building_at timestamptz null,
      ready_at timestamptz null,
      activated_at timestamptz null,
      failed_at timestamptz null,
      updated_at timestamptz not null,
      primary key (platform_id, owner_key, release_id),
      constraint fuma_releases_qualified_identity_unique unique (
        platform_id, owner_key, organization_id, workspace_id, site_id, release_id
      ),
      constraint fuma_releases_owner_fk
        foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(
          platform_id, owner_key, organization_id, workspace_id, site_id
        )
        on update cascade
        on delete restrict,
      constraint fuma_releases_nonempty check (
        btrim(platform_id) <> ''
        and btrim(owner_key) <> ''
        and btrim(organization_id) <> ''
        and btrim(workspace_id) <> ''
        and btrim(site_id) <> ''
        and btrim(release_id) <> ''
        and source_snapshot_hash ~ '^[a-f0-9]{64}$'
        and (manifest_hash is null or manifest_hash ~ '^[a-f0-9]{64}$')
      ),
      constraint fuma_releases_json_shape check (
        (manifest_json is null or jsonb_typeof(manifest_json) = 'object')
        and (failure_json is null or jsonb_typeof(failure_json) = 'object')
      ),
      constraint fuma_releases_claim_shape check (
        (build_job_id is null and build_job_fence is null)
        or (build_job_id is not null and btrim(build_job_id) <> '' and build_job_fence > 0)
      ),
      constraint fuma_releases_manifest_shape check (
        (manifest_json is null and manifest_hash is null)
        or (
          manifest_json is not null
          and manifest_hash is not null
          and manifest_json ->> 'manifestHashSha256' = manifest_hash
          and manifest_json ->> 'releaseId' = release_id
          and manifest_json ->> 'ownerKey' = owner_key
          and manifest_json ->> 'siteId' = site_id
          and manifest_json ->> 'sourceSnapshotHashSha256' = source_snapshot_hash
        )
      ),
      constraint fuma_releases_state_shape check (
        (status = 'queued'
          and build_job_id is null and manifest_json is null and failure_json is null
          and building_at is null and ready_at is null and activated_at is null and failed_at is null)
        or (status = 'building'
          and build_job_id is not null and manifest_json is null and failure_json is null
          and building_at is not null and ready_at is null and activated_at is null and failed_at is null)
        or (status = 'ready'
          and build_job_id is not null and manifest_json is not null and failure_json is null
          and building_at is not null and ready_at is not null and failed_at is null)
        or (status = 'active'
          and build_job_id is not null and manifest_json is not null and failure_json is null
          and building_at is not null and ready_at is not null and activated_at is not null and failed_at is null)
        or (status = 'failed'
          and manifest_json is null and failure_json is not null
          and ready_at is null and activated_at is null and failed_at is not null)
      )
    );

    create index fuma_releases_site_status_idx
      on fuma_releases (
        platform_id, organization_id, workspace_id, site_id, owner_key,
        status, queued_at, release_id
      );

    create table fuma_release_active_pointers (
      platform_id text not null,
      owner_key text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      release_id text not null,
      version bigint not null check (version > 0),
      activated_at timestamptz not null,
      primary key (platform_id, owner_key),
      constraint fuma_release_active_pointers_site_unique unique (
        platform_id, organization_id, workspace_id, site_id
      ),
      constraint fuma_release_active_pointers_release_fk
        foreign key (
          platform_id, owner_key, organization_id, workspace_id, site_id, release_id
        ) references fuma_releases(
          platform_id, owner_key, organization_id, workspace_id, site_id, release_id
        )
        on update cascade
        on delete restrict
    );

    create table fuma_release_retention_roots (
      platform_id text not null,
      owner_key text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      root_id text not null,
      release_id text not null,
      kind text not null check (kind in ('active', 'manual')),
      created_at timestamptz not null,
      primary key (platform_id, owner_key, root_id),
      constraint fuma_release_retention_roots_release_fk
        foreign key (
          platform_id, owner_key, organization_id, workspace_id, site_id, release_id
        ) references fuma_releases(
          platform_id, owner_key, organization_id, workspace_id, site_id, release_id
        )
        on update cascade
        on delete restrict,
      constraint fuma_release_retention_roots_nonempty check (
        btrim(root_id) <> ''
      )
    );

    create unique index fuma_release_retention_roots_one_active
      on fuma_release_retention_roots (platform_id, owner_key)
      where kind = 'active';

    create index fuma_release_retention_roots_release_idx
      on fuma_release_retention_roots (
        platform_id, owner_key, organization_id, workspace_id, site_id, release_id, kind
      );

    create function fuma_releases_enforce_immutability()
    returns trigger
    language plpgsql
    as $release_immutability$
    begin
      if tg_op = 'DELETE' then
        if old.status = 'active' then
          raise exception 'active releases cannot be deleted' using errcode = '55000';
        end if;
        return old;
      end if;

      if new.platform_id <> old.platform_id
        or new.owner_key <> old.owner_key
        or new.site_id <> old.site_id
        or new.release_id <> old.release_id
        or new.source_snapshot_hash <> old.source_snapshot_hash then
        raise exception 'release identity is immutable' using errcode = '55000';
      end if;
      if new.organization_id is distinct from old.organization_id
        or new.workspace_id is distinct from old.workspace_id then
        if new.status is not distinct from old.status
          and new.build_job_id is not distinct from old.build_job_id
          and new.build_job_fence is not distinct from old.build_job_fence
          and new.manifest_json is not distinct from old.manifest_json
          and new.manifest_hash is not distinct from old.manifest_hash
          and new.failure_json is not distinct from old.failure_json
          and new.version = old.version
          and new.queued_at = old.queued_at
          and new.building_at is not distinct from old.building_at
          and new.ready_at is not distinct from old.ready_at
          and new.activated_at is not distinct from old.activated_at
          and new.failed_at is not distinct from old.failed_at
          and new.updated_at = old.updated_at then
          return new;
        end if;
        raise exception 'release ancestry may change only through owner-key cascade'
          using errcode = '55000';
      end if;
      if old.manifest_hash is not null and (
        new.manifest_hash is distinct from old.manifest_hash
        or new.manifest_json is distinct from old.manifest_json
      ) then
        raise exception 'release manifest is immutable' using errcode = '55000';
      end if;
      if new.status <> old.status and not (
        (old.status = 'queued' and new.status in ('building', 'failed'))
        or (old.status = 'building' and new.status in ('ready', 'failed'))
        or (old.status = 'ready' and new.status = 'active')
        or (old.status = 'active' and new.status = 'ready')
      ) then
        raise exception 'invalid release lifecycle transition' using errcode = '55000';
      end if;
      if new.version <> old.version + 1 then
        raise exception 'release updates require one monotonic version step' using errcode = '55000';
      end if;
      return new;
    end;
    $release_immutability$;

    create trigger fuma_releases_immutability
    before update or delete on fuma_releases
    for each row execute function fuma_releases_enforce_immutability();
  `,
}
