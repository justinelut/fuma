import { describe, expect, test } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { customerMerchantPaymentsV2Migration } from '../../../server/fuma/db/migrations/000061_customer_merchant_payments_v2'
import { siteAiScopeAuthorityMigration } from '../../../server/fuma/db/migrations/000068_site_ai_scope_authority'
import { artifactInstallationAuthorityMigration } from '../../../server/fuma/db/migrations/000070_artifact_installation_authority'
import { artifactReviewMarketplaceMigration } from '../../../server/fuma/db/migrations/000071_artifact_review_marketplace'
import { customerPaymentPluginMigration } from '../../../server/fuma/db/migrations/000073_customer_payment_plugin'
import { aiPaymentSetupMigration } from '../../../server/fuma/db/migrations/000074_ai_payment_setup'
import {
  AI_PAYMENT_PLUGIN_PERMISSIONS,
  PostgresAiPaymentSetupRepository,
  type AiPaymentSetupHandoff,
  type AiPaymentSetupProposal,
} from '../../../server/fuma/aiPaymentSetup'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL
const NOW = '2026-08-01T08:00:00.000Z'
const HASH = 'a'.repeat(64)
const scope = Object.freeze({
  platformId: 'platform-pg', organizationId: 'organization-pg', workspaceId: 'workspace-pg', siteId: 'site-pg',
  ownerKey: 'owner-pg', ownerGeneration: 3, profileId: 'website' as const,
})
function quote(value: string): string { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe schema.'); return `"${value}"` }
function scoped(connection: string, schema: string): string { const url = new URL(connection); url.searchParams.set('options', `-c search_path=${schema},public`); return url.toString() }
async function fulfilled<T>(values: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(values)
  const rejected = results.find((result) => result.status === 'rejected')
  if (rejected) throw rejected.reason
  return results.map((result) => (result as PromiseFulfilledResult<T>).value)
}

function proposed(id = 'ai-payment:pg-proposal'): AiPaymentSetupProposal {
  return {
    schemaVersion: 1, proposalId: id, conversationId: 'conversation-pg', toolCallId: `tool-${id}`,
    scope, actorId: 'actor-pg',
    review: {
      submissionId: 'submission-pg-payment', decisionId: 'decision-pg-payment', signatureKeyId: 'review-key-pg',
      artifactId: 'artifact-pg-payment', packageId: 'fuma.customer-payments', exactVersion: '1.0.0',
      contentHashSha256: HASH, permissions: [...AI_PAYMENT_PLUGIN_PERMISSIONS],
    },
    purpose: 'deposit', blockId: 'fuma.customer-payments.deposit',
    amountAuthority: 'customer-or-merchant-explicit-input',
    feeDisclosure: {
      version: 'fuma-customer-payments-fees-v1', currency: 'KES', fumaPlatformFeeMinor: 0,
      providerFeeNotice: 'Paystack fees are charged under the merchant account and are not controlled by AI.',
      customerChargeNotice: 'Confirmation and credential storage do not charge a customer. A separate explicit checkout sets the amount.',
      previewAmountMinor: 100,
    },
    state: 'proposed', challenge: null, confirmationId: null, installationId: null, credentialId: null, preview: null,
    createdAt: NOW, expiresAt: '2026-08-01T08:10:00.000Z', confirmedAt: null, credentialStoredAt: null, testedAt: null,
  }
}

async function prerequisites(db: ReturnType<typeof createPostgresClient>) {
  await db.unsafe(`
    create table ai_conversations (id text primary key);
    create table fuma_tenant_owner_keys (
      platform_id text not null, owner_key text not null, organization_id text not null, workspace_id text not null,
      site_id text not null, state text not null, generation bigint not null, transfer_id text null,
      transfer_lock_id text null, transfer_fence bigint null, created_at timestamptz not null, updated_at timestamptz not null,
      primary key(platform_id,owner_key), unique(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
    );
  `)
  await db`insert into ai_conversations(id) values ('conversation-pg')`
  await db`insert into fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,state,generation,created_at,updated_at)
    values (${scope.platformId},${scope.ownerKey},${scope.organizationId},${scope.workspaceId},${scope.siteId},'active',${scope.ownerGeneration},${NOW},${NOW})`
  await db.unsafe(customerMerchantPaymentsV2Migration.sql)
  await db.unsafe(siteAiScopeAuthorityMigration.sql)
  await db.unsafe(artifactInstallationAuthorityMigration.sql)
  await db.unsafe(artifactReviewMarketplaceMigration.sql)
  await db.unsafe(customerPaymentPluginMigration.sql)
  await db.unsafe(aiPaymentSetupMigration.sql)
  await db`insert into fuma_site_ai_conversation_bindings(
    conversation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,
    actor_id,session_id,editor_session_id,created_at
  ) values ('conversation-pg',${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},
    ${scope.ownerKey},${scope.ownerGeneration},${scope.profileId},'actor-pg','session-pg','editor-pg',${NOW})`
  const artifact = {
    schemaVersion: 1, artifactId: 'artifact-pg-payment', kind: 'plugin', packageId: 'fuma.customer-payments', exactVersion: '1.0.0',
    executionPolicy: 'plugin-sandbox-worker', objectKey: 'artifacts/plugin/fuma.customer-payments/1.0.0.zip', mimeType: 'application/zip',
    contentHashSha256: HASH, sizeBytes: 100, permissions: [...AI_PAYMENT_PLUGIN_PERMISSIONS],
    provenance: { sourceHashSha256: 'b'.repeat(64), lockHashSha256: 'c'.repeat(64), builderId: 'builder-pg' }, createdAt: NOW,
  }
  await db`insert into fuma_artifact_releases_v2(
    artifact_id,artifact_kind,package_id,exact_version,execution_policy,object_key,mime_type,content_hash_sha256,
    size_bytes,permissions_json,provenance_json,artifact_json,created_at
  ) values (${artifact.artifactId},${artifact.kind},${artifact.packageId},${artifact.exactVersion},${artifact.executionPolicy},
    ${artifact.objectKey},${artifact.mimeType},${artifact.contentHashSha256},${artifact.sizeBytes},
    ${JSON.stringify(artifact.permissions)}::text::jsonb,${JSON.stringify(artifact.provenance)}::text::jsonb,${JSON.stringify(artifact)}::text::jsonb,${NOW})`
  await db`insert into fuma_artifact_review_submissions_v2(
    submission_id,artifact_id,artifact_kind,package_id,exact_version,content_hash_sha256,submitter_id,baseline_submission_id,
    metadata_hash_sha256,scan_state,submission_json,submitted_at
  ) values ('submission-pg-payment',${artifact.artifactId},'plugin',${artifact.packageId},${artifact.exactVersion},${HASH},
    'submitter-pg',null,${'d'.repeat(64)},'clean','{}'::jsonb,${NOW})`
  for (const scanner of ['archive-policy', 'plugin-manifest']) await db`insert into fuma_artifact_scan_reports_v2(
    scan_id,submission_id,artifact_id,artifact_kind,content_hash_sha256,scanner_id,scanner_version,state,report_json,scanned_at
  ) values (${`scan-${scanner}`},'submission-pg-payment',${artifact.artifactId},'plugin',${HASH},${scanner},'1.0.0','clean','{}'::jsonb,${NOW})`
  await db`insert into fuma_artifact_review_decisions_v2(
    decision_id,submission_id,artifact_id,content_hash_sha256,reviewer_id,decision,reason,signature_key_id,
    signature_payload_hash_sha256,signature_value,decision_json,decided_at
  ) values ('decision-pg-payment','submission-pg-payment',${artifact.artifactId},${HASH},'reviewer-pg','approved','clean',
    'review-key-pg',${'e'.repeat(64)},${'S'.repeat(64)},'{}'::jsonb,${NOW})`
  const installation = {
    ...scope, installationId: 'installation-pg-payment', artifactId: artifact.artifactId, artifactKind: 'plugin',
    packageId: artifact.packageId, exactVersion: artifact.exactVersion, contentHashSha256: HASH,
    executionPolicy: 'plugin-sandbox-worker', settingsObjectKey: null, secret: null, state: 'active', workerGeneration: 1,
    quota: { storageBytes: 1024, scheduledJobs: 0, callsPerMinute: 100 }, previousArtifactId: null, version: 1,
    installedAt: NOW, updatedAt: NOW,
  }
  await db`insert into fuma_artifact_installations_v2(
    platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,installation_id,artifact_id,artifact_kind,
    package_id,exact_version,content_hash_sha256,execution_policy,settings_object_key,secret_json,state,worker_generation,
    storage_quota_bytes,schedule_quota,calls_per_minute,previous_artifact_id,version,installation_json,installed_at,updated_at
  ) values (${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.ownerGeneration},
    ${installation.installationId},${artifact.artifactId},'plugin',${artifact.packageId},${artifact.exactVersion},${HASH},
    'plugin-sandbox-worker',null,null,'active',1,1024,0,100,null,1,${JSON.stringify(installation)}::text::jsonb,${NOW},${NOW})`
}

describe('FUMA-070 optional native PostgreSQL acceptance', () => {
  test.skipIf(!postgresUrl)('serializes proposal, handoff, credential, preview, and transfer invalidation without secrets', async () => {
    if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin = createPostgresClient(postgresUrl)
    const schema = `fuma_ai_payment_${process.pid}_${Date.now()}`
    await admin.unsafe(`create schema ${quote(schema)}`)
    const db = createPostgresClient(scoped(postgresUrl, schema))
    try {
      await prerequisites(db)
      const repository = new PostgresAiPaymentSetupRepository(db)
      const initial = proposed()
      expect(await repository.insert(initial)).toBe(true)
      expect(await repository.insert(initial)).toBe(false)
      const challenges = await fulfilled(Array.from({ length: 8 }, () => repository.setChallenge(initial, {
        challengeId: 'challenge-pg', nonceHashSha256: 'f'.repeat(64), expiresAt: '2026-08-01T08:05:00.000Z',
      })))
      expect(challenges.filter(Boolean)).toHaveLength(1)
      const challenged = await repository.read(initial.proposalId)
      if (!challenged) throw new Error('proposal missing')
      const confirmed: AiPaymentSetupProposal = {
        ...challenged, state: 'confirmed', confirmationId: 'confirmation-pg', installationId: 'installation-pg-payment', confirmedAt: NOW,
      }
      const handoff: AiPaymentSetupHandoff = {
        handoffId: 'handoff-pg', proposalId: initial.proposalId, tokenHashSha256: '1'.repeat(64),
        audience: 'secure-payment-settings', state: 'issued', expiresAt: '2026-08-01T08:05:00.000Z', createdAt: NOW, consumedAt: null,
      }
      const confirmations = await fulfilled(Array.from({ length: 8 }, () => repository.confirm(challenged, confirmed, handoff)))
      expect(confirmations.filter(Boolean)).toHaveLength(1)
      const claims = await fulfilled(Array.from({ length: 8 }, () => repository.claimHandoff(initial.proposalId, handoff.tokenHashSha256, NOW)))
      expect(claims.filter(Boolean)).toHaveLength(1)
      const claim = claims.find(Boolean)
      if (!claim) throw new Error('handoff missing')
      await db`insert into fuma_customer_merchant_credentials_v2(
        credential_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,version,envelope_json,state,created_at,updated_at
      ) values ('credential-pg',${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},
        ${scope.ownerGeneration},1,'{"ciphertext":"redacted","keyId":"key-pg"}'::jsonb,'active',${NOW},${NOW})`
      const stored: AiPaymentSetupProposal = { ...claim.proposal, state: 'credential-stored', credentialId: 'credential-pg', credentialStoredAt: NOW }
      const completions = await fulfilled(Array.from({ length: 8 }, () => repository.completeCredential(claim.proposal, stored, claim.handoff)))
      expect(completions.filter(Boolean)).toHaveLength(1)
      const tested: AiPaymentSetupProposal = {
        ...stored, state: 'tested', preview: { state: 'settled', purpose: 'deposit', amountMinor: 100, currency: 'KES', receiptFingerprintSha256: '2'.repeat(64) }, testedAt: NOW,
      }
      const previews = await fulfilled(Array.from({ length: 8 }, () => repository.completePreview(stored, tested)))
      expect(previews.filter(Boolean)).toHaveLength(1)
      await expect(db`delete from fuma_ai_payment_setup_proposals_v1 where proposal_id=${initial.proposalId}`).rejects.toThrow('append-only')
      const durable = await db<{ proposal: string; handoff: string }>`select proposal_json::text proposal,(select handoff_json::text from fuma_ai_payment_setup_handoffs_v1 where proposal_id=${initial.proposalId}) handoff from fuma_ai_payment_setup_proposals_v1 where proposal_id=${initial.proposalId}`
      expect(JSON.stringify(durable.rows[0])).not.toMatch(/sk_(?:test|live)|pk_(?:test|live)|handoffToken|confirmationNonce/)
      await db`insert into fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,state,generation,created_at,updated_at)
        values (${scope.platformId},'owner-destination','organization-destination','workspace-destination','site-destination','active',4,${NOW},${NOW})`
      await db`update fuma_artifact_installations_v2 set organization_id='organization-destination',workspace_id='workspace-destination',
        site_id='site-destination',owner_key='owner-destination',owner_generation=4,version=2,updated_at=${NOW}
        where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and installation_id='installation-pg-payment'`
      const oldInstallation = await db<{ count: string }>`select count(*)::text count from fuma_artifact_installations_v2 where platform_id=${scope.platformId} and owner_key=${scope.ownerKey} and owner_generation=${scope.ownerGeneration} and installation_id='installation-pg-payment'`
      expect(oldInstallation.rows[0]?.count).toBe('0')
      const counts = await db<{ proposals: string; handoffs: string; credentials: string }>`select
        (select count(*) from fuma_ai_payment_setup_proposals_v1)::text proposals,
        (select count(*) from fuma_ai_payment_setup_handoffs_v1)::text handoffs,
        (select count(*) from fuma_customer_merchant_credentials_v2)::text credentials`
      expect(counts.rows[0]).toEqual({ proposals: '1', handoffs: '1', credentials: '1' })
      process.stdout.write('[FUMA-070 PostgreSQL demo] concurrent=8 proposal=1 handoff=1 credential=1 preview=1 secrets=redacted transfer=invalidated\n')
    } finally {
      await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)
      const leftover = await admin<{ count: string | number | bigint }>`select count(*) count from pg_namespace where nspname=${schema}`
      expect(Number(leftover.rows[0]?.count ?? 0)).toBe(0)
    }
  }, 120_000)
})
