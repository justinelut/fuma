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

/** FUMA-039: exact-scope member profile, segment, access, and privacy authority. */
export const memberAccountsAccessMigration: HostedMigration = Object.freeze({
  id: '000047_member_accounts_access',
  description: 'Add scoped member accounts consent segments access and privacy workflows',
  sql: `
    create table fuma_publication_member_accounts (${scopeColumns},
      account_id text not null,
      member_identity_id text not null,
      member_id text not null,
      display_name text not null default '',
      locale text not null,
      timezone text not null,
      state text not null check (state in ('active','disabled','deletion-pending','deleted')),
      created_at timestamptz not null,
      updated_at timestamptz not null,
      deleted_at timestamptz,
      primary key (${scopeKeys}, account_id),
      unique (${scopeKeys}, member_identity_id),
      unique (${scopeKeys}, member_id),
      unique (${scopeKeys}, account_id, member_id),
      foreign key (${scopeKeys}, member_identity_id)
        references fuma_member_identities(${scopeKeys}, member_identity_id) on update cascade on delete restrict,
      foreign key (platform_id, owner_key, owner_generation, profile_id, member_id)
        references fuma_publication_members(platform_id, owner_key, owner_generation, profile_id, member_id)
        on update cascade on delete restrict,
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict,
      check ((state='deleted' and deleted_at is not null) or (state<>'deleted' and deleted_at is null))
    );

    create table fuma_publication_newsletter_consent_events (${scopeColumns},
      event_id text not null,
      account_id text not null,
      member_id text not null,
      newsletter_id text,
      action text not null check (action in ('subscribed','unsubscribed')),
      source text not null check (source in ('member-profile','staff','staff-import','one-click')),
      notice_version text not null,
      source_receipt_id text,
      occurred_at timestamptz not null,
      primary key (${scopeKeys}, event_id),
      foreign key (${scopeKeys}, account_id, member_id)
        references fuma_publication_member_accounts(${scopeKeys}, account_id, member_id) on update cascade on delete restrict,
      check (((source in ('staff-import','one-click')) and source_receipt_id is not null)
        or ((source in ('member-profile','staff')) and source_receipt_id is null))
    );
    create index fuma_publication_newsletter_consent_latest_idx
      on fuma_publication_newsletter_consent_events (${scopeKeys}, member_id, newsletter_id, occurred_at desc, event_id desc);

    create table fuma_publication_member_segments (${scopeColumns},
      segment_id text not null,
      name text not null,
      kind text not null check (kind in ('explicit','dynamic')),
      match_kind text not null check (match_kind in ('all','any')),
      rules_json jsonb not null,
      explicit_member_ids_json jsonb not null,
      version bigint not null check (version > 0),
      recalculated_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (${scopeKeys}, segment_id),
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id)
        references fuma_tenant_owner_keys(platform_id, owner_key, organization_id, workspace_id, site_id)
        on update cascade on delete restrict,
      check (jsonb_typeof(rules_json)='array' and jsonb_typeof(explicit_member_ids_json)='array'),
      check ((kind='explicit' and jsonb_array_length(rules_json)=0)
        or (kind='dynamic' and jsonb_array_length(rules_json)>0 and jsonb_array_length(explicit_member_ids_json)=0))
    );

    create table fuma_publication_segment_memberships (${scopeColumns},
      segment_id text not null,
      member_id text not null,
      segment_version bigint not null check (segment_version > 0),
      calculated_at timestamptz not null,
      primary key (${scopeKeys}, segment_id, member_id),
      foreign key (${scopeKeys}, segment_id)
        references fuma_publication_member_segments(${scopeKeys}, segment_id) on update cascade on delete cascade,
      foreign key (${scopeKeys}, member_id)
        references fuma_publication_member_accounts(${scopeKeys}, member_id) on update cascade on delete cascade
    );
    create index fuma_publication_segment_memberships_member_idx
      on fuma_publication_segment_memberships (${scopeKeys}, member_id, segment_id);

    create table fuma_publication_member_access (${scopeColumns},
      access_id text not null,
      member_id text not null,
      source text not null check (source in ('complimentary','manual','paid')),
      state text not null check (state in ('active','grace','expired','revoked')),
      resource_kind text not null check (resource_kind in ('publication','post','tag')),
      resource_id text not null,
      access text not null check (access in ('read','premium')),
      starts_at timestamptz not null,
      expires_at timestamptz,
      grace_ends_at timestamptz,
      payment_reference_sha256 text check (payment_reference_sha256 is null or payment_reference_sha256 ~ '^[a-f0-9]{64}$'),
      created_at timestamptz not null,
      updated_at timestamptz not null,
      primary key (${scopeKeys}, access_id),
      foreign key (${scopeKeys}, member_id)
        references fuma_publication_member_accounts(${scopeKeys}, member_id) on update cascade on delete restrict,
      check (expires_at is null or starts_at < expires_at),
      check (grace_ends_at is null or (expires_at is not null and expires_at < grace_ends_at)),
      check ((source='paid' and payment_reference_sha256 is not null)
        or (source<>'paid' and payment_reference_sha256 is null)),
      check (state<>'grace' or grace_ends_at is not null)
    );
    create index fuma_publication_member_access_evaluator_idx
      on fuma_publication_member_access (${scopeKeys}, member_id, resource_kind, resource_id, state, expires_at, grace_ends_at);

    create table fuma_publication_privacy_requests (${scopeColumns},
      request_id text not null,
      account_id text not null,
      member_id text not null,
      kind text not null check (kind in ('export','deletion')),
      state text not null check (state in ('pending','processing','completed','failed')),
      requested_by text not null check (requested_by in ('member','staff')),
      reason text not null,
      created_at timestamptz not null,
      completed_at timestamptz,
      primary key (${scopeKeys}, request_id),
      foreign key (${scopeKeys}, account_id, member_id)
        references fuma_publication_member_accounts(${scopeKeys}, account_id, member_id) on update cascade on delete restrict,
      check ((state='completed' and completed_at is not null) or (state<>'completed' and completed_at is null))
    );
    create unique index fuma_publication_privacy_open_deletion_idx
      on fuma_publication_privacy_requests (${scopeKeys}, account_id)
      where kind='deletion' and state in ('pending','processing');

    create function fuma_publication_member_provenance_reject_mutation() returns trigger
    language plpgsql as $$
    begin raise exception 'publication member consent provenance is append-only'; end;
    $$;
    create trigger fuma_publication_newsletter_consent_events_immutable
      before update or delete on fuma_publication_newsletter_consent_events
      for each row execute function fuma_publication_member_provenance_reject_mutation();
  `,
})
