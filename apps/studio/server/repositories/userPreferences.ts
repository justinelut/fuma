/**
 * User preferences repository — CRUD over the `user_preferences` table.
 *
 * One row per (user_id, key). PostgreSQL stores `value_json` as `jsonb`, and
 * the database client accepts and returns plain JavaScript values.
 *
 * Schema validation lives at the HTTP boundary, not in this repository.
 * The handler validates incoming payloads against the per-key TypeBox
 * schemas in `src/core/persistence/userPreferences.ts` before this
 * repository ever sees them, and re-validates on read. We pass `unknown`
 * around inside the repo so the type system doesn't lie about contents.
 */
import type { DbClient } from '../db/client'

interface UserPreferenceRow {
  value_json: unknown
}

/**
 * Read a single preference. Returns `null` when the row doesn't exist
 * (user hasn't ever set this preference). Callers fall back to a
 * sensible default — first read of a key for a fresh user is the
 * common case and not an error.
 *
 * NB: the client-side helper in `@core/persistence/userPreferences`
 * uses the unprefixed name (`getUserPreference`) for the HTTP round-trip.
 * This is the server-side SQL counterpart — the `…Row` suffix mirrors
 * other repository conventions (e.g. `readMediaAssetRow`).
 */
export async function getUserPreferenceRow(
  db: DbClient,
  userId: string,
  key: string,
): Promise<unknown | null> {
  const { rows } = await db<UserPreferenceRow>`
    select value_json
    from user_preferences
    where user_id = ${userId}
      and key = ${key}
  `
  if (rows.length === 0) return null
  // PostgreSQL returns `jsonb` as a hydrated JavaScript value, not a string.
  return rows[0]!.value_json
}

/**
 * Upsert a preference. PostgreSQL serializes `value` into the `jsonb` column.
 *
 * Updates `updated_at` to the current timestamp on every write — even a
 * no-op overwrite — so admins can see "last touched" if we ever surface
 * a preferences-debug page.
 */
export async function upsertUserPreferenceRow(
  db: DbClient,
  userId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await db`
    insert into user_preferences (user_id, key, value_json, updated_at)
    values (${userId}, ${key}, ${value}, current_timestamp)
    on conflict (user_id, key) do update
      set value_json = excluded.value_json,
          updated_at = current_timestamp
  `
}

/**
 * Delete a preference, resetting it to its default on the next read.
 * Returns true when a row was actually deleted, false when nothing was
 * stored (callers can treat both as "now using default" without
 * distinguishing — the wire-level handler returns 204 either way).
 */
export async function deleteUserPreferenceRow(
  db: DbClient,
  userId: string,
  key: string,
): Promise<boolean> {
  const result = await db`
    delete from user_preferences
    where user_id = ${userId}
      and key = ${key}
  `
  return result.rowCount > 0
}
