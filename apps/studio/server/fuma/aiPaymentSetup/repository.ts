import type {
  AiPaymentConfirmationChallenge,
  AiPaymentSetupHandoff,
  AiPaymentSetupProposal,
} from './contracts'
import {
  AiPaymentSetupError,
  AiPaymentSetupHandoffSchema,
  AiPaymentSetupProposalSchema,
  parseAiPaymentSetupContract,
} from './contracts'

export interface AiPaymentSetupRepository {
  read(proposalId: string): Promise<AiPaymentSetupProposal | null>
  insert(value: AiPaymentSetupProposal): Promise<boolean>
  setChallenge(expected: AiPaymentSetupProposal, challenge: AiPaymentConfirmationChallenge): Promise<AiPaymentSetupProposal | null>
  confirm(expected: AiPaymentSetupProposal, next: AiPaymentSetupProposal, handoff: AiPaymentSetupHandoff): Promise<boolean>
  claimHandoff(proposalId: string, tokenHashSha256: string, now: string): Promise<Readonly<{ proposal: AiPaymentSetupProposal; handoff: AiPaymentSetupHandoff }> | null>
  completeCredential(expected: AiPaymentSetupProposal, next: AiPaymentSetupProposal, handoff: AiPaymentSetupHandoff): Promise<boolean>
  completePreview(expected: AiPaymentSetupProposal, next: AiPaymentSetupProposal): Promise<boolean>
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
function clone<T>(value: T): T { return structuredClone(value) }
function same(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right) }

export class MemoryAiPaymentSetupRepository implements AiPaymentSetupRepository {
  readonly proposals = new Map<string, AiPaymentSetupProposal>()
  readonly handoffs = new Map<string, AiPaymentSetupHandoff>()

  async read(proposalId: string): Promise<AiPaymentSetupProposal | null> {
    return clone(this.proposals.get(proposalId) ?? null)
  }

  async insert(value: AiPaymentSetupProposal): Promise<boolean> {
    const parsed = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, value, 'AI payment setup proposal') as AiPaymentSetupProposal
    const current = this.proposals.get(parsed.proposalId)
    if (current) return false
    this.proposals.set(parsed.proposalId, clone(parsed))
    return true
  }

  async setChallenge(expected: AiPaymentSetupProposal, challenge: AiPaymentConfirmationChallenge): Promise<AiPaymentSetupProposal | null> {
    const current = this.proposals.get(expected.proposalId)
    if (!current || !same(current, expected) || current.state !== 'proposed') return null
    const next = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, { ...current, challenge }, 'AI payment challenge proposal') as AiPaymentSetupProposal
    this.proposals.set(next.proposalId, clone(next))
    return clone(next)
  }

  async confirm(expected: AiPaymentSetupProposal, next: AiPaymentSetupProposal, handoff: AiPaymentSetupHandoff): Promise<boolean> {
    const current = this.proposals.get(expected.proposalId)
    if (!current || !same(current, expected) || current.state !== 'proposed' || this.handoffs.has(handoff.handoffId)) return false
    const parsedNext = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, next, 'Confirmed AI payment proposal') as AiPaymentSetupProposal
    const parsedHandoff = parseAiPaymentSetupContract(AiPaymentSetupHandoffSchema, handoff, 'AI payment secure handoff') as AiPaymentSetupHandoff
    this.proposals.set(parsedNext.proposalId, clone(parsedNext))
    this.handoffs.set(parsedHandoff.handoffId, clone(parsedHandoff))
    return true
  }

  async claimHandoff(proposalId: string, tokenHashSha256: string, now: string): Promise<Readonly<{ proposal: AiPaymentSetupProposal; handoff: AiPaymentSetupHandoff }> | null> {
    const proposal = this.proposals.get(proposalId)
    const entry = [...this.handoffs.values()].find((value) => value.proposalId === proposalId)
    if (!proposal || !entry || entry.tokenHashSha256 !== tokenHashSha256 || entry.state !== 'issued' || entry.expiresAt <= now || proposal.state !== 'confirmed') return null
    const handoff = parseAiPaymentSetupContract(AiPaymentSetupHandoffSchema, { ...entry, state: 'consuming' }, 'Claimed AI payment handoff') as AiPaymentSetupHandoff
    this.handoffs.set(handoff.handoffId, clone(handoff))
    return Object.freeze({ proposal: clone(proposal), handoff: clone(handoff) })
  }

  async completeCredential(expected: AiPaymentSetupProposal, next: AiPaymentSetupProposal, handoff: AiPaymentSetupHandoff): Promise<boolean> {
    const current = this.proposals.get(expected.proposalId)
    const currentHandoff = this.handoffs.get(handoff.handoffId)
    if (!current || !same(current, expected) || !currentHandoff || !same(currentHandoff, handoff) || handoff.state !== 'consuming') return false
    const parsed = parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, next, 'Credential-stored AI payment proposal') as AiPaymentSetupProposal
    const consumed = parseAiPaymentSetupContract(AiPaymentSetupHandoffSchema, { ...handoff, state: 'consumed', consumedAt: parsed.credentialStoredAt }, 'Consumed AI payment handoff') as AiPaymentSetupHandoff
    this.proposals.set(parsed.proposalId, clone(parsed))
    this.handoffs.set(consumed.handoffId, clone(consumed))
    return true
  }

  async completePreview(expected: AiPaymentSetupProposal, next: AiPaymentSetupProposal): Promise<boolean> {
    const current = this.proposals.get(expected.proposalId)
    if (!current || !same(current, expected) || current.state !== 'credential-stored') return false
    this.proposals.set(next.proposalId, clone(parseAiPaymentSetupContract(AiPaymentSetupProposalSchema, next, 'Tested AI payment proposal') as AiPaymentSetupProposal))
    return true
  }

  require(proposalId: string): AiPaymentSetupProposal {
    const value = this.proposals.get(proposalId)
    if (!value) throw new AiPaymentSetupError('not-found', 'AI payment setup proposal is unavailable.')
    return clone(value)
  }
}
