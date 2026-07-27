import {
  FumaRegistryError,
  type ComposedProductProfile,
  type FumaRegistry,
  type StarterTemplateContribution,
} from '@core/fuma'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import { SiteRecordSchema, type SiteRecord } from '../sites/contracts'
import {
  StarterTemplateApplicationCommandSchema,
  StarterTemplateApplicationError,
  StarterTemplateApplicationReceiptSchema,
  StarterTemplateIdSchema,
  type StarterTemplateApplier,
  type StarterTemplateApplicationCommand,
  type StarterTemplateApplicationReceipt,
  type StarterTemplateApplicationRepository,
  type StarterTemplateApplicationResult,
  type StarterTemplateEffectInput,
  type StarterTemplateEffectOnceResult,
} from './contracts'

export interface StarterTemplateApplicationServiceOptions<EffectTransaction> {
  repository: StarterTemplateApplicationRepository<EffectTransaction>
  registry: FumaRegistry
  appliers: readonly StarterTemplateApplier<EffectTransaction>[]
  now?: () => Date
}

interface ResolvedApplication<EffectTransaction> {
  site: SiteRecord
  compositionFingerprint: string
  templates: readonly {
    contribution: StarterTemplateContribution
    applier: StarterTemplateApplier<EffectTransaction>
  }[]
}

function applicationError(
  code: ConstructorParameters<typeof StarterTemplateApplicationError>[0],
  message: string,
  siteId?: string,
  templateId?: string,
): never {
  throw new StarterTemplateApplicationError(code, message, { siteId, templateId })
}

function parseCommand(input: unknown): StarterTemplateApplicationCommand {
  const parsed = safeParseValue(StarterTemplateApplicationCommandSchema, input)
  if (!parsed.ok) {
    applicationError('invalid-command', 'Starter-template application command is invalid.')
  }
  return parsed.value
}

function parseSite(value: unknown, command: StarterTemplateApplicationCommand): SiteRecord {
  if (value === null) {
    applicationError(
      'site-not-found',
      `Site ${command.siteId} does not exist in the requested organization and workspace.`,
      command.siteId,
    )
  }
  const parsed = safeParseValue(SiteRecordSchema, value)
  if (!parsed.ok) {
    applicationError('site-drift', 'Starter-template site record is invalid.', command.siteId)
  }
  const site = parsed.value
  if (
    site.id !== command.siteId
    || site.organizationId !== command.organizationId
    || site.workspaceId !== command.workspaceId
  ) {
    applicationError(
      'site-drift',
      'Starter-template site ownership drifted from the requested scope.',
      command.siteId,
    )
  }
  return site
}

function normalizedOverrides(site: SiteRecord): { grant: string[]; revoke: string[] } {
  return {
    grant: [...site.capabilityOverrides.grant].toSorted(),
    revoke: [...site.capabilityOverrides.revoke].toSorted(),
  }
}

function sameOverrides(left: SiteRecord, right: SiteRecord): boolean {
  return JSON.stringify(normalizedOverrides(left)) === JSON.stringify(normalizedOverrides(right))
}

function compositionFingerprint(
  site: SiteRecord,
  composition: ComposedProductProfile,
): string {
  return JSON.stringify({
    profileId: site.profileId,
    capabilityOverrides: normalizedOverrides(site),
    capabilities: composition.capabilities.map(({ id }) => id),
    starterTemplates: composition.starterTemplates.map(({ id, order, templateId }) => ({
      id,
      order,
      templateId,
    })),
  })
}

function composeSite(site: SiteRecord, registry: FumaRegistry): ComposedProductProfile {
  try {
    return registry.compose(site.profileId, site.capabilityOverrides)
  } catch (error) {
    if (error instanceof FumaRegistryError) {
      applicationError(
        error.code === 'unknown-profile' ? 'profile-drift' : 'composition-drift',
        `Site ${site.id} can no longer be composed: ${error.message}`,
        site.id,
      )
    }
    throw error
  }
}

function assertCurrentSite(expected: SiteRecord, current: unknown): never {
  if (current === null) {
    applicationError('site-drift', `Site ${expected.id} disappeared during starter setup.`, expected.id)
  }
  const parsed = safeParseValue(SiteRecordSchema, current)
  if (!parsed.ok) {
    applicationError('site-drift', 'Starter-template site record drifted to an invalid value.', expected.id)
  }
  const site = parsed.value
  if (
    site.id !== expected.id
    || site.organizationId !== expected.organizationId
    || site.workspaceId !== expected.workspaceId
  ) {
    applicationError('site-drift', 'Site ownership drifted during starter setup.', expected.id)
  }
  if (site.profileId !== expected.profileId) {
    applicationError('profile-drift', 'Site profile drifted during starter setup.', expected.id)
  }
  if (!sameOverrides(site, expected)) {
    applicationError('composition-drift', 'Site capability composition drifted during starter setup.', expected.id)
  }
  applicationError('site-drift', 'Site record drifted during starter setup.', expected.id)
}

function assertMatchingReceipt(
  value: unknown,
  expected: StarterTemplateApplicationReceipt,
): StarterTemplateApplicationReceipt {
  const parsed = safeParseValue(StarterTemplateApplicationReceiptSchema, value)
  if (!parsed.ok) {
    applicationError(
      'receipt-conflict',
      `Stored receipt for template ${expected.templateId} is invalid.`,
      expected.siteId,
      expected.templateId,
    )
  }
  const receipt = parsed.value
  if (
    receipt.organizationId !== expected.organizationId
    || receipt.workspaceId !== expected.workspaceId
    || receipt.siteId !== expected.siteId
  ) {
    applicationError(
      'site-drift',
      `Stored receipt for template ${expected.templateId} belongs to another site scope.`,
      expected.siteId,
      expected.templateId,
    )
  }
  if (receipt.profileId !== expected.profileId) {
    applicationError(
      'profile-drift',
      `Stored receipt for template ${expected.templateId} belongs to another profile.`,
      expected.siteId,
      expected.templateId,
    )
  }
  if (
    JSON.stringify(receipt.capabilityOverrides) !== JSON.stringify(expected.capabilityOverrides)
    || receipt.compositionFingerprint !== expected.compositionFingerprint
  ) {
    applicationError(
      'composition-drift',
      `Stored receipt for template ${expected.templateId} belongs to another composition.`,
      expected.siteId,
      expected.templateId,
    )
  }
  if (
    receipt.templateId !== expected.templateId
    || receipt.contributionId !== expected.contributionId
  ) {
    applicationError(
      'receipt-conflict',
      `Stored receipt conflicts with template ${expected.templateId}.`,
      expected.siteId,
      expected.templateId,
    )
  }
  return receipt
}

export class StarterTemplateApplicationService<EffectTransaction> {
  readonly #repository: StarterTemplateApplicationRepository<EffectTransaction>
  readonly #registry: FumaRegistry
  readonly #appliers: ReadonlyMap<string, StarterTemplateApplier<EffectTransaction>>
  readonly #now: () => Date

  constructor(options: StarterTemplateApplicationServiceOptions<EffectTransaction>) {
    this.#repository = options.repository
    this.#registry = options.registry
    this.#now = options.now ?? (() => new Date())

    const appliers = new Map<string, StarterTemplateApplier<EffectTransaction>>()
    for (const applier of options.appliers) {
      if (!safeParseValue(StarterTemplateIdSchema, applier.templateId).ok) {
        throw new TypeError(`Starter-template applier ID "${applier.templateId}" is invalid.`)
      }
      if (appliers.has(applier.templateId)) {
        throw new TypeError(`Starter-template applier ID "${applier.templateId}" is duplicated.`)
      }
      appliers.set(applier.templateId, applier)
    }
    this.#appliers = appliers
  }

  async #resolve(input: unknown): Promise<ResolvedApplication<EffectTransaction>> {
    const command = parseCommand(input)
    const site = parseSite(await this.#repository.getOwnedSite(
      command.organizationId,
      command.workspaceId,
      command.siteId,
    ), command)
    const composition = composeSite(site, this.#registry)

    const contributionByTemplateId = new Map<string, StarterTemplateContribution>()
    for (const contribution of composition.starterTemplates) {
      if (contributionByTemplateId.has(contribution.templateId)) {
        applicationError(
          'composition-drift',
          `Composition contributes template ${contribution.templateId} more than once.`,
          site.id,
          contribution.templateId,
        )
      }
      contributionByTemplateId.set(contribution.templateId, contribution)
    }

    for (const templateId of command.templateIds) {
      if (!this.#appliers.has(templateId)) {
        applicationError(
          'unknown-template',
          `Template ${templateId} has no allowlisted applier.`,
          site.id,
          templateId,
        )
      }
      if (!contributionByTemplateId.has(templateId)) {
        applicationError(
          'unavailable-template',
          `Template ${templateId} is not contributed by the site's current composition.`,
          site.id,
          templateId,
        )
      }
    }

    const requested = new Set(command.templateIds)
    const templates = composition.starterTemplates
      .filter(({ templateId }) => requested.has(templateId))
      .map((contribution) => {
        const applier = this.#appliers.get(contribution.templateId)
        if (!applier) {
          applicationError(
            'unknown-template',
            `Template ${contribution.templateId} has no allowlisted applier.`,
            site.id,
            contribution.templateId,
          )
        }
        return { contribution, applier }
      })

    return {
      site,
      compositionFingerprint: compositionFingerprint(site, composition),
      templates,
    }
  }

  async apply(input: unknown): Promise<StarterTemplateApplicationResult> {
    const resolved = await this.#resolve(input)
    const appliedTemplateIds: string[] = []
    const replayedTemplateIds: string[] = []
    const receipts: StarterTemplateApplicationReceipt[] = []

    for (const { contribution, applier } of resolved.templates) {
      const now = this.#now()
      if (!Number.isFinite(now.getTime())) {
        applicationError('invalid-command', 'Starter-template service clock returned an invalid date.')
      }
      const receipt: StarterTemplateApplicationReceipt = {
        organizationId: resolved.site.organizationId,
        workspaceId: resolved.site.workspaceId,
        siteId: resolved.site.id,
        profileId: resolved.site.profileId,
        capabilityOverrides: normalizedOverrides(resolved.site),
        compositionFingerprint: resolved.compositionFingerprint,
        contributionId: contribution.id,
        templateId: contribution.templateId,
        appliedAt: now.toISOString(),
      }
      const effectInput: StarterTemplateEffectInput = {
        organizationId: resolved.site.organizationId,
        workspaceId: resolved.site.workspaceId,
        siteId: resolved.site.id,
        profileId: resolved.site.profileId,
        contributionId: contribution.id,
        templateId: contribution.templateId,
      }
      const outcome: StarterTemplateEffectOnceResult = await this.#repository
        .runTemplateEffectOnce(
          { expectedSite: resolved.site, receipt },
          async (transaction) => {
            await applier.apply(effectInput, transaction)
          },
        )

      if (outcome.status === 'site-drift') {
        assertCurrentSite(resolved.site, outcome.site)
      }
      const storedReceipt = assertMatchingReceipt(outcome.receipt, receipt)
      receipts.push(storedReceipt)
      if (outcome.status === 'applied') appliedTemplateIds.push(contribution.templateId)
      else replayedTemplateIds.push(contribution.templateId)
    }

    return {
      site: resolved.site,
      receipts,
      appliedTemplateIds,
      replayedTemplateIds,
    }
  }
}
