/**
 * Task 17: stop requesting a token budget the account cannot afford.
 *
 * Providers reserve the FULL output budget against the balance before generating, so an account
 * with real credit is refused outright when the reservation alone exceeds it. That was reported
 * as "quota or rate limit reached. Check your account balance." - which sends somebody to buy
 * credit they already have, while the actual fix is to ask for less.
 */
import { describe, expect, it } from 'bun:test'
import { affordableOutputTokens, classifyHttpFailure } from '../../../server/ai/drivers/http/errors'

// The provider's real wording, from OpenRouter's 402 body.
const AFFORD_BODY = JSON.stringify({
  error: {
    code: 402,
    message: 'This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 3312.',
  },
})

describe('affordableOutputTokens', () => {
  it('reads the figure the provider states', () => {
    expect(affordableOutputTokens(AFFORD_BODY, '')).toBe(3312)
  })

  it('returns null rather than guessing when the provider does not say', () => {
    // A guess is wrong in both directions: too high and the retry fails identically, too low
    // and the answer is truncated, which reads as the model failing rather than as billing.
    expect(affordableOutputTokens('{"error":{"message":"Insufficient credits"}}', '')).toBeNull()
  })

  it('refuses a nonsensical figure', () => {
    expect(affordableOutputTokens('can only afford 0', '')).toBeNull()
    expect(affordableOutputTokens('can only afford -5', '')).toBeNull()
  })

  it('is case-insensitive and tolerates extra spacing', () => {
    expect(affordableOutputTokens('Can Only Afford   987 tokens', '')).toBe(987)
  })
})

describe('classifyHttpFailure on 402', () => {
  it('classifies an affordability refusal as budgetTooLarge with the figure', () => {
    const failure = classifyHttpFailure('OpenRouter', 402, AFFORD_BODY)
    expect(failure.kind).toBe('budgetTooLarge')
    expect(failure.affordableTokens).toBe(3312)
  })

  it('says the budget is the problem, not the balance', () => {
    // The distinction is the whole point: one is fixed by asking for less, the other by paying.
    const failure = classifyHttpFailure('OpenRouter', 402, AFFORD_BODY)
    expect(failure.message).toContain('output budget')
    expect(failure.message).toContain('3312')
    expect(failure.message).not.toContain('Check your account balance')
  })

  it('still reports a genuinely empty balance as a balance problem', () => {
    // A gate that reclassified every 402 would send somebody with no credit to shrink a budget
    // that was never the issue.
    const failure = classifyHttpFailure('OpenRouter', 402, '{"error":{"message":"Insufficient credits"}}')
    expect(failure.kind).toBe('generic')
    expect(failure.message).toContain('Check your account balance')
  })

  it('a 429 rate limit without an affordable figure stays generic', () => {
    const failure = classifyHttpFailure('OpenRouter', 429, '{"error":{"message":"Rate limit exceeded"}}')
    expect(failure.kind).toBe('generic')
  })

  it('does NOT misclassify the billing refusal as a context overflow', () => {
    // This is a known, documented failure in comparable agents: the 402 billing message is read
    // as "prompt too large", which triggers repeated compaction retries that spend the
    // remaining credit on attempts that cannot succeed. Our 402 branch runs FIRST, and this
    // asserts that ordering rather than trusting it.
    const failure = classifyHttpFailure('OpenRouter', 402, AFFORD_BODY)
    expect(failure.kind).not.toBe('replayOverflow')
  })
})

describe('the classification is actionable rather than terminal', () => {
  it('carries a figure a retry can use', () => {
    const failure = classifyHttpFailure('OpenRouter', 402, AFFORD_BODY)
    // Without this the loop can only report the failure; with it the loop can send the request
    // the account can actually pay for.
    expect(typeof failure.affordableTokens).toBe('number')
  })

  it('never carries a figure on kinds where it would be meaningless', () => {
    expect(classifyHttpFailure('OpenRouter', 500, 'boom').affordableTokens).toBeUndefined()
    expect(classifyHttpFailure('OpenRouter', 401, 'nope').affordableTokens).toBeUndefined()
  })
})

describe('the loop retries once, bounded, and states why', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(import.meta.dir, '../../../server/ai/drivers/http/toolLoop.ts'),
    'utf8',
  ) as string

  it('retries at most once', () => {
    // A retry loop against a shrinking balance spends the remaining credit on failed attempts.
    expect(source).toContain('budgetRetried')
    expect(source).toMatch(/!budgetRetried && failure\.kind === 'budgetTooLarge'/)
  })

  it('refuses to retry below a usable floor', () => {
    // A budget too small produces a reply cut off mid-sentence, which reads as the model
    // breaking rather than as a billing limit - and still costs for what it generated.
    expect(source).toContain('MIN_USEFUL_OUTPUT_TOKENS')
    expect(source).toMatch(/affordableTokens >= MIN_USEFUL_OUTPUT_TOKENS/)
  })

  it('only retries on a figure the provider stated', () => {
    expect(source).toMatch(/failure\.affordableTokens !== undefined/)
  })

  it('passes the lowered budget into the request body', () => {
    expect(source).toMatch(/maxOutputTokens: outputBudget/)
  })
})

describe('the happy path is unchanged', () => {
  const chat = require('node:fs').readFileSync(
    require('node:path').join(import.meta.dir, '../../../server/ai/drivers/http/chatCompletions.ts'),
    'utf8',
  ) as string

  it('sends max_tokens only when a budget was established', () => {
    // Deliberately NOT defaulted to a number of our own: a value above a model's output ceiling
    // is a hard 400 on OpenAI-compatible providers, so a blanket default would break every
    // model whose ceiling is lower than whatever we picked.
    expect(chat).toMatch(/if \(req\.maxOutputTokens !== undefined\) body\.max_tokens/)
  })

  it('states why it is not defaulted', () => {
    expect(chat).toContain('output ceiling')
  })
})
