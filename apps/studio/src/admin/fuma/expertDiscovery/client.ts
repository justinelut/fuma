import { PublicExpertSchema, PublicProfileSchema } from '@fuma/public-contracts'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'

const Id = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const Timestamp = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$' })
const PublicRevision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const Scope = Type.Object({ platformId: Id, organizationId: Id, workspaceId: Id, siteId: Id, ownerKey: Id, ownerGeneration: PublicRevision }, { additionalProperties: false })
const Profile = Type.Object({ expertId: Id, organizationId: Id, sourceScope: Scope, supportedProfiles: Type.Array(PublicProfileSchema, { minItems: 1, maxItems: 2, uniqueItems: true }), public: PublicExpertSchema, availability: Type.Union([Type.Literal('available'), Type.Literal('limited'), Type.Literal('unavailable')]), approvedReleaseId: Id, optedIn: Type.Boolean(), consentVersion: PublicRevision, publicRevision: PublicRevision, createdAt: Timestamp, updatedAt: Timestamp }, { additionalProperties: false })
const PluginLink = Type.Object({ expertId: Id, pluginId: Id, publisherOrganizationId: Id, verificationHashSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }), verifiedAt: Timestamp, revokedAt: Type.Union([Timestamp, Type.Null()]) }, { additionalProperties: false })
const Management = Type.Object({ profile: Type.Union([Profile, Type.Null()]), pluginLinks: Type.Array(PluginLink, { maxItems: 100 }), inquiryCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), integration: Type.Object({ ownerTicket: Type.Literal('FUMA-073'), mounted: Type.Literal(true), schemaAuthority: Type.Literal('000037_operations_experts_transfer') }, { additionalProperties: false }) }, { additionalProperties: false })
const Inquiry = Type.Object({ inquiryId: Id, expertId: Id, sourceProfile: PublicProfileSchema, state: Type.Literal('queued'), messageBytes: Type.Integer({ minimum: 1, maximum: 16_384 }), encryptedObjectKey: Type.String({ minLength: 12, maxLength: 512, pattern: '^experts/inquiries/[A-Za-z0-9._/-]+$' }), consentVersion: PublicRevision, createdAt: Timestamp, expiresAt: Timestamp }, { additionalProperties: false })
const ErrorWire = Type.Object({ error: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false })
export type ExpertManagementWire = Static<typeof Management>
export type ExpertClientTarget = Readonly<{ organizationId: string; workspaceId: string; siteId: string }>
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
function root(target: ExpertClientTarget) { return `/api/fuma/organizations/${encodeURIComponent(target.organizationId)}/workspaces/${encodeURIComponent(target.workspaceId)}/sites/${encodeURIComponent(target.siteId)}/experts` }
export class ExpertDiscoveryHttpClient {
  readonly #root: string; readonly #fetch: FetchLike
  constructor(target: ExpertClientTarget, fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) { this.#root = root(target); this.#fetch = fetchImpl }
  async #call<T extends TSchema>(path: string, schema: T, body?: unknown): Promise<Static<T>> {
    const response = await this.#fetch(`${this.#root}${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const raw: unknown = await response.json().catch(() => null); if (!response.ok) { const error = safeParseValue(ErrorWire, raw); throw new Error(error.ok ? error.value.error : 'Expert operation failed.') }
    const envelope = safeParseValue(Type.Object({ result: schema }, { additionalProperties: false }), raw); if (!envelope.ok) throw new Error('Expert response failed strict TypeBox validation.')
    return (envelope.value as unknown as Readonly<{ result: Static<T> }>).result
  }
  management(expertId: string) { return this.#call(`/${encodeURIComponent(expertId)}/management`, Management) }
  approve(input: unknown) { return this.#call('/releases/approve', Profile, input) }
  visibility(input: unknown) { return this.#call('/visibility', Profile, input) }
  inquiry(input: unknown) { return this.#call('/inquiries', Inquiry, input) }
  linkPlugin(input: unknown) { return this.#call('/plugins', PluginLink, input) }
  transfer(input: unknown) { return this.#call('/transfers', Profile, input) }
}
