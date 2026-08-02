import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Timestamp = Type.String({ format: 'date-time' })
const Coordinate = Type.Object({ platformId: Id, organizationId: Id, workspaceId: Id, siteId: Id }, { additionalProperties: false })
const SelectionsSchema = Type.Object({
  domain: Type.Union([Type.Literal('move-with-site'), Type.Literal('retain-with-source'), Type.Literal('detach')]),
  ai: Type.Union([Type.Literal('rekey'), Type.Literal('detach')]),
  mcp: Type.Union([Type.Literal('rescope'), Type.Literal('revoke')]),
  plugins: Type.Union([Type.Literal('rekey'), Type.Literal('remove')]),
  payments: Type.Union([Type.Literal('rekey'), Type.Literal('detach')]),
  collaborators: Type.Union([Type.Literal('preserve'), Type.Literal('remove')]),
}, { additionalProperties: false })
const State = Type.Union([
  Type.Literal('proposed'), Type.Literal('awaiting-confirmations'), Type.Literal('ready'),
  Type.Literal('running'), Type.Literal('resume-requested'), Type.Literal('completed'),
  Type.Literal('compensating'), Type.Literal('failed'), Type.Literal('cancelled'),
])
const Review = Type.Object({
  commandId: Id, transferId: Id, contractId: Id, offerId: Id,
  offerVersion: Type.Integer({ minimum: 1 }), source: Coordinate, destination: Coordinate,
  outboxState: Type.Union([Type.Literal('pending'), Type.Literal('failed'), Type.Literal('delivered')]),
  paymentState: Type.Literal('paid-transfer-pending'), destinationActive: Type.Boolean(), quotaAccepted: Type.Boolean(),
  policyAcceptanceCurrent: Type.Boolean(), meteringEvidenceCurrent: Type.Boolean(), internalGrantExcluded: Type.Literal(true),
  assetOwners: Type.Object({ domain: Type.Literal('FUMA-062'), ai: Type.Literal('FUMA-064'), mcp: Type.Literal('FUMA-066'), plugins: Type.Literal('FUMA-067'), payments: Type.Literal('FUMA-069'), collaborators: Type.Literal('FUMA-023') }, { additionalProperties: false }),
  setupAmountMinor: Type.Integer({ minimum: 0 }), recurringAmountMinor: Type.Integer({ minimum: 0 }), currency: Type.Literal('KES'),
  cadence: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]), locale: Type.Literal('en-KE'), timezone: Type.Literal('Africa/Nairobi'),
  activatedAt: Timestamp, setupAmount: Type.String({ minLength: 1 }), recurringAmount: Type.String({ minLength: 1 }), activatedAtLocal: Type.String({ minLength: 1 }),
  canPrepare: Type.Boolean(), canRecover: Type.Boolean(), blockedReasons: Type.Array(Type.String(), { maxItems: 6 }),
}, { additionalProperties: false })
const Step = Type.Object({ definitionId: Id, sequence: Type.Integer({ minimum: 1 }), state: Type.Union([Type.Literal('pending'), Type.Literal('running'), Type.Literal('succeeded'), Type.Literal('skipped'), Type.Literal('failed')]) }, { additionalProperties: false })
const Dashboard = Type.Object({
  review: Review,
  transfer: Type.Union([Type.Object({ state: State, version: Timestamp, confirmationStatus: Type.Union([Type.Literal('unconfirmed'), Type.Literal('partially-confirmed'), Type.Literal('confirmed')]), fence: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]), failureCode: Type.Union([Id, Type.Null()]), steps: Type.Array(Step, { maxItems: 128 }) }, { additionalProperties: false }), Type.Null()]),
  progressPercent: Type.Integer({ minimum: 0, maximum: 100 }),
  nextAction: Type.Union([Type.Literal('choose-assets'), Type.Literal('confirm-source'), Type.Literal('confirm-destination'), Type.Literal('start'), Type.Literal('wait'), Type.Literal('recover'), Type.Literal('complete'), Type.Literal('blocked')]),
  managedOwnership: Type.Union([Type.Literal('retained'), Type.Literal('removed')]), customerQuotaApplication: Type.Union([Type.Literal('pending'), Type.Literal('applied-once')]), internalGrantExcluded: Type.Literal(true),
}, { additionalProperties: false })
const Operation = Type.Object({ commandId: Id, transferId: Id, state: State, version: Timestamp }, { additionalProperties: false })
const AdminReceipt = Type.Object({ commandId: Id, transferId: Id, action: Type.Union([Type.Literal('reconciled'), Type.Literal('refund-escalated')]), transferState: State, outboxState: Type.Union([Type.Literal('pending'), Type.Literal('failed'), Type.Literal('delivered')]), occurredAt: Timestamp }, { additionalProperties: false })
const ErrorWire = Type.Object({ error: Type.String({ minLength: 1, maxLength: 1_000 }) }, { additionalProperties: false })

export type PaidHandoffDashboardWire = Static<typeof Dashboard>
export type PaidHandoffSelectionsWire = Static<typeof SelectionsSchema>
export type PaidHandoffClientTarget = Readonly<{ organizationId: string; workspaceId: string; siteId: string }>
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function root(target: PaidHandoffClientTarget, commandId: string): string {
  return `/api/fuma/organizations/${encodeURIComponent(target.organizationId)}/workspaces/${encodeURIComponent(target.workspaceId)}/sites/${encodeURIComponent(target.siteId)}/transfers/paid-handoffs/${encodeURIComponent(commandId)}`
}

export class PaidHandoffHttpClient {
  readonly #target: PaidHandoffClientTarget
  readonly #fetch: FetchLike
  constructor(target: PaidHandoffClientTarget, fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) { this.#target = target; this.#fetch = fetchImpl }
  async #call<T extends TSchema>(commandId: string, suffix: string, schema: T, body?: unknown): Promise<Static<T>> {
    const response = await this.#fetch(`${root(this.#target, commandId)}${suffix}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const raw: unknown = await response.json().catch(() => null)
    if (!response.ok) { const error = safeParseValue(ErrorWire, raw); throw new Error(error.ok ? error.value.error : 'Paid handoff operation failed.') }
    const envelope = safeParseValue(Type.Object({ result: schema }, { additionalProperties: false }), raw)
    if (!envelope.ok) throw new Error('Paid handoff response failed strict TypeBox validation.')
    return (envelope.value as unknown as Readonly<{ result: Static<T> }>).result
  }
  dashboard(commandId: string) { return this.#call(commandId, '', Dashboard) }
  prepare(commandId: string, transferId: string, selections: PaidHandoffSelectionsWire) { return this.#call(commandId, '/prepare', Operation, { commandId, transferId, selections }) }
  confirm(commandId: string, transferId: string, side: 'source' | 'destination', expectedVersion: string) { return this.#call(commandId, '/confirm', Operation, { transferId, side, expectedVersion }) }
  start(commandId: string, transferId: string, expectedVersion: string) { return this.#call(commandId, '/start', Operation, { transferId, expectedVersion }) }
  recover(commandId: string, transferId: string, expectedVersion: string, fence: number, reasonCode: string) { return this.#call(commandId, '/recover', Operation, { transferId, expectedVersion, fence, reasonCode }) }
  reconcile(commandId: string, transferId: string, expectedVersion: string) { return this.#call(commandId, '/reconcile', AdminReceipt, { transferId, expectedVersion }) }
  escalateRefund(commandId: string, transferId: string, expectedVersion: string, reasonCode: string) { return this.#call(commandId, '/refund-escalations', AdminReceipt, { transferId, expectedVersion, reasonCode }) }
}
