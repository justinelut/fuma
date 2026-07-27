import { hashSessionToken } from '../tokens'
import type {
  DBAdapter,
  DBTransactionAdapter,
  Where,
} from 'better-auth/adapters'
import type { BetterAuthOptions } from 'better-auth'

const SESSION_MODEL = 'session'
const SESSION_TOKEN_FIELD = 'token'
const SHA256_HEX = /^[a-f0-9]{64}$/

type AdapterFactory = (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>
type AdapterOperations = Pick<
  DBAdapter<BetterAuthOptions>,
  | 'count'
  | 'create'
  | 'delete'
  | 'deleteMany'
  | 'findMany'
  | 'findOne'
  | 'incrementOne'
  | 'update'
  | 'updateMany'
  | 'consumeOne'
>

type CreateInput<T extends Record<string, unknown>> = {
  model: string
  data: Omit<T, 'id'>
  select?: string[]
  forceAllowId?: boolean
}

export function isStoredSessionToken(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value)
}

export async function sessionTokenAtRestValue(token: string): Promise<string> {
  return isStoredSessionToken(token) ? token : await hashSessionToken(token)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function storedWhereValue(value: Where['value']): Promise<Where['value']> {
  if (typeof value === 'string') return await sessionTokenAtRestValue(value)
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return await Promise.all(value.map(async (entry) => await sessionTokenAtRestValue(entry)))
  }
  return value
}

async function storedWhere(model: string, where: Where[] | undefined): Promise<Where[] | undefined> {
  if (model !== SESSION_MODEL || where === undefined) return where
  return await Promise.all(where.map(async (entry) => entry.field === SESSION_TOKEN_FIELD
    ? { ...entry, value: await storedWhereValue(entry.value) }
    : entry))
}

function rawTokenFromWhere(model: string, where: Where[] | undefined): string | undefined {
  if (model !== SESSION_MODEL) return undefined
  const token = where?.find((entry) => (
    entry.field === SESSION_TOKEN_FIELD
      && typeof entry.value === 'string'
      && !isStoredSessionToken(entry.value)
  ))?.value
  return typeof token === 'string' ? token : undefined
}

function rawTokenFromData(model: string, data: unknown): string | undefined {
  if (model !== SESSION_MODEL || !isRecord(data)) return undefined
  const token = data[SESSION_TOKEN_FIELD]
  return typeof token === 'string' && !isStoredSessionToken(token) ? token : undefined
}

async function storedData(model: string, data: unknown): Promise<unknown> {
  const rawToken = rawTokenFromData(model, data)
  if (!rawToken || !isRecord(data)) return data
  return { ...data, token: await sessionTokenAtRestValue(rawToken) }
}

function restoreRawToken<T>(model: string, value: T, rawToken: string | undefined): T {
  if (model !== SESSION_MODEL || rawToken === undefined || !isRecord(value)) return value
  return { ...value, token: rawToken } as T
}

function restoreManyRawTokens<T>(model: string, values: T[], rawToken: string | undefined): T[] {
  return values.map((value) => restoreRawToken(model, value, rawToken))
}

function wrapOperations(adapter: AdapterOperations): AdapterOperations {
  const create: AdapterOperations['create'] = async <T extends Record<string, unknown>, R = T>(
    input: CreateInput<T>,
  ): Promise<R> => {
    const rawToken = rawTokenFromData(input.model, input.data)
    const data = await storedData(input.model, input.data) as typeof input.data
    const created = await adapter.create<T, R>({ ...input, data })
    return restoreRawToken(input.model, created, rawToken)
  }

  const findOne: AdapterOperations['findOne'] = async <T>(
    input: Parameters<AdapterOperations['findOne']>[0],
  ): Promise<T | null> => {
    const rawToken = rawTokenFromWhere(input.model, input.where)
    const found = await adapter.findOne<T>({
      ...input,
      where: (await storedWhere(input.model, input.where)) ?? [],
    })
    return restoreRawToken(input.model, found, rawToken)
  }

  const findMany: AdapterOperations['findMany'] = async <T>(
    input: Parameters<AdapterOperations['findMany']>[0],
  ): Promise<T[]> => {
    const rawToken = rawTokenFromWhere(input.model, input.where)
    const found = await adapter.findMany<T>({
      ...input,
      where: await storedWhere(input.model, input.where),
    })
    return restoreManyRawTokens(input.model, found, rawToken)
  }

  const update: AdapterOperations['update'] = async <T>(
    input: Parameters<AdapterOperations['update']>[0],
  ): Promise<T | null> => {
    const rawToken = rawTokenFromData(input.model, input.update)
      ?? rawTokenFromWhere(input.model, input.where)
    const updated = await adapter.update<T>({
      ...input,
      where: (await storedWhere(input.model, input.where)) ?? [],
      update: await storedData(input.model, input.update) as Record<string, unknown>,
    })
    return restoreRawToken(input.model, updated, rawToken)
  }

  const updateMany: AdapterOperations['updateMany'] = async (input) => await adapter.updateMany({
    ...input,
    where: (await storedWhere(input.model, input.where)) ?? [],
    update: await storedData(input.model, input.update) as Record<string, unknown>,
  })

  const remove: AdapterOperations['delete'] = async (input) => await adapter.delete({
    ...input,
    where: (await storedWhere(input.model, input.where)) ?? [],
  })

  const deleteMany: AdapterOperations['deleteMany'] = async (input) => await adapter.deleteMany({
    ...input,
    where: (await storedWhere(input.model, input.where)) ?? [],
  })

  const count: AdapterOperations['count'] = async (input) => await adapter.count({
    ...input,
    where: await storedWhere(input.model, input.where),
  })

  const consumeOne: AdapterOperations['consumeOne'] = async <T>(
    input: Parameters<AdapterOperations['consumeOne']>[0],
  ): Promise<T | null> => {
    const rawToken = rawTokenFromWhere(input.model, input.where)
    const consumed = await adapter.consumeOne<T>({
      ...input,
      where: (await storedWhere(input.model, input.where)) ?? [],
    })
    return restoreRawToken(input.model, consumed, rawToken)
  }

  const incrementOne: AdapterOperations['incrementOne'] = async <T>(
    input: Parameters<AdapterOperations['incrementOne']>[0],
  ): Promise<T | null> => {
    const rawToken = rawTokenFromWhere(input.model, input.where)
    const incremented = await adapter.incrementOne<T>({
      ...input,
      where: (await storedWhere(input.model, input.where)) ?? [],
      set: input.set === undefined
        ? undefined
        : await storedData(input.model, input.set) as Record<string, unknown>,
    })
    return restoreRawToken(input.model, incremented, rawToken)
  }

  return {
    count,
    create,
    delete: remove,
    deleteMany,
    findMany,
    findOne,
    incrementOne,
    update,
    updateMany,
    consumeOne,
  }
}

function wrapTransactionAdapter(
  adapter: DBTransactionAdapter<BetterAuthOptions>,
): DBTransactionAdapter<BetterAuthOptions> {
  return { ...adapter, ...wrapOperations(adapter) }
}

function wrapAdapter(adapter: DBAdapter<BetterAuthOptions>): DBAdapter<BetterAuthOptions> {
  return {
    ...adapter,
    ...wrapOperations(adapter),
    transaction: async (callback) => await adapter.transaction(async (transaction) => (
      await callback(wrapTransactionAdapter(transaction))
    )),
  }
}

/**
 * Better Auth 1.6.25 persists bearer session tokens verbatim. This isolated
 * adapter hashes every session-token write and predicate while restoring the
 * raw token only to the request that already presented or created it.
 * Hashes returned by list APIs remain non-replayable revocation handles.
 */
export function withHashedSessionTokens(factory: AdapterFactory): AdapterFactory {
  return (options) => wrapAdapter(factory(options))
}
