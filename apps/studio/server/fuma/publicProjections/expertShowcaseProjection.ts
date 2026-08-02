import {
  PublicExpertSchema,
  PublicProfileSchema,
  PublicShowcaseSchema,
  type PublicExpert,
  type PublicShowcase,
} from '@fuma/public-contracts'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { DbClient } from '../../db/client'
import { ExpertProfileRecordSchema, parseExpertContract, type ExpertProfileRecord } from '../expertDiscovery/contracts'
import { PublicProjectionUnavailableError } from './authority'
import { boundedSearchMatch, paginatePublicDiscovery, sortedUnique } from './discoveryPagination'
import type { ApprovedPublicProjectionSource } from './adapters/validatedDomainAdapter'

const ExpertPublicDocumentSchema = Type.Object({
  id: PublicExpertSchema.properties.id,
  slug: PublicExpertSchema.properties.slug,
  summary: PublicExpertSchema.properties.summary,
  location: PublicExpertSchema.properties.location,
  skills: PublicExpertSchema.properties.skills,
  services: PublicExpertSchema.properties.services,
  showcaseIds: PublicExpertSchema.properties.showcaseIds,
  mediatedInquiryAvailable: PublicExpertSchema.properties.mediatedInquiryAvailable,
  imageUrl: PublicExpertSchema.properties.imageUrl,
  showcases: Type.Array(PublicShowcaseSchema, { maxItems: 24 }),
}, { additionalProperties: false })

type ExpertRow = Readonly<{
  expert_id: string
  profile_json: unknown
  approved_at: string | Date
}>

type ApprovedExpert = Readonly<{
  profile: ExpertProfileRecord
  publicItem: PublicExpert
  showcases: readonly PublicShowcase[]
}>

function storedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return null }
}

function timestamp(value: string | Date): string {
  const epoch = new Date(value).getTime()
  if (!Number.isFinite(epoch)) throw new PublicProjectionUnavailableError('Approved expert timestamp failed validation.')
  return new Date(epoch).toISOString()
}

function approvedExpert(row: ExpertRow): ApprovedExpert {
  const document = storedJson(row.profile_json)
  if (typeof document !== 'object' || document === null) {
    throw new PublicProjectionUnavailableError('Approved expert document failed validation.')
  }
  const record = document as Record<string, unknown>
  let profile: ExpertProfileRecord
  try { profile = parseExpertContract(ExpertProfileRecordSchema, record.domain, 'public expert authority record') as ExpertProfileRecord }
  catch { throw new PublicProjectionUnavailableError('Approved expert authority failed validation.') }
  if (profile.expertId !== row.expert_id || profile.public.approvedAt !== timestamp(row.approved_at)) {
    throw new PublicProjectionUnavailableError('Approved expert release binding changed.')
  }
  if (!Value.Check(ExpertPublicDocumentSchema, record.public)) {
    throw new PublicProjectionUnavailableError('Approved expert display document failed validation.')
  }
  const display = record.public as typeof ExpertPublicDocumentSchema.static
  if (display.id !== profile.public.id || display.slug !== profile.public.slug
    || display.summary !== profile.public.summary || display.location !== profile.public.location
    || JSON.stringify(display.skills) !== JSON.stringify(profile.public.skills)
    || JSON.stringify(display.services) !== JSON.stringify(profile.public.services)
    || JSON.stringify(display.showcaseIds) !== JSON.stringify(profile.public.showcaseIds)
    || display.imageUrl !== profile.public.imageUrl) {
    throw new PublicProjectionUnavailableError('Approved expert display metadata changed outside FUMA-073 authority.')
  }
  const showcaseIds = new Set(display.showcases.map((item) => item.id))
  if (showcaseIds.size !== display.showcases.length || display.showcaseIds.some((id) => !showcaseIds.has(id))) {
    throw new PublicProjectionUnavailableError('Approved showcase attribution binding changed.')
  }
  const publicItem = {
    ...profile.public,
    mediatedInquiryAvailable: profile.public.mediatedInquiryAvailable && profile.availability !== 'unavailable',
  }
  if (!Value.Check(PublicExpertSchema, publicItem)) {
    throw new PublicProjectionUnavailableError('Approved expert projection failed validation.')
  }
  return Object.freeze({ profile, publicItem, showcases: Object.freeze([...display.showcases]) })
}

async function readApprovedExperts(db: DbClient): Promise<readonly ApprovedExpert[]> {
  const result = await db<ExpertRow>`
    select profile.expert_id,profile.profile_json,release.approved_at
    from fuma_expert_profiles profile
    join fuma_expert_public_releases release on release.release_id=profile.approved_release_id
      and release.expert_id=profile.expert_id and release.withdrawn_at is null
    join fuma_expert_attribution_consents expert_consent on expert_consent.release_id=release.release_id
      and expert_consent.party_kind='expert' and expert_consent.revoked_at is null
      and expert_consent.consent_version=profile.consent_version
    join fuma_expert_attribution_consents site_consent on site_consent.release_id=release.release_id
      and site_consent.party_kind='site-owner' and site_consent.revoked_at is null
    join fuma_organization_profiles organization on organization.organization_id=profile.organization_id
      and organization.kind='customer' and organization.status='active'
    join fuma_tenant_owner_keys owner on owner.platform_id=profile.profile_json->'domain'->'sourceScope'->>'platformId'
      and owner.organization_id=profile.profile_json->'domain'->'sourceScope'->>'organizationId'
      and owner.workspace_id=profile.profile_json->'domain'->'sourceScope'->>'workspaceId'
      and owner.site_id=profile.profile_json->'domain'->'sourceScope'->>'siteId'
      and owner.owner_key=profile.profile_json->'domain'->'sourceScope'->>'ownerKey'
      and owner.generation=(profile.profile_json->'domain'->'sourceScope'->>'ownerGeneration')::bigint
      and owner.state='active'
      and owner.transfer_id is null and owner.transfer_lock_id is null and owner.transfer_fence is null
    where profile.opted_in and not profile.suspended
      and profile.profile_json->'domain'->>'availability'<>'unavailable'
      and not exists (
        select 1 from lateral (
          select moderation.event from fuma_moderation_evidence_v2 moderation
          where moderation.subject_kind='expert' and moderation.subject_id=profile.expert_id
          order by moderation.created_at desc,moderation.evidence_id desc limit 1
        ) latest_moderation where latest_moderation.event='suspended'
      )
  `
  const items = result.rows.map(approvedExpert)
  items.sort((left, right) => Number(right.profile.availability === 'available') - Number(left.profile.availability === 'available')
    || right.profile.publicRevision - left.profile.publicRevision
    || left.profile.expertId.localeCompare(right.profile.expertId))
  return Object.freeze(items)
}

function expertFacets(items: readonly ApprovedExpert[]) {
  return Object.freeze({
    expertTypes: sortedUnique(items.map((item) => item.publicItem.expertType), 4),
    skills: sortedUnique(items.flatMap((item) => [...item.publicItem.skills]), 24),
    locations: sortedUnique(items.map((item) => item.publicItem.location), 100),
  })
}

function showcaseFacets(items: readonly PublicShowcase[]) {
  return Object.freeze({
    profiles: sortedUnique(items.flatMap((item) => [...item.profiles]), 2),
    industries: sortedUnique(items.flatMap((item) => [...item.industries]), 24),
  })
}

export class ApprovedExpertsProjectionSource implements ApprovedPublicProjectionSource {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }

  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const records = await readApprovedExperts(this.#db)
    const allItems = records.map((item) => item.publicItem)
    const filteredItems = records.filter(({ profile, publicItem }) => (
      (query.profile === undefined || (Value.Check(PublicProfileSchema, query.profile) && profile.supportedProfiles.includes(query.profile)))
      && (query.expertType === undefined || publicItem.expertType === query.expertType)
      && (query.skill === undefined || publicItem.skills.includes(String(query.skill)))
      && (query.location === undefined || publicItem.location.toLocaleLowerCase('en-KE').replace(/[^a-z0-9]+/g, '-') === query.location)
      && (query.slug === undefined || publicItem.slug === query.slug)
      && boundedSearchMatch(query.query, [publicItem.publicName, publicItem.summary, publicItem.location, ...publicItem.skills, ...publicItem.services])
    )).map((item) => item.publicItem)
    return paginatePublicDiscovery({ resource: 'experts', allItems, filteredItems, facets: expertFacets(records), query })
  }
}

export class ApprovedShowcasesProjectionSource implements ApprovedPublicProjectionSource {
  readonly #db: DbClient
  constructor(db: DbClient) { this.#db = db }

  async readApprovedDisplayPage(query: Readonly<Record<string, string | number>>) {
    const records = await readApprovedExperts(this.#db)
    const byId = new Map<string, PublicShowcase>()
    for (const record of records) {
      for (const showcase of record.showcases) {
        if (!showcase.expertIds.includes(record.publicItem.id) || !record.publicItem.showcaseIds.includes(showcase.id)) {
          throw new PublicProjectionUnavailableError('Approved showcase expert attribution changed.')
        }
        const existing = byId.get(showcase.id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(showcase)) {
          throw new PublicProjectionUnavailableError('Approved showcase identity is ambiguous.')
        }
        byId.set(showcase.id, showcase)
      }
    }
    const allItems = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
    const filteredItems = allItems.filter((item) => (
      (query.profile === undefined || (Value.Check(PublicProfileSchema, query.profile) && item.profiles.includes(query.profile)))
      && (query.industry === undefined || item.industries.includes(String(query.industry)))
      && (query.slug === undefined || item.slug === query.slug)
      && boundedSearchMatch(query.query, [item.title, item.summary, ...item.industries])
    ))
    return paginatePublicDiscovery({ resource: 'showcases', allItems, filteredItems, facets: showcaseFacets(allItems), query })
  }
}
