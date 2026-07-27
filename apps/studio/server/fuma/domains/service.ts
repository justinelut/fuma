import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { normalizePublicHost } from '../freeHosts/service'

const DesiredSchema = Type.Union([Type.Literal('detached'), Type.Literal('prevalidated'), Type.Literal('active'), Type.Literal('deleted')])
const ObservedSchema = Type.Union([Type.Literal('unknown'), Type.Literal('pending-dns'), Type.Literal('pending-tls'), Type.Literal('active'), Type.Literal('failed'), Type.Literal('deleted')])
const CertificateSchema = Type.Union([Type.Literal('none'), Type.Literal('pending'), Type.Literal('active'), Type.Literal('expired'), Type.Literal('failed')])
export const DomainRecordSchema = Type.Object({
  domainId: Type.String({ minLength: 1, maxLength: 255 }), organizationId: Type.String({ minLength: 1 }), workspaceId: Type.String({ minLength: 1 }), siteId: Type.String({ minLength: 1 }),
  hostname: Type.String({ minLength: 1, maxLength: 253 }), kind: Type.Union([Type.Literal('free'), Type.Literal('customer-dns'), Type.Literal('fuma-registered')]),
  desired: DesiredSchema, observed: ObservedSchema, certificate: CertificateSchema,
  credentialScope: Type.Union([Type.Literal('fuma-platform'), Type.Literal('customer-automation'), Type.Null()]), version: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false })
export type DomainRecord = Static<typeof DomainRecordSchema>
export const DomainCredentialEnvelopeSchema = Type.Object({
  credentialId: Type.String({ minLength: 1 }), scope: Type.Union([Type.Literal('fuma-platform'), Type.Literal('customer-automation')]),
  organizationId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]), ciphertext: Type.String({ minLength: 16 }), keyId: Type.String({ minLength: 1 }),
  algorithm: Type.Literal('AES-256-GCM'), createdAt: Type.String({ format: 'date-time' }), rotatedFrom: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
}, { additionalProperties: false })
export type DomainCredentialEnvelope = Static<typeof DomainCredentialEnvelopeSchema>
export interface DomainSecretCipher {
  encrypt(scope: string, plaintext: Uint8Array): Promise<Readonly<{ ciphertext: string; keyId: string }>>
  decrypt(scope: string, envelope: DomainCredentialEnvelope): Promise<Uint8Array>
}
export const DomainTransitionSchema = Type.Object({
  transitionId: Type.String({ minLength: 1 }), domainId: Type.String({ minLength: 1 }), fromDesired: DesiredSchema, toDesired: DesiredSchema,
  fromObserved: ObservedSchema, toObserved: ObservedSchema, actorId: Type.String({ minLength: 1 }), occurredAt: Type.String({ format: 'date-time' }),
  reasonCode: Type.String({ minLength: 1, maxLength: 100 }),
}, { additionalProperties: false })
export type DomainTransition = Static<typeof DomainTransitionSchema>
export interface DomainRepository {
  insert(record: DomainRecord): Promise<boolean>
  exact(id: string): Promise<DomainRecord | null>
  transition(record: DomainRecord, expectedVersion: number, evidence: DomainTransition): Promise<boolean>
  storeCredential(envelope: DomainCredentialEnvelope): Promise<void>
}
export class DomainError extends Error {
  readonly code: 'invalid' | 'scope' | 'transition' | 'collision' | 'secret';
  constructor(code: 'invalid' | 'scope' | 'transition' | 'collision' | 'secret', message: string) { super(message); this.code = code; this.name = 'DomainError' }
}

const allowed: Readonly<Record<DomainRecord['desired'], readonly DomainRecord['desired'][]>> = {
  detached: ['prevalidated', 'deleted'], prevalidated: ['prevalidated', 'active', 'detached', 'deleted'], active: ['active', 'prevalidated', 'detached', 'deleted'], deleted: [],
}
function assertState(record: DomainRecord): void {
  if (record.observed === 'active' && (record.desired !== 'active' || record.certificate !== 'active')) throw new DomainError('transition', 'Observed routing cannot be active before desired state and TLS are active.')
  if (record.desired === 'active' && (record.observed !== 'active' || record.certificate !== 'active')) throw new DomainError('transition', 'Desired active state requires observed routing and an active certificate.')
  if (record.desired === 'deleted' && (record.observed !== 'deleted' || record.certificate !== 'none')) throw new DomainError('transition', 'Deleted domains cannot retain routing or certificate state.')
  if (record.desired === 'detached' && record.observed === 'active') throw new DomainError('transition', 'Detached domains cannot remain observed active.')
  if (record.kind === 'free' && record.credentialScope !== null) throw new DomainError('scope', 'Free hosts do not own provider credentials.')
  if (record.kind === 'customer-dns' && record.credentialScope === 'fuma-platform') throw new DomainError('scope', 'Customer DNS never receives or requires platform credentials.')
  if (record.kind === 'fuma-registered' && record.credentialScope !== 'fuma-platform') throw new DomainError('scope', 'Fuma-registered domains require the explicit platform credential scope.')
}
function credentialScopeKey(scope: 'fuma-platform' | 'customer-automation', organizationId: string | null): string {
  if (scope === 'fuma-platform' && organizationId !== null) throw new DomainError('scope', 'Platform credentials cannot be assigned to a customer organization.')
  if (scope === 'customer-automation' && !organizationId) throw new DomainError('scope', 'Customer credentials require an exact organization scope.')
  return `${scope}:${organizationId ?? 'platform'}`
}

export class DomainService {
  private readonly repository: DomainRepository;
  private readonly cipher: DomainSecretCipher;
  private readonly meter: (organizationId: string, siteId: string, delta: number) => Promise<void>;
  private readonly now: () => Date;
  constructor(repository: DomainRepository, cipher: DomainSecretCipher, meter: (organizationId: string, siteId: string, delta: number) => Promise<void>, now: () => Date = () => new Date()) { this.repository = repository; this.cipher = cipher; this.meter = meter; this.now = now;}

  async create(raw: unknown): Promise<DomainRecord> {
    if (!Value.Check(DomainRecordSchema, raw)) throw new DomainError('invalid', 'Domain contract is invalid.')
    const record = Object.freeze({ ...(structuredClone(raw) as DomainRecord), hostname: normalizePublicHost((raw as DomainRecord).hostname) })
    assertState(record)
    await this.meter(record.organizationId, record.siteId, 1)
    try {
      if (!await this.repository.insert(record)) throw new DomainError('collision', 'Hostname or domain identity already exists.')
    } catch (error) {
      await this.meter(record.organizationId, record.siteId, -1)
      throw error
    }
    return record
  }

  async transition(id: string, to: DomainRecord['desired'], observed: DomainRecord['observed'], certificate: DomainRecord['certificate'], actorId: string, reasonCode = 'reconcile'): Promise<DomainRecord> {
    const current = await this.repository.exact(id)
    if (!current || !Value.Check(DomainRecordSchema, current)) throw new DomainError('invalid', 'Domain is missing or corrupt.')
    if (!allowed[current.desired].includes(to)) throw new DomainError('transition', 'Invalid desired-state transition.')
    const next = Object.freeze({ ...current, desired: to, observed, certificate, version: current.version + 1 })
    assertState(next)
    const evidence: DomainTransition = Object.freeze({
      transitionId: crypto.randomUUID(), domainId: id, fromDesired: current.desired, toDesired: to, fromObserved: current.observed, toObserved: observed,
      actorId, occurredAt: this.now().toISOString(), reasonCode,
    })
    if (!Value.Check(DomainTransitionSchema, evidence) || !await this.repository.transition(next, current.version, evidence)) throw new DomainError('transition', 'Concurrent or invalid domain transition.')
    return next
  }

  async storeCredential(input: Readonly<{ credentialId: string; scope: 'fuma-platform' | 'customer-automation'; organizationId: string | null; secret: Uint8Array; rotatedFrom?: string | null }>): Promise<DomainCredentialEnvelope> {
    if (!(input.secret instanceof Uint8Array) || input.secret.byteLength < 1 || input.secret.byteLength > 65_536) throw new DomainError('secret', 'Domain credential plaintext has an invalid size.')
    const scopeKey = credentialScopeKey(input.scope, input.organizationId)
    const encrypted = await this.cipher.encrypt(scopeKey, input.secret)
    const envelope: DomainCredentialEnvelope = Object.freeze({
      credentialId: input.credentialId, scope: input.scope, organizationId: input.organizationId, ciphertext: encrypted.ciphertext, keyId: encrypted.keyId,
      algorithm: 'AES-256-GCM', createdAt: this.now().toISOString(), rotatedFrom: input.rotatedFrom ?? null,
    })
    const plaintext = new TextDecoder('utf-8', { fatal: false }).decode(input.secret)
    if (!Value.Check(DomainCredentialEnvelopeSchema, envelope) || envelope.ciphertext === plaintext) throw new DomainError('secret', 'Encrypted domain credential envelope is invalid.')
    await this.repository.storeCredential(envelope)
    return envelope
  }

  redacted(envelope: DomainCredentialEnvelope) {
    if (!Value.Check(DomainCredentialEnvelopeSchema, envelope)) throw new DomainError('secret', 'Credential envelope is invalid.')
    return Object.freeze({ credentialId: envelope.credentialId, scope: envelope.scope, organizationId: envelope.organizationId, keyId: envelope.keyId, algorithm: envelope.algorithm, secret: '[REDACTED]' as const })
  }
}

export class MemoryDomainRepository implements DomainRepository {
  readonly domains = new Map<string, DomainRecord>()
  readonly transitions: DomainTransition[] = []
  readonly credentials = new Map<string, DomainCredentialEnvelope>()
  async insert(record: DomainRecord) {
    if (this.domains.has(record.domainId) || [...this.domains.values()].some((value) => value.hostname === record.hostname)) return false
    this.domains.set(record.domainId, structuredClone(record)); return true
  }
  async exact(id: string) { return structuredClone(this.domains.get(id) ?? null) }
  async transition(record: DomainRecord, expectedVersion: number, evidence: DomainTransition) {
    const current = this.domains.get(record.domainId)
    if (!current || current.version !== expectedVersion || evidence.fromDesired !== current.desired || evidence.fromObserved !== current.observed) return false
    this.domains.set(record.domainId, structuredClone(record)); this.transitions.push(structuredClone(evidence)); return true
  }
  async storeCredential(envelope: DomainCredentialEnvelope) {
    const existing = this.credentials.get(envelope.credentialId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(envelope)) throw new DomainError('secret', 'Credential envelope identity is immutable.')
    this.credentials.set(envelope.credentialId, structuredClone(envelope))
  }
}
