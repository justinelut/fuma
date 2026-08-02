import type { DbClient } from './client'

type LeaderToken = 'pg-advisory' | null
const PG_TOKEN = 'pg-advisory' as const

/** Try to own one scheduler tick using the shared PostgreSQL advisory lock. */
export async function tryAcquireLeader(db: DbClient, lockKey: number): Promise<LeaderToken> {
  const { rows } = await db<{ got: boolean }>`
    select pg_try_advisory_lock(${lockKey}) as got
  `
  return rows[0]?.got ? PG_TOKEN : null
}

export async function releaseLeader(
  db: DbClient,
  token: LeaderToken,
  lockKey: number,
  logPrefix: string,
): Promise<void> {
  if (token !== PG_TOKEN) return
  try {
    await db`select pg_advisory_unlock(${lockKey})`
  } catch (error) {
    console.error(`${logPrefix} failed to release advisory lock:`, error)
  }
}

export async function withSchedulerLeaderLock<T>(
  db: DbClient,
  lockKey: number,
  logPrefix: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const token = await tryAcquireLeader(db, lockKey)
  if (!token) return undefined
  try {
    return await fn()
  } finally {
    await releaseLeader(db, token, lockKey, logPrefix)
  }
}
