import { createHash } from 'node:crypto'
import { samePublicationScope, type PublicationRepositoryScope } from '../publication/scope'
import {
  MemberCredentialRecordSchema,
  MemberIdentitySchema,
  MemberImportCommandSchema,
  MemberImportReceiptSchema,
  StaffMemberImportReauthenticationSchema,
  parseMemberIdentityContract,
  type MemberConsentEvent,
  type MemberImportCommand,
  type MemberImportReceipt,
  type StaffMemberImportReauthentication,
} from './contracts'
import type { MemberIdentityRepository } from './repository'
import { MEMBER_SESSION_POLICY } from './service'

export class MemberImportError extends Error {
  readonly code: 'reauthentication-required' | 'scope-denied' | 'conflict'
  constructor(code: 'reauthentication-required' | 'scope-denied' | 'conflict') {
    super(`Member import failed: ${code}.`)
    this.code = code
    this.name = 'MemberImportError'
  }
}

function stableId(...values: readonly string[]): string {
  return createHash('sha256').update(values.join('\u0000')).digest('hex')
}
function normalizedEmail(email: string): string { return email.trim().toLowerCase() }
function scopeIdentity(scope: PublicationRepositoryScope): string {
  return [scope.platformId, scope.organizationId, scope.workspaceId, scope.siteId, scope.ownerKey, scope.generation, scope.profileId].join('\u0000')
}

export interface StaffMemberImportReauthenticationAuthority {
  verify(proof: StaffMemberImportReauthentication): Promise<boolean>
}

export class MemberImportService {
  readonly #repository: MemberIdentityRepository
  readonly #authority: StaffMemberImportReauthenticationAuthority
  readonly #now: () => Date
  constructor(repository: MemberIdentityRepository, authority: StaffMemberImportReauthenticationAuthority, now: () => Date = () => new Date()) {
    this.#repository = repository
    this.#authority = authority
    this.#now = now
  }

  async import(scope: PublicationRepositoryScope, rawCommand: unknown, rawProof: unknown): Promise<MemberImportReceipt> {
    // additionalProperties:false rejects password/session/token/secret/role fields at every imported entry.
    const command = parseMemberIdentityContract('member import command', MemberImportCommandSchema, rawCommand) as MemberImportCommand
    const proof = parseMemberIdentityContract('staff member-import reauthentication', StaffMemberImportReauthenticationSchema, rawProof) as StaffMemberImportReauthentication
    const now = this.#now()
    this.#assertProof(scope, proof, now)
    if (!await this.#authority.verify(proof)) throw new MemberImportError('reauthentication-required')
    const existing = await this.#repository.getImportReceipt(scope, command.importId)
    if (existing) {
      if (existing.sourceSha256 !== command.sourceSha256 || existing.source !== command.source) throw new MemberImportError('conflict')
      return existing
    }

    const at = now.toISOString()
    const seen = new Set<string>()
    const identities: Array<Readonly<{ record: ReturnType<typeof credential>; consent: readonly MemberConsentEvent[] }>> = []
    let skippedCount = 0
    for (const entry of command.entries) {
      const email = normalizedEmail(entry.email)
      if (seen.has(email) || await this.#repository.findIdentityByEmail(scope, email)) {
        skippedCount += 1
        continue
      }
      seen.add(email)
      const memberIdentityId = `imported-${stableId(scopeIdentity(scope), command.importId, entry.externalId).slice(0, 40)}`
      const identity = parseMemberIdentityContract('imported member identity', MemberIdentitySchema, {
        memberIdentityId, email, displayName: entry.displayName.trim(), state: 'activation-required', origin: 'staff-import', importReceiptId: command.importId, createdAt: at, updatedAt: at,
      })
      identities.push({
        record: credential(identity, email),
        consent: entry.consents.map((consent): MemberConsentEvent => ({
          eventId: `consent-${stableId(command.importId, entry.externalId, consent.purpose, consent.action, consent.noticeVersion).slice(0, 40)}`,
          memberIdentityId, ...consent, source: 'staff-import', sourceReceiptId: command.importId, occurredAt: at,
        })),
      })
    }
    const receipt = parseMemberIdentityContract('member import receipt', MemberImportReceiptSchema, {
      importId: command.importId, source: command.source, sourceSha256: command.sourceSha256,
      staffUserId: proof.staffUserId, staffSessionId: proof.staffSessionId, reauthenticationProofId: proof.proofId,
      importedCount: identities.length, skippedCount, createdAt: at,
    }) as MemberImportReceipt
    if (!await this.#repository.commitImport(scope, {
      receipt,
      proof: { authenticatedAt: proof.authenticatedAt, expiresAt: proof.expiresAt },
      identities,
    })) throw new MemberImportError('conflict')
    return receipt
  }

  #assertProof(scope: PublicationRepositoryScope, proof: StaffMemberImportReauthentication, now: Date): void {
    if (!samePublicationScope(scope, proof.scope)) throw new MemberImportError('scope-denied')
    const authenticatedAt = Date.parse(proof.authenticatedAt)
    const expiresAt = Date.parse(proof.expiresAt)
    if (authenticatedAt > now.getTime() || expiresAt <= now.getTime() || expiresAt - authenticatedAt > MEMBER_SESSION_POLICY.reauthenticationMs) {
      throw new MemberImportError('reauthentication-required')
    }
  }
}

function credential(identity: unknown, email: string) {
  return parseMemberIdentityContract('imported member credential', MemberCredentialRecordSchema, {
    identity, normalizedEmail: email, passwordHash: null,
  })
}
