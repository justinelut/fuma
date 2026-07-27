import { RedisClient, type RedisOptions } from 'bun'

export interface FumaJobReadyQueue {
  connect(): Promise<void>
  close(): Promise<void>
  enqueue(jobIds: readonly string[]): Promise<number>
  take(): Promise<string | null>
  remove(jobId: string): Promise<boolean>
  rebuild(jobIds: readonly string[]): Promise<void>
}

const ENQUEUE_SCRIPT = `
local added = 0
for index = 1, #ARGV do
  if redis.call('SADD', KEYS[2], ARGV[index]) == 1 then
    redis.call('RPUSH', KEYS[1], ARGV[index])
    added = added + 1
  end
end
return added
`

const TAKE_SCRIPT = `
local value = redis.call('LPOP', KEYS[1])
if value then redis.call('SREM', KEYS[2], value) end
return value
`

const REMOVE_SCRIPT = `
redis.call('SREM', KEYS[2], ARGV[1])
return redis.call('LREM', KEYS[1], 0, ARGV[1])
`

const REBUILD_SCRIPT = `
redis.call('DEL', KEYS[1], KEYS[2])
for index = 1, #ARGV do
  if redis.call('SADD', KEYS[2], ARGV[index]) == 1 then redis.call('RPUSH', KEYS[1], ARGV[index]) end
end
return #ARGV
`

function queueKeys(namespace: string): readonly [string, string] {
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(namespace)) throw new RangeError('Invalid durable-job Redis namespace.')
  const prefix = `fuma:v1:${namespace}:jobs:ready`
  return [`${prefix}:list`, `${prefix}:members`]
}

function assertJobIds(jobIds: readonly string[]): void {
  if (jobIds.length > 10_000) throw new RangeError('A durable-job ready batch cannot exceed 10000 IDs.')
  for (const jobId of jobIds) {
    if (!jobId || new TextEncoder().encode(jobId).byteLength > 512) throw new RangeError('Invalid durable-job ID.')
  }
}

/** Redis is only a rebuildable delivery accelerator; every returned ID must still be claimed in PostgreSQL. */
export class RedisFumaJobReadyQueue implements FumaJobReadyQueue {
  readonly #keys: readonly [string, string]
  #client: RedisClient

  constructor(url: string, namespace: string, options: RedisOptions = {}) {
    this.#keys = queueKeys(namespace)
    this.#client = new RedisClient(url, {
      autoReconnect: true,
      enableOfflineQueue: false,
      connectionTimeout: 500,
      maxRetries: 5,
      ...options,
    })
  }

  connect(): Promise<void> {
    return this.#client.connect()
  }

  async close(): Promise<void> {
    this.#client.close()
  }

  async enqueue(jobIds: readonly string[]): Promise<number> {
    assertJobIds(jobIds)
    if (jobIds.length === 0) return 0
    const result: unknown = await this.#client.send('EVAL', [
      ENQUEUE_SCRIPT, '2', ...this.#keys, ...jobIds,
    ])
    if (typeof result !== 'number') throw new Error('Redis returned an invalid durable-job enqueue result.')
    return result
  }

  async take(): Promise<string | null> {
    const result: unknown = await this.#client.send('EVAL', [TAKE_SCRIPT, '2', ...this.#keys])
    if (result === null || typeof result === 'string') return result
    throw new Error('Redis returned an invalid durable-job dequeue result.')
  }

  async remove(jobId: string): Promise<boolean> {
    assertJobIds([jobId])
    const result: unknown = await this.#client.send('EVAL', [REMOVE_SCRIPT, '2', ...this.#keys, jobId])
    if (typeof result !== 'number') throw new Error('Redis returned an invalid durable-job remove result.')
    return result > 0
  }

  async rebuild(jobIds: readonly string[]): Promise<void> {
    assertJobIds(jobIds)
    const result: unknown = await this.#client.send('EVAL', [
      REBUILD_SCRIPT, '2', ...this.#keys, ...jobIds,
    ])
    if (typeof result !== 'number') throw new Error('Redis returned an invalid durable-job rebuild result.')
  }
}
