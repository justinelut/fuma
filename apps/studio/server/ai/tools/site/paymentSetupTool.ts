import { SiteProposePaymentSetupInputSchema } from '@core/ai'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { AiTool, ToolContext } from '../../runtime/types'
import { sitePaymentSetupProposalPort } from './paymentSetupPort'

export { SiteProposePaymentSetupInputSchema } from '@core/ai'

export const siteProposePaymentSetupTool: AiTool = Object.freeze({
  name: 'site_propose_payment_setup',
  scope: 'site',
  execution: 'server',
  mutates: true,
  requiredCapabilities: ['plugins.install'] as const,
  description:
    'Propose the fixed signed Fuma customer-payment plugin and one reviewed deposit, donation, or checkout block. This only creates a reviewable proposal: it cannot install, configure, receive credentials, generate code, or select a customer charge amount. Tell the user to open the returned securePaymentPath, review permissions and fees, explicitly confirm, then enter provider credentials directly in the secure UI outside this conversation.',
  inputSchema: SiteProposePaymentSetupInputSchema,
  handler: async (raw: unknown, context: ToolContext) => {
    const parsed = safeParseValue(SiteProposePaymentSetupInputSchema, raw)
    if (!parsed.ok) throw new Error('Payment setup proposal input is invalid.')
    const proposalPort = sitePaymentSetupProposalPort()
    if (!proposalPort || !context.authority || !context.toolCallId) {
      throw new Error('Hosted site payment setup authority is unavailable.')
    }
    const proposal = await proposalPort.propose({
      purpose: parsed.value.purpose,
      conversationId: context.conversationId,
      toolCallId: context.toolCallId,
      actorId: context.userId,
    })
    return Object.freeze({
      proposal,
      securePaymentPath: '/secure-payment',
      nextAction: 'Explicit user confirmation and direct secure credential entry are required outside AI.',
    })
  },
})
