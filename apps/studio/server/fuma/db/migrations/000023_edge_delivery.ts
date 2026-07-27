import type { HostedMigration } from '../migrationPolicy'
export const edgeDeliveryMigration:HostedMigration={id:'000023_edge_delivery',description:'Add targeted edge purge warm and rollback operations',sql:`
create table fuma_edge_operations (operation_id text primary key, organization_id text not null, site_id text not null, host text not null, release_id text null, kind text not null check(kind in ('purge','warm','rollback')), state text not null check(state in ('queued','running','succeeded','failed')), idempotency_key text not null unique, expected_release_id text null, target_release_id text null, created_at timestamptz not null, completed_at timestamptz null);
create index fuma_edge_operations_scope_idx on fuma_edge_operations(organization_id,site_id,host,created_at);
`}
