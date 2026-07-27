import { describe, expect, it } from 'bun:test'
import {
  createFumaRegistry,
  fumaLaunchRegistry,
  type CapabilityOverrides,
} from '@core/fuma'
import type { SiteRecord } from '../../../server/fuma/sites/contracts'
import {
  StarterTemplateApplicationError,
  StarterTemplateApplicationService,
  type StarterTemplateApplier,
  type StarterTemplateApplicationReceipt,
  type StarterTemplateApplicationRepository,
  type StarterTemplateEffectOnceInput,
  type StarterTemplateEffectOnceResult,
} from '../../../server/fuma/onboarding'

interface EffectTransaction {
  applied: string[]
}

const NOW = '2026-07-24T20:42:45.859Z'
const EMPTY_OVERRIDES: CapabilityOverrides = { grant: [], revoke: [] }

function site(
  id: string,
  profileId: string,
  capabilityOverrides: CapabilityOverrides = EMPTY_OVERRIDES,
): SiteRecord {
  return {
    id,
    organizationId: 'organization-a',
    workspaceId: 'workspace-a',
    slug: id,
    name: id,
    status: 'active',
    profileId,
    capabilityOverrides: structuredClone(capabilityOverrides),
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function receiptKey(receipt: StarterTemplateApplicationReceipt): string {
  return `${receipt.organizationId}:${receipt.workspaceId}:${receipt.siteId}:${receipt.templateId}`
}

class InMemoryStarterTemplateRepository
implements StarterTemplateApplicationRepository<EffectTransaction> {
  sites = new Map<string, SiteRecord>()
  receipts = new Map<string, StarterTemplateApplicationReceipt>()
  applied: string[] = []
  beforeAtomic: (() => void) | undefined
  #tail: Promise<void> = Promise.resolve()

  addSite(record: SiteRecord): void {
    this.sites.set(record.id, structuredClone(record))
  }

  getOwnedSite(
    organizationId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<SiteRecord | null> {
    const record = this.sites.get(siteId)
    if (
      !record
      || record.organizationId !== organizationId
      || record.workspaceId !== workspaceId
    ) return Promise.resolve(null)
    return Promise.resolve(structuredClone(record))
  }

  async runTemplateEffectOnce(
    input: StarterTemplateEffectOnceInput,
    effect: (transaction: EffectTransaction) => Promise<void>,
  ): Promise<StarterTemplateEffectOnceResult> {
    const previous = this.#tail
    let release = (): void => {}
    this.#tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      this.beforeAtomic?.()
      this.beforeAtomic = undefined
      const current = this.sites.get(input.expectedSite.id) ?? null
      if (JSON.stringify(current) !== JSON.stringify(input.expectedSite)) {
        return { status: 'site-drift', site: structuredClone(current) }
      }
      const key = receiptKey(input.receipt)
      const existing = this.receipts.get(key)
      if (existing) {
        return { status: 'replayed', receipt: structuredClone(existing) }
      }

      const appliedSnapshot = [...this.applied]
      const receiptSnapshot = structuredClone(this.receipts)
      try {
        await effect({ applied: this.applied })
        this.receipts.set(key, structuredClone(input.receipt))
      } catch (error) {
        this.applied = appliedSnapshot
        this.receipts = receiptSnapshot
        throw error
      }
      return { status: 'applied', receipt: structuredClone(input.receipt) }
    } finally {
      release()
    }
  }
}

function appliers(
  templateIds: readonly string[],
  apply?: (templateId: string, transaction: EffectTransaction) => Promise<void>,
): StarterTemplateApplier<EffectTransaction>[] {
  return templateIds.map((templateId) => ({
    templateId,
    async apply(_input, transaction) {
      if (apply) await apply(templateId, transaction)
      else transaction.applied.push(templateId)
    },
  }))
}

function command(siteId: string, templateIds: string[]) {
  return {
    organizationId: 'organization-a',
    workspaceId: 'workspace-a',
    siteId,
    templateIds,
  }
}

function applicationError(code: StarterTemplateApplicationError['code']) {
  return expect.objectContaining({ name: 'StarterTemplateApplicationError', code })
}

const LAUNCH_TEMPLATE_IDS = [
  'website.blank',
  'pages.blank',
  'publication.editorial',
  'publication.newsletter',
]

describe('FUMA-017 starter-template application', () => {
  it('applies Website and Publication setup in deterministic registry order', async () => {
    const repository = new InMemoryStarterTemplateRepository()
    repository.addSite(site('website-site', 'website'))
    repository.addSite(site('publication-site', 'publication'))
    const service = new StarterTemplateApplicationService({
      repository,
      registry: fumaLaunchRegistry,
      appliers: appliers(LAUNCH_TEMPLATE_IDS),
      now: () => new Date(NOW),
    })

    const website = await service.apply(command('website-site', [
      'pages.blank',
      'website.blank',
    ]))
    expect(website.appliedTemplateIds).toEqual(['website.blank', 'pages.blank'])

    const publication = await service.apply(command('publication-site', [
      'website.blank',
      'pages.blank',
      'publication.newsletter',
      'publication.editorial',
    ]))
    expect(publication.appliedTemplateIds).toEqual([
      'publication.editorial',
      'publication.newsletter',
      'pages.blank',
      'website.blank',
    ])
    expect(repository.applied).toEqual([
      'website.blank',
      'pages.blank',
      'publication.editorial',
      'publication.newsletter',
      'pages.blank',
      'website.blank',
    ])
  })

  it('resumes after interruption without duplicating completed effects', async () => {
    const repository = new InMemoryStarterTemplateRepository()
    repository.addSite(site('resume-site', 'website'))
    let failPages = true
    const service = new StarterTemplateApplicationService({
      repository,
      registry: fumaLaunchRegistry,
      appliers: appliers(LAUNCH_TEMPLATE_IDS, async (templateId, transaction) => {
        transaction.applied.push(templateId)
        if (templateId === 'pages.blank' && failPages) {
          failPages = false
          throw new Error('simulated interruption')
        }
      }),
      now: () => new Date(NOW),
    })

    await expect(service.apply(command('resume-site', [
      'website.blank',
      'pages.blank',
    ]))).rejects.toThrow('simulated interruption')
    expect(repository.applied).toEqual(['website.blank'])
    expect(repository.receipts.size).toBe(1)

    const resumed = await service.apply(command('resume-site', [
      'pages.blank',
      'website.blank',
    ]))
    expect(resumed.replayedTemplateIds).toEqual(['website.blank'])
    expect(resumed.appliedTemplateIds).toEqual(['pages.blank'])
    expect(repository.applied).toEqual(['website.blank', 'pages.blank'])
    expect(repository.receipts.size).toBe(2)
  })

  it('executes one effect for concurrent calls and replays the durable receipt', async () => {
    const repository = new InMemoryStarterTemplateRepository()
    repository.addSite(site('concurrent-site', 'website'))
    const service = new StarterTemplateApplicationService({
      repository,
      registry: fumaLaunchRegistry,
      appliers: appliers(LAUNCH_TEMPLATE_IDS, async (templateId, transaction) => {
        await Bun.sleep(5)
        transaction.applied.push(templateId)
      }),
      now: () => new Date(NOW),
    })

    const [left, right] = await Promise.all([
      service.apply(command('concurrent-site', ['website.blank'])),
      service.apply(command('concurrent-site', ['website.blank'])),
    ])
    expect(repository.applied).toEqual(['website.blank'])
    expect(repository.receipts.size).toBe(1)
    expect([
      ...left.appliedTemplateIds,
      ...right.appliedTemplateIds,
    ]).toEqual(['website.blank'])
    expect([
      ...left.replayedTemplateIds,
      ...right.replayedTemplateIds,
    ]).toEqual(['website.blank'])

    const replay = await service.apply(command('concurrent-site', ['website.blank']))
    expect(replay.appliedTemplateIds).toEqual([])
    expect(replay.replayedTemplateIds).toEqual(['website.blank'])
  })

  it('keeps revoked templates unavailable and rejects IDs outside the applier allowlist', async () => {
    const repository = new InMemoryStarterTemplateRepository()
    repository.addSite(site('revoked-site', 'website', {
      grant: [],
      revoke: ['website.design'],
    }))
    const service = new StarterTemplateApplicationService({
      repository,
      registry: fumaLaunchRegistry,
      appliers: appliers(LAUNCH_TEMPLATE_IDS),
    })

    await expect(service.apply(command('revoked-site', ['website.blank'])))
      .rejects.toEqual(applicationError('unavailable-template'))
    await expect(service.apply(command('revoked-site', ['untrusted.template'])))
      .rejects.toEqual(applicationError('unknown-template'))
    expect(repository.applied).toEqual([])
  })

  it('rejects site, profile, and composition drift against durable receipts', async () => {
    const repository = new InMemoryStarterTemplateRepository()
    repository.addSite(site('drift-site', 'website'))
    const service = new StarterTemplateApplicationService({
      repository,
      registry: fumaLaunchRegistry,
      appliers: appliers(LAUNCH_TEMPLATE_IDS),
      now: () => new Date(NOW),
    })
    await service.apply(command('drift-site', ['website.blank']))

    const current = repository.sites.get('drift-site') as SiteRecord
    repository.sites.set('drift-site', { ...current, profileId: 'publication' })
    await expect(service.apply(command('drift-site', ['website.blank'])))
      .rejects.toEqual(applicationError('profile-drift'))

    repository.sites.set('drift-site', {
      ...current,
      capabilityOverrides: { grant: ['publication.editorial'], revoke: [] },
    })
    await expect(service.apply(command('drift-site', ['website.blank'])))
      .rejects.toEqual(applicationError('composition-drift'))

    repository.sites.set('drift-site', current)
    repository.beforeAtomic = () => {
      const record = repository.sites.get('drift-site') as SiteRecord
      repository.sites.set('drift-site', { ...record, name: 'renamed concurrently' })
    }
    await expect(service.apply(command('drift-site', ['pages.blank'])))
      .rejects.toEqual(applicationError('site-drift'))
  })

  it('applies an extension-contributed template without shared profile branches', async () => {
    const registry = createFumaRegistry({
      capabilities: [{
        id: 'extension.catalog',
        starterTemplates: [{
          id: 'starter.extension-catalog',
          order: 5,
          label: 'Catalog',
          templateId: 'extension.catalog',
        }],
      }],
      profiles: [{
        id: 'extension-profile',
        label: 'Extension profile',
        capabilityPreset: ['extension.catalog'],
        navigationPreset: [],
        onboardingPreset: [],
        starterTemplatePreset: ['starter.extension-catalog'],
      }],
    })
    const repository = new InMemoryStarterTemplateRepository()
    repository.addSite(site('extension-site', 'extension-profile'))
    const service = new StarterTemplateApplicationService({
      repository,
      registry,
      appliers: appliers(['extension.catalog']),
      now: () => new Date(NOW),
    })

    const result = await service.apply(command('extension-site', ['extension.catalog']))
    expect(result.appliedTemplateIds).toEqual(['extension.catalog'])
    expect(result.receipts[0]).toMatchObject({
      contributionId: 'starter.extension-catalog',
      templateId: 'extension.catalog',
      profileId: 'extension-profile',
    })
    expect(repository.applied).toEqual(['extension.catalog'])
  })
})
