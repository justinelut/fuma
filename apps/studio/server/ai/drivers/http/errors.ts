/**
 * Shared error classification for the direct provider HTTP drivers.
 *
 * Direct REST gives us the HTTP status code, so we can classify auth/billing
 * failures precisely (401 → bad key, 402/429 → quota) and surface actionable
 * copy in the admin-only chat surface, rather than forwarding a raw stack
 * trace or a generic "something went wrong".
 */

/**
 * True when an error is the result of the request abort signal firing — a
 * cancelled chat or client disconnect. Drivers return cleanly on these
 * (no `error` event) so the UI doesn't flash a spurious failure.
 */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted'))
  )
}

/**
 * Classify a non-OK HTTP response into a user-facing message. `bodyText` is
 * the (already-read) response body; the provider's `{ error: { message } }`
 * envelope is preferred when present, otherwise a status-based fallback.
 */
export function classifyHttpError(
  providerLabel: string,
  status: number,
  bodyText: string,
): string {
  return classifyHttpFailure(providerLabel, status, bodyText).message
}

export interface ProviderHttpFailure {
  kind: 'replayOverflow' | 'budgetTooLarge' | 'generic'
  /**
   * Output tokens the account can currently afford, when the provider states it.
   * Present ONLY for 'budgetTooLarge' - it is the provider's own number, never
   * an estimate of ours, because retrying against a guess either fails again or
   * truncates the answer.
   */
  affordableTokens?: number
  message: string
}

/** Structured classification lets the tool loop retry only replay overflows. */
export function classifyHttpFailure(
  providerLabel: string,
  status: number,
  bodyText: string,
): ProviderHttpFailure {
  const detail = extractErrorMessage(bodyText)

  if (status === 401 || status === 403) {
    return {
      kind: 'generic',
      message: `${providerLabel} authentication failed. Check your API key in /admin/ai/providers.`,
    }
  }
  if (status === 402 || status === 429) {
    // AN AFFORDABILITY REFUSAL IS NOT AN EMPTY BALANCE, and the two need opposite
    // advice. Providers reserve the FULL requested output budget against the
    // balance before generating, so an account with real credit is refused
    // outright when the reservation alone exceeds it - OpenRouter says so
    // literally: "This request requires more credits, or fewer max_tokens. You
    // requested up to 65536 tokens, but can only afford 3312."
    // Telling that user to top up sends them to buy credits they already have,
    // while the actual fix is to ask for less. And because the provider states
    // the affordable figure, the request is RETRYABLE rather than terminal.
    const affordable = affordableOutputTokens(bodyText, detail ?? '')
    if (affordable !== null) {
      return {
        kind: 'budgetTooLarge',
        affordableTokens: affordable,
        message: `${providerLabel} refused the request because the output budget it reserves costs more than this account can currently afford (it can afford about ${affordable} output tokens). Retrying with a smaller budget.`,
      }
    }
    return {
      kind: 'generic',
      message: `${providerLabel} quota or rate limit reached${detail ? `: ${detail}` : ''}. Check your account balance.`,
    }
  }
  if (requestExceedsProviderContext(status, bodyText, detail)) {
    return {
      kind: 'replayOverflow',
      message: `${providerLabel} could not accept this conversation because it exceeds the provider's request or context limit${detail ? `: ${detail}` : ''}. Your history is still saved; start a new conversation or choose a model with a larger context window.`,
    }
  }
  if (status >= 500) {
    return {
      kind: 'generic',
      message: `${providerLabel} service error (${status})${detail ? `: ${detail}` : ''}. Please try again.`,
    }
  }
  return {
    kind: 'generic',
    message: `${providerLabel} error (${status})${detail ? `: ${detail}` : ''}.`,
  }
}

function requestExceedsProviderContext(
  status: number,
  bodyText: string,
  detail: string | null,
): boolean {
  if (status === 413) return true
  if (status !== 400) return false
  const providerSignal = `${detail ?? ''} ${bodyText}`
  return /(?:context.{0,24}(?:length|limit|window|exceed)|maximum.{0,16}tokens|too[_ ]many[_ ]tokens|request[_ ].{0,16}(?:too[_ ]large|exceed)|input[_ ]too[_ ]long|too[_ ]many[_ ]images|image.{0,16}(?:count|limit|maximum))/i.test(providerSignal)
}

/**
 * Pull a short message out of a provider error body. Providers return
 * `{ error: { message } }` (Anthropic/OpenAI) or `{ error: "..." }`; anything
 * unparseable collapses to the raw text (capped) so we never lose the detail
 * entirely.
 */
function extractErrorMessage(bodyText: string): string | null {
  const trimmed = bodyText.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const err = (parsed as { error: unknown }).error
      if (typeof err === 'string') return err
      if (err && typeof err === 'object' && 'message' in err) {
        const msg = (err as { message: unknown }).message
        if (typeof msg === 'string') return msg
      }
    }
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return trimmed.slice(0, 200)
}

/**
 * The output-token budget the account can afford, read from the provider's own message.
 *
 * Deliberately returns null rather than a guess when the provider does not say. A guessed
 * budget produces one of two bad outcomes: too high and the retry fails identically, too low
 * and the answer is truncated, which reads as the model failing rather than as a billing limit.
 */
export function affordableOutputTokens(bodyText: string, detail: string): number | null {
  const haystack = `${detail} ${bodyText}`
  // "can only afford 3312" is the phrasing; the number is what makes a retry possible.
  const match = /can only afford\s+(\d+)/i.exec(haystack)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isSafeInteger(value) || value <= 0) return null
  return value
}
