import claimsSource from '@/content/public/claims.json'
import { PublicClaimInventorySchema } from '@/lib/public-web-contracts'
import { Value } from '@sinclair/typebox/value'

export const ACQUISITION_PATHS = [
  '/',
  '/website',
  '/publication',
  '/features',
  '/solutions',
  '/about',
] as const

export type AcquisitionPath = (typeof ACQUISITION_PATHS)[number]
export type ApprovedClaimId = 'clean-output' | 'draft-isolation' | 'single-workflow' | 'owned-form-data' | 'kenya-context'

if (!Value.Check(PublicClaimInventorySchema, claimsSource)) {
  throw new Error('The public claim inventory is invalid.')
}

const claims = new Map(claimsSource.map((claim) => [claim.id, claim] as const))

export function approvedClaim(id: ApprovedClaimId) {
  const claim = claims.get(id)
  if (!claim) throw new Error(`Approved public claim ${id} is missing.`)
  return claim
}

export const ACQUISITION_ROUTE_CONTRACT = Object.freeze({
  '/': {
    canonical: 'https://fuma.co.ke/',
    links: ['/website', '/publication', '/features', '/solutions', '/about', '/start?kind=sign_up&source=home'],
    claims: ['single-workflow', 'kenya-context'],
  },
  '/website': {
    canonical: 'https://fuma.co.ke/website',
    links: ['/start?kind=create_site&source=product&profile=website', '/publication'],
    claims: ['clean-output', 'owned-form-data'],
  },
  '/publication': {
    canonical: 'https://fuma.co.ke/publication',
    links: ['/start?kind=create_site&source=product&profile=publication', '/website'],
    claims: ['draft-isolation', 'clean-output'],
  },
  '/features': {
    canonical: 'https://fuma.co.ke/features',
    links: ['/start?kind=sign_up&source=solution', '/website', '/publication'],
    claims: ['single-workflow', 'owned-form-data'],
  },
  '/solutions': {
    canonical: 'https://fuma.co.ke/solutions',
    links: ['/website', '/publication'],
    claims: ['single-workflow', 'kenya-context'],
  },
  '/about': {
    canonical: 'https://fuma.co.ke/about',
    links: ['/blog', '/contact', '/trust'],
    claims: ['kenya-context'],
  },
} satisfies Record<AcquisitionPath, {
  canonical: string
  links: readonly string[]
  claims: readonly ApprovedClaimId[]
}>)
