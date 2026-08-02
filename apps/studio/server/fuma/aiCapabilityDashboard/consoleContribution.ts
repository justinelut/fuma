export const aiCapabilityDashboardConsoleContribution = Object.freeze({
  contributionId: 'ai-backend-capabilities',
  ownerTicket: 'FUMA-087',
  routes: Object.freeze([
    '/internal/ai-capabilities',
  ]),
  requiredAuthorities: Object.freeze(['internal.console.read']),
  mounted: false,
})

export type AiCapabilityDashboardConsoleContribution = typeof aiCapabilityDashboardConsoleContribution
