import type { HostedMigration } from '../migrationPolicy'

/**
 * Conductor-finalized additive public template release authority.
 */
export const publicTemplateReleasesMigration: HostedMigration = {
  id: '000056_public_template_releases',
  description: 'Create approved immutable public template release authority',
  sql: `
    create table fuma_public_template_releases (
      template_id text primary key,
      slug text not null unique,
      platform_id text not null,
      owner_key text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      release_id text not null,
      public_json jsonb not null check (jsonb_typeof(public_json) = 'object'),
      manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
      state text not null check (state in ('approved', 'withdrawn')),
      version bigint not null check (version > 0),
      approved_at timestamptz not null,
      withdrawn_at timestamptz null,
      updated_at timestamptz not null,
      foreign key (platform_id, owner_key, organization_id, workspace_id, site_id, release_id)
        references fuma_releases(platform_id, owner_key, organization_id, workspace_id, site_id, release_id)
        on update cascade on delete restrict,
      check (
        btrim(template_id) <> '' and btrim(slug) <> ''
        and btrim(platform_id) <> '' and btrim(owner_key) <> ''
        and btrim(organization_id) <> '' and btrim(workspace_id) <> ''
        and btrim(site_id) <> '' and btrim(release_id) <> ''
      ),
      check ((state = 'approved' and withdrawn_at is null) or (state = 'withdrawn' and withdrawn_at is not null)),
      check (public_json ->> 'id' = template_id),
      check (public_json ->> 'slug' = slug),
      check (public_json ->> 'releaseId' = release_id)
    );
    create index fuma_public_template_releases_discovery_idx
      on fuma_public_template_releases (state, slug, template_id);

    create function fuma_public_template_releases_guard()
    returns trigger
    language plpgsql
    as $public_template_guard$
    begin
      if tg_op = 'DELETE' then
        raise exception 'public template evidence is immutable' using errcode = '55000';
      end if;
      if new.template_id <> old.template_id or new.slug <> old.slug or new.approved_at <> old.approved_at then
        raise exception 'public template identity and first approval are immutable' using errcode = '55000';
      end if;
      if new.version <> old.version + 1 then
        raise exception 'public template updates require one monotonic version step' using errcode = '55000';
      end if;
      if old.state = 'withdrawn' then
        raise exception 'withdrawn public templates are immutable tombstones' using errcode = '55000';
      end if;
      if new.state = 'approved' and new.release_id = old.release_id then
        raise exception 'template reapproval requires a different exact release' using errcode = '55000';
      end if;
      return new;
    end;
    $public_template_guard$;

    create trigger fuma_public_template_releases_guard
    before update or delete on fuma_public_template_releases
    for each row execute function fuma_public_template_releases_guard();
  `,
}
