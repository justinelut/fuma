import type { HostedMigration } from '../migrationPolicy'

export const tenantKeysMigration: HostedMigration = {
  id: '000009_tenant_keys',
  description: 'Create tenant owner keys, resource mappings, and resumable backfill receipts',
  sql: `
    create table fuma_tenant_owner_keys (
      platform_id text not null,
      owner_key text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      state text not null default 'active' check (state in ('active', 'transferring')),
      generation bigint not null default 1 check (generation > 0),
      transfer_id text null,
      transfer_lock_id text null,
      transfer_fence bigint null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (platform_id, owner_key),
      constraint fuma_tenant_owner_keys_coordinates_unique
        unique (platform_id, organization_id, workspace_id, site_id),
      constraint fuma_tenant_owner_keys_qualified_reference_unique
        unique (platform_id, owner_key, organization_id, workspace_id, site_id),
      constraint fuma_tenant_owner_keys_site_authority_fk
        foreign key (organization_id, workspace_id, site_id)
        references fuma_sites(organization_id, workspace_id, id)
        on delete restrict
        deferrable initially deferred,
      constraint fuma_tenant_owner_keys_nonempty check (
        btrim(platform_id) <> ''
        and btrim(owner_key) <> ''
        and btrim(organization_id) <> ''
        and btrim(workspace_id) <> ''
        and btrim(site_id) <> ''
        and (transfer_id is null or btrim(transfer_id) <> '')
        and (transfer_lock_id is null or btrim(transfer_lock_id) <> '')
      ),
      constraint fuma_tenant_owner_keys_transfer_shape check (
        (state = 'active'
          and transfer_id is null
          and transfer_lock_id is null
          and transfer_fence is null)
        or (state = 'transferring'
          and transfer_id is not null
          and transfer_lock_id is not null
          and transfer_fence is not null
          and transfer_fence > 0)
      )
    );

    create unique index fuma_tenant_owner_keys_transfer_fence_unique
      on fuma_tenant_owner_keys (
        platform_id,
        transfer_id,
        transfer_lock_id,
        transfer_fence,
        owner_key
      )
      where state = 'transferring';

    create table fuma_tenant_resource_owners (
      platform_id text not null,
      owner_key text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      resource_kind text not null check (resource_kind in ('table-row', 'object')),
      class_id text not null,
      source_name text not null,
      legacy_id text not null,
      legacy_identity_json jsonb not null,
      object_key text null,
      content_hash text null,
      size_bytes bigint null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      primary key (platform_id, owner_key, class_id, legacy_id),
      constraint fuma_tenant_resource_owners_owner_fk
        foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(
          platform_id, owner_key, organization_id, workspace_id, site_id
        )
        on update cascade
        on delete restrict,
      constraint fuma_tenant_resource_owners_nonempty check (
        btrim(platform_id) <> ''
        and btrim(owner_key) <> ''
        and btrim(organization_id) <> ''
        and btrim(workspace_id) <> ''
        and btrim(site_id) <> ''
        and btrim(class_id) <> ''
        and btrim(source_name) <> ''
        and btrim(legacy_id) <> ''
      ),
      constraint fuma_tenant_resource_owners_identity_object check (
        jsonb_typeof(legacy_identity_json) = 'object'
      ),
      constraint fuma_tenant_resource_owners_hash_shape check (
        content_hash is null or content_hash ~ '^[a-f0-9]{64}$'
      ),
      constraint fuma_tenant_resource_owners_kind_shape check (
        (resource_kind = 'table-row'
          and object_key is null
          and size_bytes is null)
        or (resource_kind = 'object'
          and object_key is not null
          and btrim(object_key) <> ''
          and content_hash is not null
          and size_bytes is not null
          and size_bytes >= 0)
      )
    );

    create index fuma_tenant_resource_owners_organization_idx
      on fuma_tenant_resource_owners (
        platform_id,
        organization_id,
        owner_key,
        resource_kind,
        class_id,
        legacy_id
      );

    create index fuma_tenant_resource_owners_workspace_idx
      on fuma_tenant_resource_owners (
        platform_id,
        organization_id,
        workspace_id,
        owner_key,
        resource_kind,
        class_id,
        legacy_id
      );

    create index fuma_tenant_resource_owners_site_idx
      on fuma_tenant_resource_owners (
        platform_id,
        organization_id,
        workspace_id,
        site_id,
        owner_key,
        resource_kind,
        class_id,
        legacy_id
      );

    create unique index fuma_tenant_resource_owners_object_key_unique
      on fuma_tenant_resource_owners (
        platform_id,
        organization_id,
        workspace_id,
        site_id,
        owner_key,
        object_key
      )
      where resource_kind = 'object';

    create table fuma_tenant_key_backfills (
      platform_id text not null,
      id text not null,
      owner_key text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      source_fingerprint text not null,
      inventory_version text not null,
      state text not null default 'pending' check (
        state in ('pending', 'running', 'complete', 'failed')
      ),
      expected_class_count integer not null check (expected_class_count >= 0),
      completed_class_count integer not null default 0 check (completed_class_count >= 0),
      expected_resource_count bigint not null check (expected_resource_count >= 0),
      mapped_resource_count bigint not null default 0 check (mapped_resource_count >= 0),
      failure_json jsonb null,
      started_at timestamptz null,
      updated_at timestamptz not null default current_timestamp,
      completed_at timestamptz null,
      primary key (platform_id, id),
      constraint fuma_tenant_key_backfills_owner_fk
        foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(
          platform_id, owner_key, organization_id, workspace_id, site_id
        )
        on update cascade
        on delete restrict,
      constraint fuma_tenant_key_backfills_source_unique
        unique (platform_id, owner_key, source_fingerprint, inventory_version),
      constraint fuma_tenant_key_backfills_nonempty check (
        btrim(platform_id) <> ''
        and btrim(id) <> ''
        and btrim(owner_key) <> ''
        and btrim(organization_id) <> ''
        and btrim(workspace_id) <> ''
        and btrim(site_id) <> ''
        and source_fingerprint ~ '^[a-f0-9]{64}$'
        and btrim(inventory_version) <> ''
      ),
      constraint fuma_tenant_key_backfills_failure_object check (
        failure_json is null or jsonb_typeof(failure_json) = 'object'
      ),
      constraint fuma_tenant_key_backfills_progress check (
        completed_class_count <= expected_class_count
        and mapped_resource_count <= expected_resource_count
      ),
      constraint fuma_tenant_key_backfills_state_shape check (
        (state = 'pending'
          and completed_class_count = 0
          and mapped_resource_count = 0
          and failure_json is null
          and started_at is null
          and completed_at is null)
        or (state = 'running'
          and failure_json is null
          and started_at is not null
          and completed_at is null)
        or (state = 'complete'
          and completed_class_count = expected_class_count
          and mapped_resource_count = expected_resource_count
          and failure_json is null
          and started_at is not null
          and completed_at is not null)
        or (state = 'failed'
          and failure_json is not null
          and started_at is not null
          and completed_at is null)
      )
    );

    create index fuma_tenant_key_backfills_site_state_idx
      on fuma_tenant_key_backfills (
        platform_id,
        organization_id,
        workspace_id,
        site_id,
        owner_key,
        state,
        updated_at,
        id
      );

    create table fuma_tenant_key_backfill_receipts (
      platform_id text not null,
      backfill_id text not null,
      class_id text not null,
      source_name text not null,
      state text not null default 'pending' check (
        state in ('pending', 'running', 'complete', 'failed')
      ),
      resume_cursor_json jsonb null,
      source_count bigint not null default 0 check (source_count >= 0),
      mapped_count bigint not null default 0 check (mapped_count >= 0),
      source_content_hash text null,
      mapped_content_hash text null,
      source_foreign_key_count bigint not null default 0 check (source_foreign_key_count >= 0),
      valid_foreign_key_count bigint not null default 0 check (valid_foreign_key_count >= 0),
      foreign_key_evidence_json jsonb not null default '[]'::jsonb,
      failure_json jsonb null,
      updated_at timestamptz not null default current_timestamp,
      completed_at timestamptz null,
      primary key (platform_id, backfill_id, class_id),
      constraint fuma_tenant_key_backfill_receipts_run_fk
        foreign key (platform_id, backfill_id)
        references fuma_tenant_key_backfills(platform_id, id)
        on delete restrict,
      constraint fuma_tenant_key_backfill_receipts_nonempty check (
        btrim(platform_id) <> ''
        and btrim(backfill_id) <> ''
        and btrim(class_id) <> ''
        and btrim(source_name) <> ''
      ),
      constraint fuma_tenant_key_backfill_receipts_cursor_object check (
        resume_cursor_json is null or jsonb_typeof(resume_cursor_json) = 'object'
      ),
      constraint fuma_tenant_key_backfill_receipts_hash_shape check (
        (source_content_hash is null or source_content_hash ~ '^[a-f0-9]{64}$')
        and (mapped_content_hash is null or mapped_content_hash ~ '^[a-f0-9]{64}$')
      ),
      constraint fuma_tenant_key_backfill_receipts_fk_evidence_array check (
        jsonb_typeof(foreign_key_evidence_json) = 'array'
      ),
      constraint fuma_tenant_key_backfill_receipts_failure_object check (
        failure_json is null or jsonb_typeof(failure_json) = 'object'
      ),
      constraint fuma_tenant_key_backfill_receipts_progress check (
        mapped_count <= source_count
        and valid_foreign_key_count <= source_foreign_key_count
      ),
      constraint fuma_tenant_key_backfill_receipts_state_shape check (
        (state = 'pending'
          and mapped_count = 0
          and valid_foreign_key_count = 0
          and resume_cursor_json is null
          and source_content_hash is null
          and mapped_content_hash is null
          and failure_json is null
          and completed_at is null)
        or (state = 'running'
          and failure_json is null
          and completed_at is null)
        or (state = 'complete'
          and source_count = mapped_count
          and source_content_hash is not null
          and source_content_hash = mapped_content_hash
          and source_foreign_key_count = valid_foreign_key_count
          and failure_json is null
          and completed_at is not null)
        or (state = 'failed'
          and failure_json is not null
          and completed_at is null)
      )
    );

    create index fuma_tenant_key_backfill_receipts_resume_idx
      on fuma_tenant_key_backfill_receipts (
        platform_id,
        backfill_id,
        state,
        updated_at,
        class_id
      )
      where state <> 'complete';

    create function fuma_tenant_key_backfill_receipts_validate_completion()
    returns trigger
    language plpgsql
    as $tenant_key_receipt_completion$
    declare
      evidence jsonb;
      checked_total bigint := 0;
      valid_total bigint := 0;
      parent_state text;
    begin
      if tg_op = 'UPDATE' and old.state = 'complete' then
        raise exception 'completed tenant-key class receipts are immutable'
          using errcode = '55000';
      end if;

      select state into parent_state
      from fuma_tenant_key_backfills
      where platform_id = new.platform_id and id = new.backfill_id
      for update;

      if parent_state = 'complete' then
        raise exception 'completed tenant-key backfill receipts are immutable'
          using errcode = '55000';
      end if;

      if new.state <> 'complete' then
        return new;
      end if;

      for evidence in select value from jsonb_array_elements(new.foreign_key_evidence_json)
      loop
        if jsonb_typeof(evidence) <> 'object'
          or btrim(coalesce(evidence ->> 'sourceClassId', '')) = ''
          or jsonb_typeof(evidence -> 'sourceColumns') <> 'array'
          or jsonb_array_length(evidence -> 'sourceColumns') = 0
          or btrim(coalesce(evidence ->> 'targetClassId', '')) = ''
          or jsonb_typeof(evidence -> 'targetColumns') <> 'array'
          or jsonb_array_length(evidence -> 'targetColumns') = 0
          or coalesce(evidence ->> 'checkedCount', '') !~ '^[0-9]+$'
          or coalesce(evidence ->> 'validCount', '') !~ '^[0-9]+$'
        then
          raise exception 'tenant-key foreign-key evidence is malformed'
            using errcode = '23514';
        end if;
        checked_total := checked_total + (evidence ->> 'checkedCount')::bigint;
        valid_total := valid_total + (evidence ->> 'validCount')::bigint;
      end loop;

      if checked_total <> new.source_foreign_key_count
        or valid_total <> new.valid_foreign_key_count
      then
        raise exception 'tenant-key foreign-key evidence does not reconcile with receipt totals'
          using errcode = '23514';
      end if;
      return new;
    end;
    $tenant_key_receipt_completion$;

    create trigger fuma_tenant_key_backfill_receipts_validate_completion
      before insert or update on fuma_tenant_key_backfill_receipts
      for each row
      execute function fuma_tenant_key_backfill_receipts_validate_completion();

    create function fuma_tenant_key_backfills_validate_completion()
    returns trigger
    language plpgsql
    as $tenant_key_run_completion$
    declare
      receipt_count bigint;
      receipt_resource_count bigint;
      incomplete_receipt_count bigint;
    begin
      if tg_op = 'UPDATE' and old.state = 'complete' then
        raise exception 'completed tenant-key backfills are immutable'
          using errcode = '55000';
      end if;

      if new.state <> 'complete' then
        return new;
      end if;

      select
        count(*),
        coalesce(sum(mapped_count), 0),
        count(*) filter (where state <> 'complete')
      into receipt_count, receipt_resource_count, incomplete_receipt_count
      from fuma_tenant_key_backfill_receipts
      where platform_id = new.platform_id and backfill_id = new.id;

      if receipt_count <> new.expected_class_count
        or receipt_count <> new.completed_class_count
        or receipt_resource_count <> new.expected_resource_count
        or receipt_resource_count <> new.mapped_resource_count
        or incomplete_receipt_count <> 0
      then
        raise exception 'tenant-key backfill completion does not reconcile with class receipts'
          using errcode = '23514';
      end if;
      return new;
    end;
    $tenant_key_run_completion$;

    create trigger fuma_tenant_key_backfills_validate_completion
      before insert or update on fuma_tenant_key_backfills
      for each row
      execute function fuma_tenant_key_backfills_validate_completion();
  `,
}
