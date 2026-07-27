import type { HostedMigration } from '../migrationPolicy'

export const publicationWorkflowMigration: HostedMigration = {
  id: '000015_publication_workflows',
  description: 'Create immutable publication workflows and schedules',
  sql: `
    create table fuma_publication_workflow_transitions (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      transition_id text not null, content_id text not null, from_status text not null, to_status text not null,
      actor_id text not null, expected_version bigint not null check (expected_version > 0), scheduled_at timestamptz,
      note text not null default '', created_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, transition_id),
      foreign key (platform_id, owner_key, owner_generation, profile_id, content_id)
        references fuma_publication_content(platform_id, owner_key, owner_generation, profile_id, content_id) on delete restrict
    );
    create table fuma_publication_schedules (
      platform_id text not null, owner_key text not null, owner_generation bigint not null, profile_id text not null,
      content_id text not null, workflow_version bigint not null check (workflow_version > 0), run_at timestamptz not null,
      job_id text not null, state text not null check (state in ('pending','claimed','published','cancelled','failed')),
      claim_fence bigint, created_at timestamptz not null, updated_at timestamptz not null,
      primary key (platform_id, owner_key, owner_generation, profile_id, content_id, workflow_version),
      unique (job_id),
      foreign key (platform_id, owner_key, owner_generation, profile_id, content_id)
        references fuma_publication_content(platform_id, owner_key, owner_generation, profile_id, content_id) on delete restrict
    );
    create index fuma_publication_schedules_due_idx on fuma_publication_schedules (state, run_at);
  `,
}
