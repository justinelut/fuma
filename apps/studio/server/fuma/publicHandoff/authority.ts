import {
  PublicExpertSchema,
  PublicPricingDisplayPlanSchema,
  type PublicExpert,
  type PublicHandoffRequest,
  type PublicPricingDisplayPlan,
} from '@fuma/public-contracts'
import { Value } from '@sinclair/typebox/value'
import { fumaLaunchRegistry, type FumaRegistry } from '@core/fuma'
import type { PublicProjectionAuthority } from '../publicProjections'
import type { PublicTemplateCatalogService } from '../publicTemplates'
import { AppHandoffResolutionSchema, parseHandoffValue, type AppHandoffResolution } from './contracts'

export class PublicHandoffAuthorityError extends Error {
  constructor() {
    super('Current product authority rejected the public handoff.')
    this.name = 'PublicHandoffAuthorityError'
  }
}

export interface PublicHandoffResolutionAuthority {
  resolve(request: PublicHandoffRequest): Promise<AppHandoffResolution>
}

function resolution(value: unknown): AppHandoffResolution {
  return parseHandoffValue(AppHandoffResolutionSchema, value, 'App handoff resolution')
}

export class HostedPublicHandoffResolutionAuthority implements PublicHandoffResolutionAuthority {
  readonly #projections: PublicProjectionAuthority
  readonly #templates: PublicTemplateCatalogService
  readonly #registry: FumaRegistry

  constructor(input: Readonly<{ projections: PublicProjectionAuthority; templates: PublicTemplateCatalogService; registry?: FumaRegistry }>) {
    this.#projections = input.projections
    this.#templates = input.templates
    this.#registry = input.registry ?? fumaLaunchRegistry
  }

  async resolve(request: PublicHandoffRequest): Promise<AppHandoffResolution> {
    try {
      if (request.kind === 'sign_up' || request.kind === 'sign_in') {
        if (request.profile) this.#registry.compose(request.profile)
        return resolution(request)
      }
      if (request.kind === 'create_site') {
        this.#registry.compose(request.profile)
        return resolution(request)
      }
      if (request.kind === 'choose_plan') {
        const current = await this.#projections.read({
          resource: 'pricing',
          query: Object.freeze({ cadence: request.cadence, limit: 100 }),
        }) as Readonly<{ data?: Readonly<{ effectiveVersion?: unknown; items?: unknown }> }>
        const items = Array.isArray(current.data?.items) ? current.data.items : []
        const plan = items.find((item): item is PublicPricingDisplayPlan => (
          Value.Check(PublicPricingDisplayPlanSchema, item)
          && (item as PublicPricingDisplayPlan).planId === request.planId
          && (item as PublicPricingDisplayPlan).cadence === request.cadence
        ))
        if (!plan || typeof current.data?.effectiveVersion !== 'string' || !plan.checkoutAvailable) throw new PublicHandoffAuthorityError()
        this.#registry.compose(plan.profile)
        return resolution({
          kind: request.kind,
          source: request.source,
          planId: plan.planId,
          priceBookVersion: current.data.effectiveVersion,
          cadence: plan.cadence,
          profile: plan.profile,
        })
      }
      if (request.kind === 'use_template') {
        const current = await this.#templates.resolveInstallIntent(request.templateId)
        for (const profile of current.profiles) this.#registry.compose(profile)
        return resolution({
          kind: request.kind,
          source: request.source,
          templateId: current.templateId,
          releaseId: current.releaseAuthority.releaseId,
          profiles: current.profiles,
          authorityVersion: current.authorityVersion,
        })
      }
      const current = await this.#projections.read({ resource: 'experts', query: Object.freeze({ limit: 100 }) }) as Readonly<{ data?: Readonly<{ items?: unknown }> }>
      const items = Array.isArray(current.data?.items) ? current.data.items : []
      const expert = items.find((item): item is PublicExpert => (
        Value.Check(PublicExpertSchema, item)
        && item.id === request.expertId
        && item.mediatedInquiryAvailable === true
      ))
      if (!expert) throw new PublicHandoffAuthorityError()
      return resolution(request)
    } catch (error) {
      if (error instanceof PublicHandoffAuthorityError) throw error
      throw new PublicHandoffAuthorityError()
    }
  }
}
