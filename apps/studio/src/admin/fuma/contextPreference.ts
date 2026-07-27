import {
  BrowserContextPreferenceSchema,
  type BrowserContextPreference,
  type StableContextSelection,
} from '@core/fuma'
import { safeParseJson } from '@core/utils/jsonValidate'
import { Value } from '@core/utils/typeboxHelpers'

export const FUMA_CONTEXT_PREFERENCE_KEY = 'fuma-scoped-context-v1'

export interface ContextPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStorage(): ContextPreferenceStorage | undefined {
  return typeof globalThis.localStorage === 'undefined'
    ? undefined
    : globalThis.localStorage
}

/** Reads only the current, schema-valid preference format. */
export function readContextPreference(
  storage: ContextPreferenceStorage | undefined = browserStorage(),
): BrowserContextPreference | null {
  if (!storage) return null

  try {
    const raw = storage.getItem(FUMA_CONTEXT_PREFERENCE_KEY)
    if (!raw) return null
    const parsed = safeParseJson(raw, BrowserContextPreferenceSchema)
    return parsed.ok ? parsed.value : null
  } catch (_error) {
    // Browser storage may be unavailable in restricted or private sessions.
    return null
  }
}

/** Persists a complete selection without treating browser state as authority. */
export function writeContextPreference(
  selection: StableContextSelection,
  storage: ContextPreferenceStorage | undefined = browserStorage(),
): void {
  if (!storage) return

  const preference: BrowserContextPreference = { version: 1, selection }
  if (!Value.Check(BrowserContextPreferenceSchema, preference)) return

  try {
    storage.setItem(FUMA_CONTEXT_PREFERENCE_KEY, JSON.stringify(preference))
  } catch (_error) {
    // Context persistence is best-effort; the explicit URL remains authoritative.
  }
}
