import type {
  AiPaymentPurpose,
  AiPaymentSetupProposalView,
} from '../../../fuma/aiPaymentSetup/contracts'

export interface SitePaymentSetupProposalPort {
  propose(input: Readonly<{
    purpose: AiPaymentPurpose
    conversationId: string
    toolCallId: string
    actorId: string
  }>): Promise<AiPaymentSetupProposalView>
}

let proposalPort: SitePaymentSetupProposalPort | null = null

/** One production composition seam; the returned disposer exists for isolated tests. */
export function configureSitePaymentSetupProposalPort(port: SitePaymentSetupProposalPort): () => void {
  if (proposalPort !== null && proposalPort !== port) throw new Error('Site payment setup proposal port is already configured.')
  proposalPort = port
  return () => { if (proposalPort === port) proposalPort = null }
}

export function sitePaymentSetupProposalPort(): SitePaymentSetupProposalPort | null {
  return proposalPort
}
