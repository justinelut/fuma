/**
 * Which model a freshly connected credential should default to.
 *
 * WHY THIS IS A MODULE RATHER THAN ONE LINE INSIDE THE CREATE HANDLER.
 *
 * The previous choice was `liveModels.find((m) => m.tier === 'smartest') ?? liveModels[0]`.
 * That works for Anthropic and OpenAI, whose drivers DO rank their models and label the
 * flagship 'smartest'. It does NOT work for OpenRouter, whose tiers are priced bands
 * (free/budget/standard/premium) with no capability ranking at all - so the find never matched
 * and OpenRouter fell through to `liveModels[0]`: whatever its API returned first, out of
 * hundreds of models.
 *
 * That is worse than it looks. "First in the response" is arbitrary, so two people connecting
 * OpenRouter on the same day can land on different defaults with nothing to explain why, and
 * the arbitrary pick is very often a paid model. Somebody who connected OpenRouter specifically
 * to use its FREE models ends up on a paid one - and if the account has no credit their first
 * request is refused before it generates, because providers reserve the whole output budget
 * against the balance up front (see task 17).
 *
 * SO THE PRECEDENCE IS DELIBERATE AND CONSERVATIVE:
 *   1. an explicit capability ranking from the driver ('smartest') is honoured FIRST, so
 *      connecting a paid Anthropic or OpenAI key behaves exactly as it did;
 *   2. failing that, a FREE model, which is what surfaces OpenRouter's free tier;
 *   3. failing that, the cheapest, chosen deterministically.
 * Putting free above the capability ranking would silently downgrade a paid key's default,
 * which nobody asked for. No provider today publishes both, so this ordering changes nothing
 * that currently works - it only replaces the arbitrary fallback.
 */

/**
 * The tier a driver uses to mark its most capable model. Named here so the dependency on that
 * string is visible in one place rather than inlined in a condition.
 */
export const CAPABILITY_TIER = 'smartest'

export interface DefaultModelCandidate {
  readonly id: string
  readonly label: string
  readonly tier?: string
  readonly pricing?: { readonly inputPerMTok: number, readonly outputPerMTok: number }
  readonly contextWindow?: number
}

export type DefaultModelChoice = Readonly<{
  modelId: string
  /** Why this model was chosen, so the reason can be surfaced and audited. */
  reason: 'most-capable' | 'free' | 'cheapest' | 'only-option'
  /**
   * How many free models the provider published. Reported even when a free model was NOT
   * chosen, because "this provider has N free models" is the fact somebody connecting a
   * spend-conscious account most wants, and it is otherwise buried in a long list.
   */
  freeModelCount: number
}>

/** A model is free only when BOTH directions are priced at zero. */
export function isFreeModel(model: DefaultModelCandidate): boolean {
  // Absent pricing is NOT free. Ollama publishes no prices because it is local, but an
  // uncatalogued hosted model also publishes none - and treating unknown as free would
  // default somebody onto a model that then bills them.
  if (!model.pricing) return false
  return model.pricing.inputPerMTok === 0 && model.pricing.outputPerMTok === 0
}

/** Free models a provider published, most capable first by context window. */
export function freeModels(models: readonly DefaultModelCandidate[]): readonly DefaultModelCandidate[] {
  return models
    .filter(isFreeModel)
    .sort((left, right) => {
      // Context window is the only capability signal the catalogue carries for every model, and
      // among free models it is the difference between one that can hold a real conversation
      // and one that cannot.
      const byContext = (right.contextWindow ?? 0) - (left.contextWindow ?? 0)
      if (byContext !== 0) return byContext
      // Then by label so the pick is STABLE. Leaving ties to input order reintroduces exactly
      // the arbitrariness this module exists to remove.
      return left.label.localeCompare(right.label)
    })
}

/**
 * Choose the default, or null when there is nothing to choose from.
 *
 * Deterministic by construction: every comparison ends in a label tiebreak, so the same
 * catalogue always yields the same default and a changed default means the catalogue changed.
 */
export function chooseDefaultModel(
  models: readonly DefaultModelCandidate[],
): DefaultModelChoice | null {
  if (models.length === 0) return null

  // 1. The driver's own capability ranking, where it has one. Anthropic labels the newest Opus
  // and OpenAI the flagship GPT/o-series this way, and a paid key should keep landing there.
  const ranked = models.find((model) => model.tier === CAPABILITY_TIER)
  if (ranked) {
    return Object.freeze({
      modelId: ranked.id,
      reason: 'most-capable' as const,
      // Still counted and reported: a provider could add free models later, and the number is
      // useful even when it did not decide the default.
      freeModelCount: freeModels(models).length,
    })
  }

  const free = freeModels(models)
  if (free.length > 0 && free[0]) {
    return Object.freeze({ modelId: free[0].id, reason: 'free' as const, freeModelCount: free.length })
  }

  if (models.length === 1 && models[0]) {
    // Stated as its own reason rather than reported as "cheapest": calling a sole option the
    // cheapest implies a comparison that did not happen.
    return Object.freeze({ modelId: models[0].id, reason: 'only-option' as const, freeModelCount: 0 })
  }

  // No free model: the cheapest that IS priced. A provider with no prices at all (Ollama)
  // falls back to the stable label order rather than to input order.
  const cheapest = [...models].sort((left, right) => {
    const leftPrice = left.pricing?.inputPerMTok ?? Number.POSITIVE_INFINITY
    const rightPrice = right.pricing?.inputPerMTok ?? Number.POSITIVE_INFINITY
    if (leftPrice !== rightPrice) return leftPrice - rightPrice
    return left.label.localeCompare(right.label)
  })[0]
  if (!cheapest) return null
  return Object.freeze({ modelId: cheapest.id, reason: 'cheapest' as const, freeModelCount: 0 })
}

/**
 * One sentence for the person who just connected, so the default reads as explained.
 *
 * Says what was chosen AND that it can be changed, because a default nobody knows is a default
 * is indistinguishable from a limitation of the product.
 */
export function describeDefaultChoice(choice: DefaultModelChoice): string {
  if (choice.reason === 'most-capable') {
    return 'Connected. Defaulted to this provider\'s most capable model; you can pick another at any time.'
  }
  if (choice.reason === 'free') {
    return choice.freeModelCount === 1
      ? 'Connected. Defaulted to the one model this provider offers free of charge; you can pick another at any time.'
      : `Connected. ${choice.freeModelCount} free models are available and the most capable one is now the default; you can pick another at any time.`
  }
  if (choice.reason === 'only-option') {
    return 'Connected. This provider published a single model, which is now the default.'
  }
  return 'Connected. No free models were published, so the cheapest one is the default; you can pick another at any time.'
}
