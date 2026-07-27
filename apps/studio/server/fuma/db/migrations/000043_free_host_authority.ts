import type { HostedMigration } from '../migrationPolicy'

export const freeHostAuthorityMigration: HostedMigration = Object.freeze({
  id: '000043_free_host_authority',
  description: 'Bind free hosts to owner generation and monotonic suspension authority',
  sql: `
    alter table fuma_free_hosts
      add column owner_generation bigint null check (owner_generation > 0),
      add column allocation_version bigint not null default 1 check (allocation_version > 0),
      add column state_updated_at timestamptz not null default current_timestamp;

    alter table fuma_free_hosts
      add constraint fuma_free_hosts_reviewed_operational_names check (
        label not in (
          'auth', 'app', 'admin', 'www', 'api', 'status', 'support', 'mail',
          'assets', 'billing', 'cdn', 'checkout', 'console', 'dashboard', 'docs',
          'edge', 'help', 'hooks', 'mcp', 'media', 'objects', 'preview',
          'scheduler', 'static', 'uploads', 'webhook', 'webhooks', 'worker'
        )
        and label !~ '^xn--'
        and label !~ '^fuma(?:-|$)'
      ) not valid;

    create index fuma_free_hosts_active_authority_idx
      on fuma_free_hosts (
        host, platform_id, organization_id, workspace_id, site_id,
        owner_key, owner_generation, allocation_version
      ) where state = 'active' and owner_generation is not null;
  `,
})
