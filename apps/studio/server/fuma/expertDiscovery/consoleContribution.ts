export const expertDiscoveryConsoleContribution = Object.freeze({
  contributionId: 'expert-moderation',
  ownerTicket: 'FUMA-073',
  routes: Object.freeze([
    '/internal/experts',
    '/internal/experts/approvals',
    '/internal/experts/inquiries',
    '/internal/experts/transfers',
  ]),
  requiredAuthorities: Object.freeze(['internal.experts.read']),
  mounted: false,
})

export type ExpertDiscoveryConsoleContribution = typeof expertDiscoveryConsoleContribution
