import type { HostedMigration } from '../migrationPolicy'

/** Finalized by the conductor after live PostgreSQL acceptance. */
export const publicationCampaignDeliveryControlMigration: HostedMigration = Object.freeze({
  id: '000053_publication_campaign_delivery_control',
  description: 'Add immutable campaign audience/content hashes and message-size accounting',
  sql: `
    alter table fuma_publication_campaigns
      add column audience_sha256 text not null default repeat('0', 64)
        check (audience_sha256 ~ '^[a-f0-9]{64}$'),
      add column content_sha256 text not null default repeat('0', 64)
        check (content_sha256 ~ '^[a-f0-9]{64}$'),
      add column message_size_bytes integer not null default 1
        check (message_size_bytes between 1 and 2097152);

    alter table fuma_publication_campaigns
      alter column audience_sha256 drop default,
      alter column content_sha256 drop default,
      alter column message_size_bytes drop default;
  `,
})
