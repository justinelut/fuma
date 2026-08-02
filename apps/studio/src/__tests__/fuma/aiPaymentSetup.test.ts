import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { ArtifactInstallation, ArtifactInstallationAuthority } from '../../../server/fuma/artifacts'
import { ArtifactReviewError, type ArtifactReviewService, type MarketplaceArtifact } from '../../../server/fuma/artifactReviews'
import { MemorySiteAiRepository } from '../../../server/fuma/siteAi/memory'
import {
  AI_PAYMENT_PLUGIN_PERMISSIONS,
  AI_PAYMENT_PREVIEW_AMOUNT_MINOR,
  AiPaymentSetupError,
  AiPaymentSetupService,
  MemoryAiPaymentSetupRepository,
  type AiPaymentSetupActorAuthority,
  type AiPaymentSetupConfirmationAuthority,
} from '../../../server/fuma/aiPaymentSetup'

const NOW = '2026-08-01T10:00:00.000Z'
const HASH = 'a'.repeat(64)
const NONCE = 'N'.repeat(43)
const TOKEN = 'T'.repeat(43)
const SCOPE = Object.freeze({
  platformId: 'fuma', organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a',
  ownerKey: 'owner-a', ownerGeneration: 2, profileId: 'website' as const,
})
const MARKETPLACE: MarketplaceArtifact = Object.freeze({
  submissionId: 'submission-payment', decisionId: 'decision-payment', signatureKeyId: 'review-key-a',
  reviewState: 'signed-current', artifactId: 'artifact-payment', kind: 'plugin', packageId: 'fuma.customer-payments',
  exactVersion: '1.0.0', contentHashSha256: HASH, permissions: [...AI_PAYMENT_PLUGIN_PERMISSIONS],
  provenanceHashSha256: 'b'.repeat(64), licenseSpdx: 'MIT', accessibilityStandard: 'not-applicable',
  minimumRuntimeVersion: '1.0.0', reviewedAt: NOW,
})

function sha(value: string): string { return createHash('sha256').update(value).digest('hex') }

async function fixture() {
  let now = new Date(NOW)
  let revoked = false
  const conversations = new MemorySiteAiRepository()
  await conversations.putConversation({
    conversationId: 'conversation-a', scope: SCOPE,
    actor: { actorId: 'actor-a', sessionId: 'session-a', editorSessionId: 'editor-session-a' },
    createdAt: NOW,
  })
  const installations = new Map<string, ArtifactInstallation>()
  const installCalls: unknown[] = []
  const approved = () => ({
    submission: { submissionId: MARKETPLACE.submissionId, artifact: {
      schemaVersion: 1, artifactId: MARKETPLACE.artifactId, kind: 'plugin', packageId: MARKETPLACE.packageId,
      exactVersion: MARKETPLACE.exactVersion, executionPolicy: 'plugin-sandbox-worker', objectKey: 'artifacts/plugin/payment.zip',
      mimeType: 'application/zip', contentHashSha256: HASH, sizeBytes: 1, permissions: [...AI_PAYMENT_PLUGIN_PERMISSIONS],
      provenance: { sourceHashSha256: 'c'.repeat(64), lockHashSha256: 'd'.repeat(64), builderId: 'builder-a' }, createdAt: NOW,
    } },
    decision: { decisionId: MARKETPLACE.decisionId, signature: { keyId: MARKETPLACE.signatureKeyId } },
  })
  const reviews = {
    async marketplace() { return revoked ? [] : [MARKETPLACE] },
    async verify(submissionId: string) {
      if (revoked || submissionId !== MARKETPLACE.submissionId) throw new ArtifactReviewError('revoked', 'Review is revoked.')
      return approved()
    },
    async install(input: { submissionId: string; installation: ArtifactInstallation; grantedPermissions: readonly string[] }) {
      if (revoked || input.submissionId !== MARKETPLACE.submissionId) throw new ArtifactReviewError('revoked', 'Review is revoked.')
      installCalls.push(structuredClone(input))
      const existing = installations.get(input.installation.installationId)
      if (existing) return existing
      installations.set(input.installation.installationId, structuredClone(input.installation))
      return input.installation
    },
  } as unknown as ArtifactReviewService
  const artifacts = {
    async readInstallation(input: { installationId: string }) { return structuredClone(installations.get(input.installationId) ?? null) },
  } as unknown as ArtifactInstallationAuthority
  const credentialWrites: unknown[] = []
  const previewCalls: unknown[] = []
  const repository = new MemoryAiPaymentSetupRepository()
  const service = new AiPaymentSetupService({
    repository, conversations, reviews, artifacts,
    payments: { async attachCredential(scope, secret, credentialId) { credentialWrites.push(structuredClone({ scope, secret, credentialId })); return {} as never } },
    preview: { async settle(input) { previewCalls.push(structuredClone(input)); return { purpose: input.proposal.purpose, receiptFingerprintSha256: 'e'.repeat(64) } } },
    now: () => new Date(now), token: () => TOKEN,
  })
  const actor: AiPaymentSetupActorAuthority = { scope: SCOPE, actorId: 'actor-a' }
  const confirmationActor = (): AiPaymentSetupConfirmationAuthority => ({
    ...actor,
    session: { userId: 'actor-a', impersonatedBy: null, createdAt: new Date(now) },
    freshSessionMs: 300_000,
  })
  return {
    service, repository, actor, confirmationActor, credentialWrites, previewCalls, installCalls,
    setNow(value: string) { now = new Date(value) },
    setRevoked(value: boolean) { revoked = value },
  }
}

async function proposal(value: Awaited<ReturnType<typeof fixture>>, purpose: 'deposit' | 'donation' | 'checkout' = 'deposit') {
  return await value.service.proposeFromAi({ conversationId: 'conversation-a', toolCallId: `call-${purpose}`, actorId: 'actor-a' }, { purpose })
}

function confirmation(view: Awaited<ReturnType<typeof proposal>>, overrides: Record<string, unknown> = {}) {
  return {
    confirmationId: 'confirmation-a', challengeId: 'challenge-a', confirmationNonce: NONCE,
    acceptedArtifactId: view.review.artifactId, acceptedContentHashSha256: view.review.contentHashSha256,
    acceptedExactVersion: view.review.exactVersion, acceptedPermissions: [...view.review.permissions],
    acceptedFeeDisclosureVersion: view.feeDisclosure.version, acceptedPurpose: view.purpose,
    acceptedBlockId: view.blockId,
    ...overrides,
  }
}

describe('FUMA-070 AI-confirmed payment setup', () => {
  test('AI can only persist the fixed reviewed plugin, block, grants, and fee disclosure', async () => {
    const value = await fixture()
    const view = await proposal(value, 'donation')
    expect(view).toMatchObject({
      purpose: 'donation', blockId: 'fuma.customer-payments.donation', state: 'proposed',
      review: { packageId: 'fuma.customer-payments', exactVersion: '1.0.0', permissions: [...AI_PAYMENT_PLUGIN_PERMISSIONS] },
      feeDisclosure: { currency: 'KES', fumaPlatformFeeMinor: 0, previewAmountMinor: AI_PAYMENT_PREVIEW_AMOUNT_MINOR },
    })
    const wire = JSON.stringify(view)
    for (const forbidden of ['scope', 'actorId', 'conversationId', 'toolCallId', 'nonceHashSha256', 'confirmationId', 'credentialId', 'secretKey', 'handoffToken']) {
      expect(wire).not.toContain(`"${forbidden}"`)
    }
    await expect(value.service.proposeFromAi(
      { conversationId: 'conversation-a', toolCallId: 'call-foreign', actorId: 'actor-a' },
      { purpose: 'deposit', amountMinor: 99, code: '<Payment />', artifactId: 'foreign' },
    )).rejects.toBeInstanceOf(AiPaymentSetupError)
    await expect(value.service.proposeFromAi(
      { conversationId: 'conversation-a', toolCallId: 'call-actor', actorId: 'foreign-actor' }, { purpose: 'deposit' },
    )).rejects.toMatchObject({ code: 'denied' })
  })

  test('requires browser nonce, exact acceptance, fresh direct actor, and current review before exact install', async () => {
    const value = await fixture()
    const view = await proposal(value)
    await value.service.registerChallenge(value.actor, view.proposalId, { challengeId: 'challenge-a', nonceHashSha256: sha(NONCE) })
    await expect(value.service.confirm(value.confirmationActor(), view.proposalId, confirmation(view, { confirmationNonce: 'X'.repeat(43) })))
      .rejects.toMatchObject({ code: 'expired' })
    await expect(value.service.confirm({
      ...value.confirmationActor(),
      session: { userId: 'actor-a', impersonatedBy: 'admin-a', createdAt: new Date(NOW) },
    }, view.proposalId, confirmation(view))).rejects.toMatchObject({ code: 'denied' })
    await expect(value.service.confirm({
      ...value.confirmationActor(),
      session: { userId: 'foreign-actor', impersonatedBy: null, createdAt: new Date(NOW) },
    }, view.proposalId, confirmation(view))).rejects.toMatchObject({ code: 'denied' })
    value.setRevoked(true)
    await expect(value.service.confirm(value.confirmationActor(), view.proposalId, confirmation(view)))
      .rejects.toBeInstanceOf(ArtifactReviewError)
    value.setRevoked(false)
    await expect(value.service.confirm(value.confirmationActor(), view.proposalId, confirmation(view, {
      acceptedPermissions: ['cms.routes'],
    }))).rejects.toMatchObject({ code: 'denied' })
    const confirmed = await value.service.confirm(value.confirmationActor(), view.proposalId, confirmation(view))
    expect(confirmed.handoffToken).toBe(TOKEN)
    expect(confirmed.proposal).toMatchObject({ state: 'confirmed', installationId: expect.any(String) })
    expect(value.installCalls).toHaveLength(1)
    expect(JSON.stringify(confirmed.proposal)).not.toContain(TOKEN)
    const replay = await value.service.confirm(value.confirmationActor(), view.proposalId, confirmation(view))
    expect(replay.handoffToken).toBeNull()
    await expect(value.service.confirm(value.confirmationActor(), view.proposalId, confirmation(view, { confirmationId: 'other-confirmation' })))
      .rejects.toMatchObject({ code: 'conflict' })
  })

  test('stores credentials outside AI through one-time handoff and settles only fixed test preview amount', async () => {
    const value = await fixture()
    const view = await proposal(value, 'checkout')
    await value.service.registerChallenge(value.actor, view.proposalId, { challengeId: 'challenge-a', nonceHashSha256: sha(NONCE) })
    await value.service.confirm(value.confirmationActor(), view.proposalId, confirmation(view))
    const result = await value.service.storeCredential(value.actor, view.proposalId, TOKEN, {
      publicKey: 'pk_test_public-a', secretKey: 'sk_test_secret-value-a', testMode: true,
    })
    expect(result).toMatchObject({
      state: 'tested',
      preview: { state: 'settled', purpose: 'checkout', amountMinor: 100, currency: 'KES', receiptFingerprintSha256: 'e'.repeat(64) },
    })
    expect(value.credentialWrites).toHaveLength(1)
    expect(value.previewCalls).toHaveLength(1)
    expect(value.previewCalls[0]).toMatchObject({ amountMinor: 100, currency: 'KES' })
    const persisted = value.repository.require(view.proposalId)
    const durable = JSON.stringify(persisted)
    expect(durable).not.toContain('pk_test_public-a')
    expect(durable).not.toContain('sk_test_secret-value-a')
    expect(durable).not.toContain(TOKEN)
    await expect(value.service.storeCredential(value.actor, view.proposalId, TOKEN, {
      publicKey: 'pk_test_public-a', secretKey: 'sk_test_secret-value-a', testMode: true,
    })).rejects.toMatchObject({ code: 'not-found' })
    expect(value.credentialWrites).toHaveLength(1)
  })

  test('invalidates cross-scope and expired handoffs before secret storage', async () => {
    const value = await fixture()
    const view = await proposal(value)
    await value.service.registerChallenge(value.actor, view.proposalId, { challengeId: 'challenge-a', nonceHashSha256: sha(NONCE) })
    await value.service.confirm(value.confirmationActor(), view.proposalId, confirmation(view))
    await expect(value.service.storeCredential({
      actorId: 'actor-a', scope: { ...SCOPE, ownerKey: 'foreign-owner', ownerGeneration: 3 },
    }, view.proposalId, TOKEN, { publicKey: 'pk_test_public-b', secretKey: 'sk_test_secret-value-b', testMode: true }))
      .rejects.toMatchObject({ code: 'not-found' })
    value.setNow('2026-08-01T10:06:00.000Z')
    await expect(value.service.storeCredential(value.actor, view.proposalId, TOKEN, {
      publicKey: 'pk_test_public-b', secretKey: 'sk_test_secret-value-b', testMode: true,
    })).rejects.toMatchObject({ code: 'not-found' })
    expect(value.credentialWrites).toHaveLength(0)
  })
})
