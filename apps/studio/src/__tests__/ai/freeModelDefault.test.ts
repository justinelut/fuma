/**
 * Task 18: surface OpenRouter free models after connecting.
 *
 * The catalogue already LABELLED free models (openrouter.ts tierFor returns 'free' at zero
 * price) and the picker already groups them first. What did not work was the moment of
 * connecting.
 *
 * The auto-default looked for `tier === 'smartest'`. Anthropic and OpenAI DO set that on their
 * flagship, so it worked for them. OpenRouter's tiers are PRICE BANDS with no capability
 * ranking, so the find never matched and it fell through to `liveModels[0]` - whatever its API
 * returned first, out of hundreds, very often paid.
 */
import { describe, expect, it } from 'bun:test'
import {
  chooseDefaultModel,
  describeDefaultChoice,
  freeModels,
  isFreeModel,
  CAPABILITY_TIER,
  type DefaultModelCandidate,
} from '../../../server/ai/handlers/defaultModelChoice'

const free = (id: string, label: string, contextWindow?: number): DefaultModelCandidate => ({
  id, label, contextWindow, pricing: { inputPerMTok: 0, outputPerMTok: 0 },
})
const paid = (id: string, label: string, inputPerMTok: number): DefaultModelCandidate => ({
  id, label, pricing: { inputPerMTok, outputPerMTok: inputPerMTok * 2 },
})

describe('the branch was dead for OpenRouter only', () => {
  it('Anthropic and OpenAI DO rank their models, so their behaviour must not change', async () => {
    // Established by reading the drivers. An earlier check of mine used `grep -v test`, which
    // silently filtered every line containing "smarTESTt" and made this look universally dead -
    // acting on that would have downgraded every paid key's default to the cheapest model.
    for (const driver of ['anthropic.ts', 'openai.ts']) {
      const text = await Bun.file(new URL(`../../../server/ai/drivers/${driver}`, import.meta.url)).text()
      expect(text).toContain(CAPABILITY_TIER)
    }
  })

  it('OpenRouter publishes PRICE bands, not a capability ranking', async () => {
    const text = await Bun.file(new URL('../../../server/ai/drivers/openrouter.ts', import.meta.url)).text()
    expect(text).toContain("return 'free'")
    // No capability tier anywhere, which is exactly why the old find could never match here.
    expect(text).not.toContain(CAPABILITY_TIER)
  })

  it('the handler no longer takes whatever came first', async () => {
    const text = await Bun.file(new URL('../../../server/ai/handlers/credentials.ts', import.meta.url)).text()
    expect(text).toContain('chooseDefaultModel(liveModels)')
    // The old expression must be gone from class position; the comment explaining it may remain.
    expect(text).not.toMatch(/const top = liveModels\.find/)
  })
})

describe('isFreeModel', () => {
  it('requires both directions to be zero', () => {
    expect(isFreeModel(free('a', 'A'))).toBe(true)
    expect(isFreeModel({ id: 'b', label: 'B', pricing: { inputPerMTok: 0, outputPerMTok: 5 } })).toBe(false)
  })

  it('treats ABSENT pricing as not free', () => {
    // Ollama publishes no prices because it is local, but so does an uncatalogued hosted model -
    // and calling unknown "free" would default somebody onto a model that then bills them.
    expect(isFreeModel({ id: 'c', label: 'C' })).toBe(false)
  })
})

describe('chooseDefaultModel', () => {
  it('prefers a free model when the provider publishes no capability ranking', () => {
    // The OpenRouter shape. Somebody connecting to use its free models should not land on a
    // paid one - with no credit their first request is refused before it generates.
    const choice = chooseDefaultModel([paid('gpt', 'GPT', 10), free('lite', 'Lite')])
    expect(choice?.modelId).toBe('lite')
    expect(choice?.reason).toBe('free')
  })

  it('HONOURS an explicit capability ranking ahead of price', () => {
    // The Anthropic/OpenAI shape, and the regression this ordering exists to prevent: putting
    // free first would silently downgrade a paid key's default, which nobody asked for.
    const choice = chooseDefaultModel([
      { id: 'opus', label: 'Opus', tier: CAPABILITY_TIER, pricing: { inputPerMTok: 15, outputPerMTok: 75 } },
      free('lite', 'Lite'),
    ])
    expect(choice?.modelId).toBe('opus')
    expect(choice?.reason).toBe('most-capable')
  })

  it('still reports the free count even when capability decided it', () => {
    const choice = chooseDefaultModel([
      { id: 'opus', label: 'Opus', tier: CAPABILITY_TIER },
      free('a', 'A'),
      free('b', 'B'),
    ])
    expect(choice?.reason).toBe('most-capable')
    expect(choice?.freeModelCount).toBe(2)
  })

  it('picks the most capable free model by context window', () => {
    // Among free models the context window is the difference between one that can hold a real
    // conversation and one that cannot.
    const choice = chooseDefaultModel([free('small', 'Small', 8_000), free('big', 'Big', 128_000)])
    expect(choice?.modelId).toBe('big')
  })

  it('reports how many free models exist', () => {
    // The fact somebody connecting a spend-conscious account most wants, otherwise buried in a
    // list of hundreds.
    const choice = chooseDefaultModel([free('a', 'A'), free('b', 'B'), paid('c', 'C', 3)])
    expect(choice?.freeModelCount).toBe(2)
  })

  it('falls back to the CHEAPEST when nothing is free', () => {
    const choice = chooseDefaultModel([paid('exp', 'Expensive', 30), paid('mid', 'Mid', 3)])
    expect(choice?.modelId).toBe('mid')
    expect(choice?.reason).toBe('cheapest')
    expect(choice?.freeModelCount).toBe(0)
  })

  it('is DETERMINISTIC - input order cannot change the answer', () => {
    // The whole defect was arbitrariness: two people connecting the same provider landed on
    // different defaults with nothing to explain why.
    const models = [free('a', 'Alpha', 1_000), free('b', 'Beta', 1_000), paid('c', 'Gamma', 1)]
    const forward = chooseDefaultModel(models)?.modelId
    const reversed = chooseDefaultModel([...models].reverse())?.modelId
    expect(forward).toBe(reversed)
    expect(forward).toBe('a')
  })

  it('names a sole option as such rather than calling it cheapest', () => {
    // Calling one option the cheapest implies a comparison that did not happen.
    const choice = chooseDefaultModel([paid('only', 'Only', 7)])
    expect(choice?.reason).toBe('only-option')
  })

  it('returns null for an empty catalogue rather than inventing a model', () => {
    expect(chooseDefaultModel([])).toBeNull()
  })

  it('handles a provider with no prices at all without picking arbitrarily', () => {
    // Ollama. Stable label order beats input order.
    const local = [{ id: 'z', label: 'Zephyr' }, { id: 'l', label: 'Llama' }]
    expect(chooseDefaultModel(local)?.modelId).toBe('l')
    expect(chooseDefaultModel([...local].reverse())?.modelId).toBe('l')
  })
})

describe('freeModels', () => {
  it('returns only free entries, most capable first', () => {
    const list = freeModels([paid('p', 'Paid', 5), free('s', 'S', 4_000), free('b', 'B', 64_000)])
    expect(list.map((model) => model.id)).toEqual(['b', 's'])
  })

  it('is empty when a provider publishes none', () => {
    expect(freeModels([paid('a', 'A', 1)])).toHaveLength(0)
  })
})

describe('describeDefaultChoice', () => {
  it('states the count and that it can be changed', () => {
    const message = describeDefaultChoice({ modelId: 'x', reason: 'free', freeModelCount: 12 })
    expect(message).toContain('12 free models')
    expect(message).toContain('pick another')
  })

  it('uses singular wording for exactly one free model', () => {
    // "1 free models are available" reads as a bug in the product.
    const message = describeDefaultChoice({ modelId: 'x', reason: 'free', freeModelCount: 1 })
    expect(message).toContain('the one model')
    expect(message).not.toContain('1 free models')
  })

  it('says plainly when nothing was free', () => {
    const message = describeDefaultChoice({ modelId: 'x', reason: 'cheapest', freeModelCount: 0 })
    expect(message).toContain('No free models')
  })
})

describe('the audit records WHY, not only which', () => {
  it('carries the reason and the free count', async () => {
    // A default nobody chose cannot be explained months later without this, and the free
    // preference would look like a random pick.
    const text = await Bun.file(new URL('../../../server/ai/handlers/credentials.ts', import.meta.url)).text()
    expect(text).toMatch(/reason: defaultChoice\?\.reason/)
    expect(text).toMatch(/freeModelsAvailable: defaultChoice\?\.freeModelCount/)
  })
})
