import { publicationCollaborationMigration } from '../db/migrations/000013_publication_collaboration'
import { publicationContentMigration } from '../db/migrations/000014_publication_content'
import { publicationWorkflowMigration } from '../db/migrations/000015_publication_workflows'
import { publicationAudienceMigration } from '../db/migrations/000016_publication_audience'
import { publicationAnalyticsMigration } from '../db/migrations/000017_publication_analytics'
import { publicationNewslettersMigration } from '../db/migrations/000018_publication_newsletters'
import { publicationCampaignsMigration } from '../db/migrations/000019_publication_campaigns'
import { publicationDeliverabilityMigration } from '../db/migrations/000020_publication_deliverability'
import { publicationUniversalContentMigration } from '../db/migrations/000040_publication_universal_content'
import { publicationRevisionsMigration } from '../db/migrations/000041_publication_revisions'
import { publicationLifecycleMetadataMigration } from '../db/migrations/000044_publication_lifecycle_metadata'

export const PUBLICATION_PHASE_MIGRATIONS = Object.freeze([
  publicationCollaborationMigration,
  publicationContentMigration,
  publicationWorkflowMigration,
  publicationAudienceMigration,
  publicationAnalyticsMigration,
  publicationNewslettersMigration,
  publicationCampaignsMigration,
  publicationDeliverabilityMigration,
  publicationUniversalContentMigration,
  publicationRevisionsMigration,
  publicationLifecycleMetadataMigration,
])

export const PUBLICATION_PHASE_MIGRATION_CHECKSUMS: Readonly<Record<string,string>> = Object.freeze({
  '000013_publication_collaboration':'451a3c44f01e73a94a2b7ea7eadeecc532be1dbcbaa7a868d72fe52c8a13d47f',
  '000014_publication_content':'125b4074ff43a02394eb18725552157a1ede129135fc2c8ba7b5ef09ad27f1d1',
  '000015_publication_workflows':'8db721e014ab3e8879d6352f7d45f8e72a5ddc4714f18a8bde5dbca034cbfe0f',
  '000016_publication_audience':'2ea6e7d6198d8af94637d090c9f24646c3e38e4c7093d0c60676f5abf3e6a0dc',
  '000017_publication_analytics':'ba4016348e82f88a5551fe1939a230c2c1a0a0839be7333a310220ec5324f373',
  '000018_publication_newsletters':'7f38648cdeef768e3aedda14067cdf3f7c863cafa49a497845d24a326dd44847',
  '000019_publication_campaigns':'4a189a7a6d65ae9a9a5597a3749a5767e69b79fce8aea72498ab680f18617328',
  '000020_publication_deliverability':'3ebe7a042aee394188179d4f4550a7a4e5055cd76cda6badb0b7332fddb4cb75',
  '000040_publication_universal_content':'002244022f0c0a799cf0a2e8b3601736225ef97fd03cef6c3c6dc2112161d233',
  '000041_publication_revisions': '7ea67a5fd66af9c8be2515a1b303baf2831363fe9b1a23437d97c47cb47966cc',
  '000044_publication_lifecycle_metadata': 'fa352e5abdc480422c3d514b7d48b4105f361cbda05204a699d7e7665e5355fe',
})
