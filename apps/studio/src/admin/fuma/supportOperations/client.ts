import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Id = Type.String({ minLength: 1, maxLength: 255 })
const Timestamp = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' })
const Evidence = Type.Object({ objectKey: Type.String({ minLength: 12, maxLength: 512 }), hashSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false })
const TenantScope = Type.Object({ platformId: Id, organizationId: Id, workspaceId: Id, siteId: Id, ownerKey: Id, ownerGeneration: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })
export const SupportSessionWireSchema = Type.Object({
  supportSessionId: Id, scope: TenantScope, staffActorId: Id, staffSessionId: Id, targetUserId: Id,
  reason: Type.String(), stepUpAt: Timestamp, startedAt: Timestamp, expiresAt: Timestamp,
  banner: Type.String(), evidence: Evidence,
}, { additionalProperties: false })
export type SupportSessionWire = Static<typeof SupportSessionWireSchema>
const EndWire = Type.Object({ supportSessionId: Id, endedByActorId: Id, reasonCode: Type.Union([Type.Literal('completed'), Type.Literal('expired'), Type.Literal('revoked')]), endedAt: Timestamp }, { additionalProperties: false })
const ModerationWire = Type.Object({
  evidenceId: Id, caseId: Id, priorEvidenceId: Type.Union([Id, Type.Null()]), scope: TenantScope,
  subject: Type.Object({ kind: Type.Union([Type.Literal('user'), Type.Literal('organization'), Type.Literal('site'), Type.Literal('expert'), Type.Literal('plugin')]), id: Id }, { additionalProperties: false }),
  event: Type.Union([Type.Literal('opened'), Type.Literal('suspended'), Type.Literal('appealed'), Type.Literal('resolved')]),
  reasonCode: Type.String(), reason: Type.String(), evidence: Evidence, actorId: Id, createdAt: Timestamp,
}, { additionalProperties: false })
const QueuePage = Type.Object({ queue: Type.Union([Type.Literal('moderation'), Type.Literal('suspension'), Type.Literal('appeal')]), rows: Type.Array(ModerationWire), nextAfterEvidenceId: Type.Union([Id, Type.Null()]) }, { additionalProperties: false })
export type ModerationQueueWire = Static<typeof QueuePage>
const BreakGlassRequestWire = Type.Object({ requestId: Id, scope: TenantScope, targetOwnerId: Id, requestedByActorId: Id, reason: Type.String(), evidence: Evidence, channel: Type.Literal('isolated-owner-recovery'), createdAt: Timestamp, expiresAt: Timestamp }, { additionalProperties: false })
const BreakGlassApprovalWire = Type.Object({ approvalId: Id, requestId: Id, approverId: Id, approverSessionId: Id, stepUpAt: Timestamp, evidence: Evidence, approvedAt: Timestamp }, { additionalProperties: false })
const BreakGlassExecutionWire = Type.Object({ executionId: Id, requestId: Id, executorId: Id, approverIds: Type.Tuple([Id, Id]), recoveryIdempotencyKey: Id, executedAt: Timestamp }, { additionalProperties: false })
const ErrorWire = Type.Object({ error: Type.String({ minLength: 1 }) }, { additionalProperties: false })

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type SupportClientTarget = Readonly<{ organizationId: string; workspaceId: string; siteId: string }>
function base(target: SupportClientTarget): string { return `/api/fuma/organizations/${encodeURIComponent(target.organizationId)}/workspaces/${encodeURIComponent(target.workspaceId)}/sites/${encodeURIComponent(target.siteId)}/support` }

export class SupportOperationsHttpClient {
  readonly #base: string
  readonly #fetch: FetchLike
  constructor(target: SupportClientTarget, fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) { this.#base = base(target); this.#fetch = fetchImpl }
  async #call<T extends TSchema>(path: string, schema: T, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Static<T>> {
    const response = await this.#fetch(`${this.#base}${path}`, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const raw: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const failure = safeParseValue(ErrorWire, raw)
      throw new Error(failure.ok ? failure.value.error : 'Support operation failed.')
    }
    const envelope = safeParseValue(Type.Object({ result: schema }, { additionalProperties: false }), raw)
    if (!envelope.ok) throw new Error('Support response failed strict TypeBox validation.')
    return (envelope.value as unknown as Readonly<{ result: Static<T> }>).result
  }
  begin(input: unknown) { return this.#call('/sessions', SupportSessionWireSchema, input) }
  current() { return this.#call('/sessions/current', SupportSessionWireSchema) }
  end(supportSessionId: string) { return this.#call('/sessions/end', EndWire, { supportSessionId, reasonCode: 'completed' }) }
  recordModeration(input: unknown) { return this.#call('/moderation', ModerationWire, input) }
  queue(queue: 'moderation'|'suspension'|'appeal', afterEvidenceId: string | null = null) { const query = new URLSearchParams({ limit: '50' }); if (afterEvidenceId) query.set('afterEvidenceId', afterEvidenceId); return this.#call(`/moderation/queues/${queue}?${query}`, QueuePage) }
  createRecovery(input: unknown) { return this.#call('/break-glass/requests', BreakGlassRequestWire, input) }
  approveRecovery(input: unknown) { return this.#call('/break-glass/approvals', BreakGlassApprovalWire, input) }
  executeRecovery(input: unknown) { return this.#call('/break-glass/executions', BreakGlassExecutionWire, input) }
}
