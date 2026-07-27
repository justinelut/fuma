import type { HostedMigration } from '../migrationPolicy'

/**
 * Candidate only: primary integration must register and checksum-finalize this migration.
 * The FUMA-044 stream reserves 000052 and intentionally does not edit the central registry.
 */
export const publicationNewsletterComposerMigration: HostedMigration = Object.freeze({
  id: '000052_publication_newsletter_composer',
  description: 'Add exact-scope newsletter profiles, composer draft CAS, sender verification, and immutable autosave receipts',
  sql: `
    create table fuma_publication_newsletter_composers (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null,
      newsletter_id text not null,
      name text not null,
      slug text not null,
      description text not null default '',
      status text not null check (status in ('active','paused','archived')),
      default_segment_id text,
      web_content_id text,
      version bigint not null check (version > 0),
      created_by text not null,
      created_at timestamptz not null,
      updated_by text not null,
      updated_at timestamptz not null,
      primary key (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id),
      unique (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,slug),
      foreign key (platform_id,owner_key,organization_id,workspace_id,site_id)
        references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id)
        on update cascade on delete restrict,
      foreign key (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,default_segment_id)
        references fuma_publication_member_segments(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,segment_id)
        on update cascade on delete restrict
    );

    create table fuma_publication_newsletter_drafts (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null,
      newsletter_id text not null,
      draft_id text not null,
      sequence bigint not null check (sequence > 0),
      subject text not null,
      preview_text text not null,
      document_json jsonb not null check (jsonb_typeof(document_json)='object'),
      audience_json jsonb not null check (jsonb_typeof(audience_json)='object'),
      updated_by text not null,
      updated_at timestamptz not null,
      primary key (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id),
      unique (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,draft_id),
      foreign key (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id)
        references fuma_publication_newsletter_composers(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id)
        on update cascade on delete restrict
    );

    create table fuma_publication_newsletter_draft_mutations (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null,
      newsletter_id text not null,
      mutation_id text not null,
      command_sha256 text not null check (command_sha256 ~ '^[a-f0-9]{64}$'),
      accepted_sequence bigint not null check (accepted_sequence > 0),
      result_json jsonb not null check (jsonb_typeof(result_json)='object'),
      created_at timestamptz not null,
      primary key (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id,mutation_id),
      foreign key (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id)
        references fuma_publication_newsletter_composers(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,newsletter_id)
        on update cascade on delete restrict
    );

    create table fuma_publication_newsletter_sender_verifications (
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation > 0),
      profile_id text not null,
      sender_email text not null check (sender_email=lower(sender_email)),
      state text not null check (state in ('pending','verified','failed','revoked')),
      provider_identity_id text not null,
      verified_at timestamptz,
      checked_at timestamptz not null,
      primary key (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,sender_email),
      foreign key (platform_id,owner_key,organization_id,workspace_id,site_id)
        references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id)
        on update cascade on delete restrict,
      check ((state='verified' and verified_at is not null) or (state<>'verified' and verified_at is null))
    );

    create function fuma_publication_newsletter_mutations_deny_change() returns trigger language plpgsql as $$
    begin
      raise exception 'newsletter autosave receipts are immutable';
    end;
    $$;
    create trigger fuma_publication_newsletter_mutations_immutable
      before update or delete on fuma_publication_newsletter_draft_mutations
      for each row execute function fuma_publication_newsletter_mutations_deny_change();
  `,
})
