import type { HostedMigration } from '../migrationPolicy'

/**
 * Additive deployment-root portability. The legacy table remains immutable;
 * runtime authority moves to v2 after an exact backfill.
 */
export const freeHostRootDomainPortabilityMigration: HostedMigration = Object.freeze({
  id: '000082_free_host_root_domain_portability',
  description: 'Add portable free-host v2 authority for configured deployment root domains',
  sql: String.raw`
create table fuma_free_hosts_v2 (
  host text primary key,
  label text not null unique check(label=lower(label)),
  platform_id text not null,
  owner_key text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_generation bigint null check(owner_generation > 0),
  state text not null check(state in ('active','suspended')),
  canonical_host text null,
  allocation_version bigint not null default 1 check(allocation_version > 0),
  created_at timestamptz not null,
  state_updated_at timestamptz not null default current_timestamp,
  unique(platform_id,organization_id,workspace_id,site_id),
  foreign key(platform_id,owner_key,organization_id,workspace_id,site_id)
    references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id)
    on update cascade on delete restrict,
  constraint fuma_free_hosts_v2_host_portable check (
    host=lower(host)
    and length(host) between 3 and 253
    and host ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  constraint fuma_free_hosts_v2_reviewed_operational_names check (
    label not in (
      'auth','app','admin','www','api','status','support','mail','assets',
      'billing','cdn','checkout','console','dashboard','docs','edge','help',
      'hooks','mcp','media','objects','preview','scheduler','static','uploads',
      'webhook','webhooks','worker'
    )
    and label !~ '^xn--'
    and label !~ '^fuma(?:-|$)'
  )
);

insert into fuma_free_hosts_v2(
  host,label,platform_id,owner_key,organization_id,workspace_id,site_id,
  owner_generation,state,canonical_host,allocation_version,created_at,state_updated_at
)
select host,label,platform_id,owner_key,organization_id,workspace_id,site_id,
  owner_generation,state,canonical_host,allocation_version,created_at,state_updated_at
from fuma_free_hosts;

create index fuma_free_hosts_v2_active_authority_idx
  on fuma_free_hosts_v2(
    host,platform_id,organization_id,workspace_id,site_id,
    owner_key,owner_generation,allocation_version
  ) where state='active' and owner_generation is not null;
`,
})
