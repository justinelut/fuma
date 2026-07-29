import type { DbClient } from '../../db/client'
import {
  AiPaymentSetupHandoffSchema,
  AiPaymentSetupProposalSchema,
  parseAiPaymentSetupContract,
  type AiPaymentConfirmationChallenge,
  type AiPaymentSetupHandoff,
  type AiPaymentSetupProposal,
} from './contracts'
import type { AiPaymentSetupRepository } from './repository'

type ProposalRow = Readonly<{ proposal_json: unknown }>
type HandoffRow = Readonly<{ handoff_json: unknown }>

function json(value: unknown): string { return JSON.stringify(value) }
function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return null }
}
function proposal(row: ProposalRow): AiPaymentSetupProposal {
  return parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, decoded(row.proposal_json), 'Stored AI payment setup proposal') as AiPaymentSetupProposal
}
function handoff(row: HandoffRow): AiPaymentSetupHandoff {
  return parseAiPaymentSetupContract(AiPaymentSetupHandoffSchema, decoded(row.handoff_json), 'Stored AI payment handoff') as AiPaymentSetupHandoff
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
function same(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right) }

export class PostgresAiPaymentSetupRepository implements AiPaymentSetupRepository {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('AI payment setup authority requires PostgreSQL.')
    this.#db = db
  }

  async read(proposalId: string): Promise<AiPaymentSetupProposal | null> {
    const result = await this.#db<ProposalRow>`select proposal_json from fuma_ai_payment_setup_proposals_v1 where proposal_id=${proposalId}`
    return result.rows[0] ? proposal(result.rows[0]) : null
  }

  async insert(raw: AiPaymentSetupProposal): Promise<boolean> {
    const value = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, raw, 'AI payment setup proposal insert') as AiPaymentSetupProposal
    const result = await this.#db`
      insert into fuma_ai_payment_setup_proposals_v1 (
        proposal_id,conversation_id,tool_call_id,platform_id,organization_id,workspace_id,site_id,owner_key,
        owner_generation,profile_id,actor_id,review_submission_id,review_decision_id,review_signature_key_id,
        artifact_id,package_id,exact_version,content_hash_sha256,permissions_json,purpose,block_id,fee_disclosure_version,state,
        challenge_id,challenge_nonce_hash_sha256,challenge_expires_at,confirmation_id,installation_id,credential_id,
        preview_receipt_fingerprint_sha256,proposal_json,created_at,expires_at,confirmed_at,credential_stored_at,tested_at
      ) values (
        ${value.proposalId},${value.conversationId},${value.toolCallId},${value.scope.platformId},${value.scope.organizationId},
        ${value.scope.workspaceId},${value.scope.siteId},${value.scope.ownerKey},${value.scope.ownerGeneration},${value.scope.profileId},
        ${value.actorId},${value.review.submissionId},${value.review.decisionId},${value.review.signatureKeyId},${value.review.artifactId},
        ${value.review.packageId},${value.review.exactVersion},${value.review.contentHashSha256},${json(value.review.permissions)}::text::jsonb,${value.purpose},${value.blockId},
        ${value.feeDisclosure.version},${value.state},null,null,null,null,null,null,null,${json(value)}::text::jsonb,
        ${value.createdAt},${value.expiresAt},null,null,null
      ) on conflict do nothing
    `
    return result.rowCount === 1
  }

  setChallenge(expected: AiPaymentSetupProposal, challenge: AiPaymentConfirmationChallenge): Promise<AiPaymentSetupProposal | null> {
    return this.#db.transaction(async (tx) => {
      const selected = await tx<ProposalRow>`select proposal_json from fuma_ai_payment_setup_proposals_v1 where proposal_id=${expected.proposalId} for update`
      if (!selected.rows[0]) return null
      const current = proposal(selected.rows[0])
      if (current.state !== 'proposed' || !same(current, expected)) return null
      const next = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, { ...current, challenge }, 'Challenged AI payment setup proposal') as AiPaymentSetupProposal
      const updated = await tx`
        update fuma_ai_payment_setup_proposals_v1 set
          challenge_id=${challenge.challengeId},challenge_nonce_hash_sha256=${challenge.nonceHashSha256},
          challenge_expires_at=${challenge.expiresAt},proposal_json=${json(next)}::text::jsonb
        where proposal_id=${current.proposalId} and state='proposed'
      `
      return updated.rowCount === 1 ? next : null
    })
  }

  confirm(expected: AiPaymentSetupProposal, rawNext: AiPaymentSetupProposal, rawHandoff: AiPaymentSetupHandoff): Promise<boolean> {
    const next = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, rawNext, 'Confirmed AI payment setup proposal') as AiPaymentSetupProposal
    const value = parseAiPaymentSetupContract(AiPaymentSetupHandoffSchema, rawHandoff, 'AI payment setup handoff') as AiPaymentSetupHandoff
    return this.#db.transaction(async (tx) => {
      const selected = await tx<ProposalRow>`select proposal_json from fuma_ai_payment_setup_proposals_v1 where proposal_id=${expected.proposalId} for update`
      if (!selected.rows[0] || !same(proposal(selected.rows[0]), expected) || expected.state !== 'proposed') return false
      const handoffResult = await tx`
        insert into fuma_ai_payment_setup_handoffs_v1 (
          handoff_id,proposal_id,token_hash_sha256,audience,state,handoff_json,expires_at,created_at,consumed_at
        ) values (
          ${value.handoffId},${value.proposalId},${value.tokenHashSha256},${value.audience},${value.state},
          ${json(value)}::text::jsonb,${value.expiresAt},${value.createdAt},null
        ) on conflict do nothing
      `
      if (handoffResult.rowCount !== 1) return false
      const updated = await tx`
        update fuma_ai_payment_setup_proposals_v1 set state=${next.state},confirmation_id=${next.confirmationId},
          installation_id=${next.installationId},proposal_json=${json(next)}::text::jsonb,confirmed_at=${next.confirmedAt}
        where proposal_id=${expected.proposalId} and state='proposed'
      `
      if (updated.rowCount !== 1) throw new Error('AI payment proposal confirmation fence changed.')
      return true
    })
  }

  claimHandoff(proposalId: string, tokenHashSha256: string, now: string): Promise<Readonly<{ proposal: AiPaymentSetupProposal; handoff: AiPaymentSetupHandoff }> | null> {
    return this.#db.transaction(async (tx) => {
      const proposalResult = await tx<ProposalRow>`select proposal_json from fuma_ai_payment_setup_proposals_v1 where proposal_id=${proposalId} for update`
      if (!proposalResult.rows[0]) return null
      const currentProposal = proposal(proposalResult.rows[0])
      const selected = await tx<HandoffRow>`
        select handoff_json from fuma_ai_payment_setup_handoffs_v1
        where proposal_id=${proposalId} and token_hash_sha256=${tokenHashSha256} for update
      `
      if (!selected.rows[0]) return null
      const current = handoff(selected.rows[0])
      if (currentProposal.state !== 'confirmed' || current.state !== 'issued' || current.expiresAt <= now) return null
      const claimed = parseAiPaymentSetupContract(AiPaymentSetupHandoffSchema, { ...current, state: 'consuming' }, 'Claimed AI payment handoff') as AiPaymentSetupHandoff
      const updated = await tx`
        update fuma_ai_payment_setup_handoffs_v1 set state='consuming',handoff_json=${json(claimed)}::text::jsonb
        where handoff_id=${current.handoffId} and state='issued'
      `
      return updated.rowCount === 1 ? Object.freeze({ proposal: currentProposal, handoff: claimed }) : null
    })
  }

  completeCredential(expected: AiPaymentSetupProposal, rawNext: AiPaymentSetupProposal, expectedHandoff: AiPaymentSetupHandoff): Promise<boolean> {
    const next = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, rawNext, 'Credential-stored AI payment setup proposal') as AiPaymentSetupProposal
    return this.#db.transaction(async (tx) => {
      const proposalResult = await tx<ProposalRow>`select proposal_json from fuma_ai_payment_setup_proposals_v1 where proposal_id=${expected.proposalId} for update`
      const handoffResult = await tx<HandoffRow>`select handoff_json from fuma_ai_payment_setup_handoffs_v1 where handoff_id=${expectedHandoff.handoffId} for update`
      if (!proposalResult.rows[0] || !handoffResult.rows[0] || !same(proposal(proposalResult.rows[0]), expected)
        || !same(handoff(handoffResult.rows[0]), expectedHandoff) || expected.state !== 'confirmed' || expectedHandoff.state !== 'consuming') return false
      const consumed = parseAiPaymentSetupContract(AiPaymentSetupHandoffSchema, {
        ...expectedHandoff,
        state: 'consumed',
        consumedAt: next.credentialStoredAt,
      }, 'Consumed AI payment handoff') as AiPaymentSetupHandoff
      const proposalUpdate = await tx`
        update fuma_ai_payment_setup_proposals_v1 set state=${next.state},credential_id=${next.credentialId},
          proposal_json=${json(next)}::text::jsonb,credential_stored_at=${next.credentialStoredAt}
        where proposal_id=${expected.proposalId} and state='confirmed'
      `
      const handoffUpdate = await tx`
        update fuma_ai_payment_setup_handoffs_v1 set state='consumed',handoff_json=${json(consumed)}::text::jsonb,
          consumed_at=${consumed.consumedAt} where handoff_id=${expectedHandoff.handoffId} and state='consuming'
      `
      if (proposalUpdate.rowCount !== 1 || handoffUpdate.rowCount !== 1) throw new Error('AI payment credential completion fence changed.')
      return true
    })
  }

  completePreview(expected: AiPaymentSetupProposal, rawNext: AiPaymentSetupProposal): Promise<boolean> {
    const next = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, rawNext, 'Tested AI payment setup proposal') as AiPaymentSetupProposal
    return this.#db.transaction(async (tx) => {
      const selected = await tx<ProposalRow>`select proposal_json from fuma_ai_payment_setup_proposals_v1 where proposal_id=${expected.proposalId} for update`
      if (!selected.rows[0] || !same(proposal(selected.rows[0]), expected) || expected.state !== 'credential-stored') return false
      const updated = await tx`
        update fuma_ai_payment_setup_proposals_v1 set state=${next.state},
          preview_receipt_fingerprint_sha256=${next.preview?.receiptFingerprintSha256 ?? null},
          proposal_json=${json(next)}::text::jsonb,tested_at=${next.testedAt}
        where proposal_id=${expected.proposalId} and state='credential-stored'
      `
      return updated.rowCount === 1
    })
  }
}
