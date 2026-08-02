import type { HostedMigration } from "../migrationPolicy";

/** Conductor-finalized additive FUMA-063 AI catalog authority. */
export const aiCatalogAuthorityMigration: HostedMigration =
  Object.freeze({
    id: "000063_ai_catalog_authority",
    description: "Add versioned platform AI catalog authority",
    sql: `
    create table fuma_ai_catalog_providers_v2 (
      provider_id text primary key,
      display_name text not null,
      enabled boolean not null default false,
      credential_authority_id text null,
      stale_after_seconds integer not null check (stale_after_seconds between 60 and 2592000),
      current_refresh_id text null,
      control_version bigint not null default 1 check (control_version > 0),
      created_at timestamptz not null,
      updated_at timestamptz not null,
      check (btrim(provider_id) <> '' and btrim(display_name) <> '')
    );

    create table fuma_ai_catalog_refreshes_v2 (
      refresh_id text primary key,
      provider_id text not null references fuma_ai_catalog_providers_v2(provider_id) on delete restrict,
      idempotency_key text not null,
      source_sequence bigint null check (source_sequence is null or source_sequence > 0),
      source_observed_at timestamptz null,
      catalog_hash_sha256 text null check (catalog_hash_sha256 is null or catalog_hash_sha256 ~ '^[a-f0-9]{64}$'),
      state text not null check (state in ('applied','rejected-stale','failed')),
      model_count integer not null check (model_count between 0 and 20000),
      error_code text null,
      actor_id text not null,
      completed_at timestamptz not null,
      unique (provider_id, idempotency_key),
      unique (provider_id, refresh_id),
      check (
        (state in ('applied','rejected-stale') and source_sequence is not null
          and source_observed_at is not null and catalog_hash_sha256 is not null and error_code is null)
        or
        (state = 'failed' and source_sequence is null and source_observed_at is null
          and catalog_hash_sha256 is null and model_count = 0 and error_code is not null)
      )
    );

    alter table fuma_ai_catalog_providers_v2
      add constraint fuma_ai_catalog_provider_current_refresh_v2
      foreign key (provider_id, current_refresh_id)
      references fuma_ai_catalog_refreshes_v2(provider_id, refresh_id) on delete restrict;

    create table fuma_ai_catalog_model_controls_v2 (
      provider_id text not null references fuma_ai_catalog_providers_v2(provider_id) on delete restrict,
      model_id text not null,
      enabled boolean not null default false,
      included boolean not null default false,
      visibility text not null default 'platform' check (visibility in ('public','customer','platform')),
      allowed_profiles_json jsonb not null,
      control_version bigint not null default 1 check (control_version > 0),
      updated_at timestamptz not null,
      primary key (provider_id, model_id),
      check (btrim(model_id) <> ''),
      check (jsonb_typeof(allowed_profiles_json) = 'array'),
      check (jsonb_array_length(allowed_profiles_json) between 1 and 2),
      check (allowed_profiles_json <@ '["website","publication"]'::jsonb)
    );

    create table fuma_ai_catalog_model_versions_v2 (
      provider_id text not null,
      model_id text not null,
      refresh_id text not null,
      display_name text not null,
      capabilities_json jsonb not null,
      context_window_tokens bigint not null check (context_window_tokens between 1 and 100000000),
      input_micros_per_million bigint not null check (input_micros_per_million >= 0),
      output_micros_per_million bigint not null check (output_micros_per_million >= 0),
      markup_basis_points integer not null check (markup_basis_points between 0 and 100000),
      source_observed_at timestamptz not null,
      primary key (provider_id, model_id, refresh_id),
      foreign key (provider_id, refresh_id)
        references fuma_ai_catalog_refreshes_v2(provider_id, refresh_id) on delete restrict,
      check (btrim(model_id) <> '' and btrim(display_name) <> ''),
      check (jsonb_typeof(capabilities_json) = 'object'),
      check (capabilities_json ?& array['toolCalling','visionInput','toolResultImages','promptCache','streaming','jsonOutput'])
    );

    create table fuma_ai_catalog_defaults_v2 (
      profile_id text not null check (profile_id in ('website','publication')),
      target_kind text not null check (target_kind in ('platform','organization','workspace','site')),
      target_scope_id text not null,
      provider_id text not null,
      model_id text not null,
      selection_version bigint not null default 1 check (selection_version > 0),
      updated_at timestamptz not null,
      primary key (profile_id, target_kind, target_scope_id),
      foreign key (provider_id, model_id)
        references fuma_ai_catalog_model_controls_v2(provider_id, model_id) on delete restrict,
      check ((target_kind = 'platform' and target_scope_id = '')
        or (target_kind <> 'platform' and btrim(target_scope_id) <> ''))
    );

    create index fuma_ai_catalog_refresh_history_v2
      on fuma_ai_catalog_refreshes_v2 (provider_id, completed_at desc);
    create index fuma_ai_catalog_model_current_v2
      on fuma_ai_catalog_model_versions_v2 (provider_id, refresh_id, model_id);
    create index fuma_ai_catalog_default_scope_v2
      on fuma_ai_catalog_defaults_v2 (target_kind, target_scope_id, profile_id);

    create function fuma_ai_catalog_immutable_history_v2()
    returns trigger language plpgsql as $ai_catalog_immutable_history$
    begin
      raise exception 'AI catalog refresh/version history is append-only' using errcode = '55000';
    end;
    $ai_catalog_immutable_history$;

    create trigger fuma_ai_catalog_refresh_history_immutable_v2
      before update or delete on fuma_ai_catalog_refreshes_v2
      for each row execute function fuma_ai_catalog_immutable_history_v2();
    create trigger fuma_ai_catalog_model_history_immutable_v2
      before update or delete on fuma_ai_catalog_model_versions_v2
      for each row execute function fuma_ai_catalog_immutable_history_v2();
  `,
  });
