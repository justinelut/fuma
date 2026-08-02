import { FUMA_DEFAULT_DEPLOYMENT_PROFILE } from '@fuma/brand'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import type { ReleaseManifest } from '../releases'

export const FREE_HOST_SUFFIX = FUMA_DEFAULT_DEPLOYMENT_PROFILE.tenantSuffix
export const RESERVED_FREE_HOST_LABELS = Object.freeze(new Set([
  'auth', 'app', 'admin', 'www', 'api', 'status', 'support', 'mail',
  'assets', 'billing', 'cdn', 'checkout', 'console', 'dashboard', 'docs',
  'edge', 'help', 'hooks', 'mcp', 'media', 'objects', 'preview', 'scheduler',
  'static', 'uploads', 'webhook', 'webhooks', 'worker',
]))

const IdSchema = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
})
const LabelSchema = Type.String({
  minLength: 3,
  maxLength: 63,
  pattern: '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$',
})
const HostSchema = Type.String({
  minLength: 1,
  maxLength: 253,
  pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$',
})
const TimestampSchema = Type.String({
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$',
})

export const FreeHostRecordSchema = Type.Object({
  host: HostSchema,
  label: LabelSchema,
  platformId: IdSchema,
  organizationId: IdSchema,
  workspaceId: IdSchema,
  siteId: IdSchema,
  ownerKey: IdSchema,
  ownerGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  state: Type.Union([Type.Literal('active'), Type.Literal('suspended')]),
  canonicalHost: Type.Union([HostSchema, Type.Null()]),
  version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  createdAt: TimestampSchema,
}, { additionalProperties: false })
export type FreeHostRecord = Static<typeof FreeHostRecordSchema>

export type FreeHostErrorCode =
  | 'malformed'
  | 'reserved'
  | 'collision'
  | 'unknown'
  | 'suspended'
  | 'stale-authority'

export class FreeHostError extends Error {
  readonly code: FreeHostErrorCode

  constructor(code: FreeHostErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'FreeHostError'
  }
}

/** Normalize an ASCII DNS Host authority; ports and exactly one terminal dot are discarded. */
export function normalizePublicHost(input: string): string {
  if (!input || input !== input.trim() || /[^\x21-\x7e]|[\s/@\\,#[\]]/.test(input)) {
    throw new FreeHostError('malformed', 'Host is malformed.')
  }
  let authority = input
  let terminalDots = 0
  if (authority.endsWith('.')) {
    terminalDots += 1
    authority = authority.slice(0, -1)
  }
  const match = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(authority)
  if (!match) throw new FreeHostError('malformed', 'Host is malformed.')
  const port = match[2]
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535)) {
    throw new FreeHostError('malformed', 'Host is malformed.')
  }
  let hostname = match[1]!
  if (hostname.endsWith('.')) {
    terminalDots += 1
    hostname = hostname.slice(0, -1)
  }
  if (terminalDots > 1) throw new FreeHostError('malformed', 'Host is malformed.')
  hostname = hostname.toLowerCase()
  if (!Value.Check(HostSchema, hostname)
    || hostname.split('.').some((label) => label.startsWith('xn--'))) {
    throw new FreeHostError('malformed', 'Host is malformed.')
  }
  return hostname
}

export function normalizeFreeHostLabel(input: string): string {
  if (!input || input !== input.trim() || /[^\x21-\x7e]/.test(input)) {
    throw new FreeHostError('malformed', 'Free-host label is invalid.')
  }
  const label = input.toLowerCase()
  if (!Value.Check(LabelSchema, label)) throw new FreeHostError('malformed', 'Free-host label is invalid.')
  if (RESERVED_FREE_HOST_LABELS.has(label) || label.startsWith('xn--') || /^fuma(?:-|$)/.test(label)) {
    throw new FreeHostError('reserved', 'Free-host label is permanently reserved.')
  }
  return label
}

export type FreeHostAuthority = Readonly<Pick<FreeHostRecord,
  'platformId' | 'organizationId' | 'workspaceId' | 'siteId' | 'ownerKey' | 'ownerGeneration'
>>

export interface FreeHostRepository {
  insert(record: FreeHostRecord): Promise<boolean>
  exact(host: string): Promise<FreeHostRecord | null>
  setState(input: Readonly<{
    host: string
    state: FreeHostRecord['state']
    authority: FreeHostAuthority
    expectedVersion: number
  }>): Promise<FreeHostRecord | null>
}

export type ActiveFreeHostRelease = Readonly<{
  releaseId: string
  manifest?: ReleaseManifest
}>

export interface ActiveReleaseResolver {
  exactSite(scope: Readonly<{
    host: string
    platformId: string
    organizationId: string
    workspaceId: string
    siteId: string
    ownerKey: string
    ownerGeneration: number
  }>): Promise<ActiveFreeHostRelease | null>
}

export type FreeHostResolution = Readonly<
  | { kind: 'release'; host: FreeHostRecord; releaseId: string; manifest?: ReleaseManifest }
  | { kind: 'redirect'; host: FreeHostRecord; locationHost: string }
>

export class FreeHostService {
  readonly #repository: FreeHostRepository
  readonly #releases: ActiveReleaseResolver
  readonly #now: () => Date
  readonly #suffix: string

  constructor(
    repository: FreeHostRepository,
    releases: ActiveReleaseResolver,
    now: () => Date = () => new Date(),
    suffix: string = FREE_HOST_SUFFIX,
  ) {
    if (!suffix.startsWith('.') || !Value.Check(HostSchema, suffix.slice(1))) {
      throw new TypeError('Free-host suffix is invalid.')
    }
    this.#repository = repository
    this.#releases = releases
    this.#now = now
    this.#suffix = suffix
  }

  async allocate(input: Readonly<FreeHostAuthority & {
    label: string
    canonicalHost?: string | null
  }>): Promise<FreeHostRecord> {
    const label = normalizeFreeHostLabel(input.label)
    const host = `${label}${this.#suffix}`
    const canonicalHost = input.canonicalHost ? normalizePublicHost(input.canonicalHost) : null
    if (canonicalHost?.endsWith(this.#suffix)) {
      throw new FreeHostError('reserved', 'A free host cannot redirect through another free-host allocation.')
    }
    const record = Object.freeze({
      ...input,
      label,
      host,
      state: 'active' as const,
      canonicalHost,
      version: 1,
      createdAt: this.#now().toISOString(),
    })
    if (!Value.Check(FreeHostRecordSchema, record)) {
      throw new FreeHostError('malformed', 'Free-host allocation failed validation.')
    }
    if (!await this.#repository.insert(record)) {
      throw new FreeHostError('collision', 'Free host or site already has an allocation.')
    }
    return record
  }

  async setState(input: Readonly<{
    host: string
    state: FreeHostRecord['state']
    authority: FreeHostAuthority
    expectedVersion: number
  }>): Promise<FreeHostRecord> {
    const host = normalizePublicHost(input.host)
    const updated = await this.#repository.setState({ ...input, host })
    if (!updated) throw new FreeHostError('stale-authority', 'Free-host state authority is stale.')
    return updated
  }

  async resolve(rawHost: string): Promise<FreeHostResolution> {
    const host = normalizePublicHost(rawHost)
    if (!host.endsWith(this.#suffix)) {
      throw new FreeHostError('unknown', 'No default host is configured.')
    }
    const label = host.slice(0, -this.#suffix.length)
    if (label.includes('.')) throw new FreeHostError('unknown', 'No default host is configured.')
    normalizeFreeHostLabel(label)
    const record = await this.#repository.exact(host)
    if (!record) throw new FreeHostError('unknown', 'Unknown host.')
    if (record.state !== 'active') throw new FreeHostError('suspended', 'Host is suspended.')
    if (record.canonicalHost !== null) {
      return { kind: 'redirect', host: record, locationHost: record.canonicalHost }
    }
    const release = await this.#releases.exactSite({
      host: record.host,
      platformId: record.platformId,
      organizationId: record.organizationId,
      workspaceId: record.workspaceId,
      siteId: record.siteId,
      ownerKey: record.ownerKey,
      ownerGeneration: record.ownerGeneration,
    })
    if (!release) throw new FreeHostError('unknown', 'Host has no active release.')
    return { kind: 'release', host: record, ...release }
  }
}

export class MemoryFreeHostRepository implements FreeHostRepository {
  readonly records = new Map<string, FreeHostRecord>()
  readonly #hostBySite = new Map<string, string>()

  async insert(record: FreeHostRecord): Promise<boolean> {
    if (!Value.Check(FreeHostRecordSchema, record)) return false
    const siteKey = `${record.platformId}:${record.organizationId}:${record.workspaceId}:${record.siteId}`
    if (this.records.has(record.host) || this.#hostBySite.has(siteKey)) return false
    this.records.set(record.host, structuredClone(record))
    this.#hostBySite.set(siteKey, record.host)
    return true
  }

  async exact(host: string): Promise<FreeHostRecord | null> {
    const record = this.records.get(host)
    if (!record || !Value.Check(FreeHostRecordSchema, record)) return null
    return Object.freeze(structuredClone(record))
  }

  async setState(input: Readonly<{
    host: string
    state: FreeHostRecord['state']
    authority: FreeHostAuthority
    expectedVersion: number
  }>): Promise<FreeHostRecord | null> {
    const record = this.records.get(input.host)
    if (!record || record.version !== input.expectedVersion || !sameAuthority(record, input.authority)) return null
    const updated = Object.freeze({ ...record, state: input.state, version: record.version + 1 })
    this.records.set(record.host, updated)
    return structuredClone(updated)
  }
}

function sameAuthority(record: FreeHostAuthority, authority: FreeHostAuthority): boolean {
  return record.platformId === authority.platformId
    && record.organizationId === authority.organizationId
    && record.workspaceId === authority.workspaceId
    && record.siteId === authority.siteId
    && record.ownerKey === authority.ownerKey
    && record.ownerGeneration === authority.ownerGeneration
}
