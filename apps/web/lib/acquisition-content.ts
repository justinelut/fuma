import claimsSource from '@/content/public/claims.json'
import { PublicClaimInventorySchema } from '@/lib/public-web-contracts'
import { Value } from '@sinclair/typebox/value'
import { canonicalPublicUrl } from '@/lib/seo'

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
    canonical: canonicalPublicUrl('/'),
    links: ['/website', '/publication', '/features', '/solutions', '/about', '/start?kind=sign_up&source=home'],
    claims: ['single-workflow', 'clean-output'],
  },
  '/website': {
    canonical: canonicalPublicUrl('/website'),
    links: ['/start?kind=create_site&source=product&profile=website', '/publication'],
    claims: ['clean-output', 'owned-form-data'],
  },
  '/publication': {
    canonical: canonicalPublicUrl('/publication'),
    links: ['/start?kind=create_site&source=product&profile=publication', '/website'],
    claims: ['draft-isolation', 'clean-output'],
  },
  '/features': {
    canonical: canonicalPublicUrl('/features'),
    links: ['/start?kind=sign_up&source=solution', '/website', '/publication'],
    claims: ['single-workflow', 'owned-form-data'],
  },
  '/solutions': {
    canonical: canonicalPublicUrl('/solutions'),
    links: ['/website', '/publication'],
    claims: ['single-workflow', 'clean-output'],
  },
  '/about': {
    canonical: canonicalPublicUrl('/about'),
    links: ['/blog', '/contact', '/trust'],
    claims: ['single-workflow'],
  },
} satisfies Record<AcquisitionPath, {
  canonical: string
  links: readonly string[]
  claims: readonly ApprovedClaimId[]
}>)
