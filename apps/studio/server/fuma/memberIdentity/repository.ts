import type {
  MemberConsentEvent,
  MemberCredentialRecord,
  MemberIdentityScope,
  MemberImportReceipt,
  MemberSessionRecord,
} from './contracts'
import { samePublicationScope } from '../publication/scope'

export type ResolvedMemberSession = Readonly<{
  identity: MemberCredentialRecord
  session: MemberSessionRecord
}>

export interface MemberIdentityRepository {
  createIdentity(scope: MemberIdentityScope, record: MemberCredentialRecord, consent: readonly MemberConsentEvent[]): Promise<boolean>
  findIdentityByEmail(scope: MemberIdentityScope, normalizedEmail: string): Promise<MemberCredentialRecord | null>
  createSession(scope: MemberIdentityScope, session: MemberSessionRecord): Promise<boolean>
  resolveSession(scope: MemberIdentityScope, tokenHashSha256: string): Promise<ResolvedMemberSession | null>
  rotateSession(scope: MemberIdentityScope, previousSessionId: string, next: MemberSessionRecord, revokedAt: string): Promise<boolean>
  touchSession(scope: MemberIdentityScope, sessionId: string, lastSeenAt: string, idleExpiresAt: string): Promise<boolean>
  revokeSession(scope: MemberIdentityScope, sessionId: string, revokedAt: string): Promise<boolean>
  revokeIdentitySessions(scope: MemberIdentityScope, memberIdentityId: string, revokedAt: string): Promise<number>
  commitImport(scope: MemberIdentityScope, input: Readonly<{
    receipt: MemberImportReceipt
    proof: Readonly<{ authenticatedAt: string; expiresAt: string }>
    identities: readonly Readonly<{ record: MemberCredentialRecord; consent: readonly MemberConsentEvent[] }>[]
  }>): Promise<boolean>
  getImportReceipt(scope: MemberIdentityScope, importId: string): Promise<MemberImportReceipt | null>
}

type Scoped<T> = Readonly<{ scope: MemberIdentityScope; value: T }>

function scopeKey(scope: MemberIdentityScope): string {
  return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, scope.profileId].join('\u0000')
}

function clone<T>(value: T): T { return structuredClone(value) }

/** Test/demo repository; production uses PostgresMemberIdentityRepository. */
export class MemoryMemberIdentityRepository implements MemberIdentityRepository {
  readonly identities = new Map<string, Scoped<MemberCredentialRecord>>()
  readonly sessions = new Map<string, Scoped<MemberSessionRecord>>()
  readonly consents: Scoped<MemberConsentEvent>[] = []
  readonly imports = new Map<string, Scoped<MemberImportReceipt>>()

  async createIdentity(scope: MemberIdentityScope, record: MemberCredentialRecord, consent: readonly MemberConsentEvent[]): Promise<boolean> {
    const emailKey = `${scopeKey(scope)}\u0000${record.normalizedEmail}`
    if (this.identities.has(emailKey)) return false
    this.identities.set(emailKey, { scope: clone(scope), value: clone(record) })
    for (const event of consent) this.consents.push({ scope: clone(scope), value: clone(event) })
    return true
  }

  findIdentityByEmail(scope: MemberIdentityScope, normalizedEmail: string): Promise<MemberCredentialRecord | null> {
    const found = this.identities.get(`${scopeKey(scope)}\u0000${normalizedEmail}`)
    return Promise.resolve(found && samePublicationScope(found.scope, scope) ? clone(found.value) : null)
  }

  async createSession(scope: MemberIdentityScope, session: MemberSessionRecord): Promise<boolean> {
    if ([...this.sessions.values()].some((entry) => entry.value.tokenHashSha256 === session.tokenHashSha256)) return false
    this.sessions.set(`${scopeKey(scope)}\u0000${session.sessionId}`, { scope: clone(scope), value: clone(session) })
    return true
  }

  async resolveSession(scope: MemberIdentityScope, tokenHashSha256: string): Promise<ResolvedMemberSession | null> {
    const entry = [...this.sessions.values()].find((item) => samePublicationScope(item.scope, scope) && item.value.tokenHashSha256 === tokenHashSha256)
    if (!entry) return null
    const identity = [...this.identities.values()].find((item) => samePublicationScope(item.scope, scope) && item.value.identity.memberIdentityId === entry.value.memberIdentityId)
    return identity ? { identity: clone(identity.value), session: clone(entry.value) } : null
  }

  async rotateSession(scope: MemberIdentityScope, previousSessionId: string, next: MemberSessionRecord, revokedAt: string): Promise<boolean> {
    const key = `${scopeKey(scope)}\u0000${previousSessionId}`
    const current = this.sessions.get(key)
    if (!current || current.value.revokedAt !== null || [...this.sessions.values()].some((entry) => entry.value.tokenHashSha256 === next.tokenHashSha256)) return false
    this.sessions.set(key, { scope: current.scope, value: { ...current.value, revokedAt } })
    this.sessions.set(`${scopeKey(scope)}\u0000${next.sessionId}`, { scope: clone(scope), value: clone(next) })
    return true
  }

  async touchSession(scope: MemberIdentityScope, sessionId: string, lastSeenAt: string, idleExpiresAt: string): Promise<boolean> {
    const key = `${scopeKey(scope)}\u0000${sessionId}`
    const current = this.sessions.get(key)
    if (!current || current.value.revokedAt !== null) return false
    this.sessions.set(key, { scope: current.scope, value: { ...current.value, lastSeenAt, idleExpiresAt } })
    return true
  }

  async revokeSession(scope: MemberIdentityScope, sessionId: string, revokedAt: string): Promise<boolean> {
    const key = `${scopeKey(scope)}\u0000${sessionId}`
    const current = this.sessions.get(key)
    if (!current || current.value.revokedAt !== null) return false
    this.sessions.set(key, { scope: current.scope, value: { ...current.value, revokedAt } })
    return true
  }

  async revokeIdentitySessions(scope: MemberIdentityScope, memberIdentityId: string, revokedAt: string): Promise<number> {
    let count = 0
    for (const [key, current] of this.sessions) {
      if (!samePublicationScope(current.scope, scope) || current.value.memberIdentityId !== memberIdentityId || current.value.revokedAt !== null) continue
      this.sessions.set(key, { scope: current.scope, value: { ...current.value, revokedAt } })
      count += 1
    }
    return count
  }

  async commitImport(scope: MemberIdentityScope, input: Readonly<{
    receipt: MemberImportReceipt
    proof: Readonly<{ authenticatedAt: string; expiresAt: string }>
    identities: readonly Readonly<{ record: MemberCredentialRecord; consent: readonly MemberConsentEvent[] }>[]
  }>): Promise<boolean> {
    const key = `${scopeKey(scope)}\u0000${input.receipt.importId}`
    if (this.imports.has(key)) return false
    const emailKeys = input.identities.map(({ record }) => `${scopeKey(scope)}\u0000${record.normalizedEmail}`)
    if (new Set(emailKeys).size !== emailKeys.length || emailKeys.some((emailKey) => this.identities.has(emailKey))) return false
    this.imports.set(key, { scope: clone(scope), value: clone(input.receipt) })
    for (const { record, consent } of input.identities) {
      const emailKey = `${scopeKey(scope)}\u0000${record.normalizedEmail}`
      this.identities.set(emailKey, { scope: clone(scope), value: clone(record) })
      for (const event of consent) this.consents.push({ scope: clone(scope), value: clone(event) })
    }
    return true
  }

  getImportReceipt(scope: MemberIdentityScope, importId: string): Promise<MemberImportReceipt | null> {
    const found = this.imports.get(`${scopeKey(scope)}\u0000${importId}`)
    return Promise.resolve(found && samePublicationScope(found.scope, scope) ? clone(found.value) : null)
  }
}
