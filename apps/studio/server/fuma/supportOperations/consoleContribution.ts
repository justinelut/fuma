export const supportOperationsConsoleContribution = Object.freeze({
  contributionId: 'support-moderation',
  ownerTicket: 'FUMA-072',
  routes: Object.freeze([
    '/internal/support',
    '/internal/support/moderation',
    '/internal/support/suspensions',
    '/internal/support/appeals',
    '/internal/support/owner-recovery',
  ]),
  requiredAuthorities: Object.freeze(['internal.support.read']),
  mounted: false,
})

export type SupportOperationsConsoleContribution = typeof supportOperationsConsoleContribution
