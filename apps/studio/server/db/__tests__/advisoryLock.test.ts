import { describe, expect, it } from 'bun:test'
import type { DbClient } from '../client'
import { releaseLeader, tryAcquireLeader, withSchedulerLeaderLock } from '../advisoryLock'

const LOCK_KEY = 123456
const PREFIX = '[test-scheduler]'

function makeFakeDb(opts: { got?: boolean; throwOnLock?: boolean }): DbClient & { calls: string[] } {
  const calls: string[] = []
  const db = (async (strings: TemplateStringsArray) => {
    const sql = strings.join('?')
    calls.push(sql)
    if (sql.includes('pg_try_advisory_lock')) {
      if (opts.throwOnLock) throw new Error('PostgreSQL advisory lock unavailable')
      return { rows: [{ got: opts.got }], rowCount: 1 }
    }
    if (sql.includes('pg_advisory_unlock')) {
      return { rows: [{ unlocked: true }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }) as unknown as DbClient & { calls: string[] }
  db.calls = calls
  return db
}

describe('tryAcquireLeader', () => {
  it('returns the PostgreSQL token when the advisory lock is acquired', async () => {
    expect(await tryAcquireLeader(makeFakeDb({ got: true }), LOCK_KEY)).toBe('pg-advisory')
  })

  it('returns null when another instance holds the lock', async () => {
    expect(await tryAcquireLeader(makeFakeDb({ got: false }), LOCK_KEY)).toBeNull()
  })

  it('propagates advisory-lock failures instead of assuming single-process leadership', async () => {
    await expect(tryAcquireLeader(makeFakeDb({ throwOnLock: true }), LOCK_KEY))
      .rejects.toThrow('PostgreSQL advisory lock unavailable')
  })
})

describe('releaseLeader', () => {
  it('issues pg_advisory_unlock for a PostgreSQL token', async () => {
    const db = makeFakeDb({ got: true })
    await releaseLeader(db, 'pg-advisory', LOCK_KEY, PREFIX)
    expect(db.calls.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true)
  })

  it('is a no-op for a null non-leader token', async () => {
    const db = makeFakeDb({ got: false })
    await releaseLeader(db, null, LOCK_KEY, PREFIX)
    expect(db.calls).toHaveLength(0)
  })
})

describe('withSchedulerLeaderLock', () => {
  it('runs the body and releases when it wins leadership', async () => {
    const db = makeFakeDb({ got: true })
    const result = await withSchedulerLeaderLock(db, LOCK_KEY, PREFIX, async () => 'done')
    expect(result).toBe('done')
    expect(db.calls.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true)
  })

  it('skips the body when another instance is leader', async () => {
    const db = makeFakeDb({ got: false })
    let ran = false
    const result = await withSchedulerLeaderLock(db, LOCK_KEY, PREFIX, async () => {
      ran = true
      return 'done'
    })
    expect(ran).toBe(false)
    expect(result).toBeUndefined()
  })

  it('releases the lock even when the body throws', async () => {
    const db = makeFakeDb({ got: true })
    await expect(withSchedulerLeaderLock(db, LOCK_KEY, PREFIX, async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(db.calls.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true)
  })
})
