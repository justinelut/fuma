import type { FumaJobRecord } from './contracts'

interface SiteBucket {
  id: string
  weight: number
  jobs: FumaJobRecord[]
}

interface OrganizationBucket {
  id: string
  weight: number
  sites: SiteBucket[]
  siteCursor: number
}

function compareJobs(left: FumaJobRecord, right: FumaJobRecord): number {
  return right.priority - left.priority
    || Date.parse(left.runAt) - Date.parse(right.runAt)
    || Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.id.localeCompare(right.id)
}

function expandedSites(sites: readonly SiteBucket[]): SiteBucket[] {
  return sites.flatMap((site) => Array.from({ length: site.weight }, () => site))
}

function nextFromOrganization(organization: OrganizationBucket): FumaJobRecord | null {
  const ring = expandedSites(organization.sites.filter((site) => site.jobs.length > 0))
  if (ring.length === 0) return null
  const site = ring[organization.siteCursor % ring.length]!
  organization.siteCursor = (organization.siteCursor + 1) % ring.length
  return site.jobs.shift() ?? null
}

/**
 * Nested weighted round-robin. Priority orders work inside one site, while organization and site
 * weights control cross-tenant shares so one noisy tenant cannot monopolize a replenishment batch.
 */
export function weightedFairJobOrder(jobs: readonly FumaJobRecord[]): FumaJobRecord[] {
  const organizations = new Map<string, Map<string, SiteBucket>>()
  for (const job of jobs) {
    let sites = organizations.get(job.organizationId)
    if (!sites) {
      sites = new Map()
      organizations.set(job.organizationId, sites)
    }
    const siteId = job.siteId ?? ''
    let site = sites.get(siteId)
    if (!site) {
      site = { id: siteId, weight: job.siteWeight, jobs: [] }
      sites.set(siteId, site)
    }
    site.weight = Math.max(site.weight, job.siteWeight)
    site.jobs.push(job)
  }

  const buckets: OrganizationBucket[] = [...organizations].map(([id, sites]) => {
    const siteBuckets = [...sites.values()].sort((left, right) => left.id.localeCompare(right.id))
    for (const site of siteBuckets) site.jobs.sort(compareJobs)
    return {
      id,
      weight: Math.max(...siteBuckets.flatMap((site) => site.jobs.map((job) => job.organizationWeight))),
      sites: siteBuckets,
      siteCursor: 0,
    }
  }).sort((left, right) => left.id.localeCompare(right.id))

  const ordered: FumaJobRecord[] = []
  while (ordered.length < jobs.length) {
    let progressed = false
    for (const organization of buckets) {
      for (let share = 0; share < organization.weight; share += 1) {
        const job = nextFromOrganization(organization)
        if (!job) break
        ordered.push(job)
        progressed = true
      }
    }
    if (!progressed) break
  }
  return ordered
}
