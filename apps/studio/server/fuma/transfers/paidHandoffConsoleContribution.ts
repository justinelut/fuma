export const paidHandoffConsoleContribution = Object.freeze({
  contributionId: 'transfer-recovery',
  ownerTicket: 'FUMA-074',
  routes: Object.freeze([
    '/internal/transfers',
    '/internal/transfers/reconcile',
    '/internal/transfers/recover',
    '/internal/transfers/refund-escalations',
  ]),
  requiredAuthorities: Object.freeze(['internal.transfers.read']),
  mounted: false,
})

export type PaidHandoffConsoleContribution = typeof paidHandoffConsoleContribution
