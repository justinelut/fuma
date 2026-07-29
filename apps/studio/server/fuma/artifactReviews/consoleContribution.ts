export const artifactReviewConsoleContribution = Object.freeze({
  contributionId: 'artifact-review',
  ownerTicket: 'FUMA-068',
  routes: Object.freeze(['/internal/artifacts/reviews']),
  requiredAuthorities: Object.freeze(['internal.plugins.review']),
  mounted: false,
})

export type ArtifactReviewConsoleContribution = typeof artifactReviewConsoleContribution
