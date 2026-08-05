import { apiRequest, type FetchLike } from '@core/http'
import { Type, type Static } from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1, maxLength: 255 })
const Timestamp = Type.String({ format: 'date-time' })
const Micros = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const CredentialSchema = Type.Object({
  credentialId: Id,
  providerId: Id,
  displayLabel: Type.String({ minLength: 1, maxLength: 120 }),
  state: Type.Union([Type.Literal('active'), Type.Literal('rekey-required'), Type.Literal('detached')]),
  version: Type.Integer({ minimum: 1 }),
  keyCurrent: Type.Boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, Strict)
const AccountSchema = Type.Object({
  accountId: Id,
  balanceMicros: Micros,
  reservedMicros: Micros,
  spentMicros: Micros,
  budgetMicros: Micros,
  availableMicros: Micros,
  version: Type.Integer({ minimum: 1 }),
  credentials: Type.Array(CredentialSchema, { maxItems: 100 }),
}, Strict)
const EntrySchema = Type.Object({
  entryId: Id,
  entryType: Type.Union([Type.Literal('grant'), Type.Literal('purchase'), Type.Literal('usage')]),
  state: Type.Union([
    Type.Literal('available'), Type.Literal('partially-used'), Type.Literal('used'),
    Type.Literal('expired'), Type.Literal('reserved'), Type.Literal('settled'),
    Type.Literal('released'), Type.Literal('refunded'),
  ]),
  amountMicros: Micros,
  remainingMicros: Micros,
  mode: Type.Union([Type.Literal('platform'), Type.Literal('byok'), Type.Null()]),
  providerId: Type.Union([Id, Type.Null()]),
  modelId: Type.Union([Id, Type.Null()]),
  inputTokens: Type.Union([Micros, Type.Null()]),
  outputTokens: Type.Union([Micros, Type.Null()]),
  occurredAt: Timestamp,
  resolvedAt: Type.Union([Timestamp, Type.Null()]),
  expiresAt: Type.Union([Timestamp, Type.Null()]),
}, Strict)
export const AiCreditsLedgerWireSchema = Type.Object({
  account: AccountSchema,
  entries: Type.Array(EntrySchema, { maxItems: 10_000 }),
}, Strict)
export type AiCreditsLedgerWire = Readonly<Static<typeof AiCreditsLedgerWireSchema>>
export type AiCreditsLedgerEntryWire = AiCreditsLedgerWire['entries'][number]

export class AiCreditsHttpClient {
  readonly #base: string
  readonly #fetch: FetchLike

  constructor(input: Readonly<{ organizationId: string; workspaceId: string; siteId: string; fetch?: FetchLike }>) {
    this.#base = [
      '/api/fuma/organizations', encodeURIComponent(input.organizationId),
      'workspaces', encodeURIComponent(input.workspaceId),
      'sites', encodeURIComponent(input.siteId), 'ai/credits',
    ].join('/')
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis)
  }

  ledger(): Promise<AiCreditsLedgerWire> {
    return apiRequest(this.#base, {
      schema: AiCreditsLedgerWireSchema,
      credentials: 'same-origin',
      fallbackMessage: 'AI credit ledger could not be loaded.',
      fetchImpl: this.#fetch,
    })
  }
}
