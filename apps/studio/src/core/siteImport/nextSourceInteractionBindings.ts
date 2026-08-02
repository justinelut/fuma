import type {
  NextSourceInteractionAuthority,
  NextSourceInteractionBinding,
  NextSourceInteractionEvidence,
} from './nextSourceContracts'

const AUTHORITIES_BY_KIND: Readonly<Record<NextSourceInteractionEvidence['kind'], readonly NextSourceInteractionAuthority[]>> = {
  content: ['website.data', 'publication.content'],
  member: ['publication.member-access'],
  subscription: ['publication.membership-payments'],
  form: ['core.public-form'],
  // Current Publication contracts do not model episodes/audio enclosures.
  // Keep podcast imports blocking until that reviewed authority exists.
  podcast: [],
}

export function nextSourceAuthoritiesForInteraction(
  kind: NextSourceInteractionEvidence['kind'],
): readonly NextSourceInteractionAuthority[] {
  return AUTHORITIES_BY_KIND[kind]
}

type NextSourceInteractionBindingCandidate = Readonly<{
  kind: NextSourceInteractionEvidence['kind']
  authority: NextSourceInteractionAuthority
}>

export function isReviewedNextSourceInteractionBinding(
  binding: NextSourceInteractionBindingCandidate,
): boolean {
  return AUTHORITIES_BY_KIND[binding.kind].includes(binding.authority)
}

export function isNextSourceInteractionAuthorityAvailable(
  profileId: string,
  binding: NextSourceInteractionBindingCandidate,
): boolean {
  if (!isReviewedNextSourceInteractionBinding(binding)) return false
  if (binding.authority === 'core.public-form') return profileId === 'website' || profileId === 'publication'
  if (binding.authority === 'website.data') return profileId === 'website'
  return profileId === 'publication'
}

export function createReviewedNextSourceInteractionBinding(
  interactionId: string,
  kind: NextSourceInteractionEvidence['kind'],
  authority: NextSourceInteractionAuthority,
): NextSourceInteractionBinding | null {
  if (kind === 'content' && (authority === 'website.data' || authority === 'publication.content')) {
    return { interactionId, kind, authority }
  }
  if (kind === 'member' && authority === 'publication.member-access') return { interactionId, kind, authority }
  if (kind === 'subscription' && authority === 'publication.membership-payments') return { interactionId, kind, authority }
  if (kind === 'form' && authority === 'core.public-form') return { interactionId, kind, authority }
  return null
}
