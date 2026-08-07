import type { DbClient } from '../../db/client'
import {
  MemberCredentialRecordSchema,
  MemberIdentitySchema,
  MemberImportReceiptSchema,
  MemberSessionRecordSchema,
  parseMemberIdentityContract,
  type MemberConsentEvent,
  type MemberCredentialRecord,
  type MemberIdentity,
  type MemberIdentityScope,
  type MemberImportReceipt,
  type MemberSessionRecord,
} from './contracts'
import { MAX_IDENTITY_PAGE, type MemberIdentityPage, type MemberIdentityRepository, type ResolvedMemberSession } from './repository'

interface IdentityRow { member_identity_id:string; normalized_email:string; display_name:string; password_hash:string|null; state:string; origin:string; import_receipt_id:string|null; created_at:string|Date; updated_at:string|Date }
interface SessionRow { session_id:string; member_identity_id:string; token_hash_sha256:string; created_at:string|Date; last_seen_at:string|Date; expires_at:string|Date; idle_expires_at:string|Date; reauthenticated_at:string|Date|null; revoked_at:string|Date|null; user_agent_hash_sha256:string|null; ip_hash_sha256:string|null }
interface ResolvedRow extends SessionRow { normalized_email:string; display_name:string; password_hash:string|null; state:string; origin:string; import_receipt_id:string|null; identity_created_at:string|Date; identity_updated_at:string|Date }
interface ImportRow { import_id:string; source:string; source_sha256:string; staff_user_id:string; staff_session_id:string; reauthentication_proof_id:string; imported_count:number|string|bigint; skipped_count:number|string|bigint; created_at:string|Date }

function iso(value:string|Date|null):string|null{return value===null?null:(value instanceof Date?value.toISOString():new Date(value).toISOString())}
function count(value:number|string|bigint):number{return Number(value)}
type IdentityListRow=Omit<IdentityRow,'password_hash'>
/** Maps a hash-free row. Validated against MemberIdentitySchema so the shape is checked, not trusted. */
function identityOnly(row:IdentityListRow):MemberIdentity{return parseMemberIdentityContract('stored member identity',MemberIdentitySchema,{memberIdentityId:row.member_identity_id,email:row.normalized_email,displayName:row.display_name,state:row.state,origin:row.origin,importReceiptId:row.import_receipt_id,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}) as MemberIdentity}
function identity(row:IdentityRow):MemberCredentialRecord{return parseMemberIdentityContract('stored member credential',MemberCredentialRecordSchema,{identity:{memberIdentityId:row.member_identity_id,email:row.normalized_email,displayName:row.display_name,state:row.state,origin:row.origin,importReceiptId:row.import_receipt_id,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)},normalizedEmail:row.normalized_email,passwordHash:row.password_hash}) as MemberCredentialRecord}
function session(row:SessionRow):MemberSessionRecord{return parseMemberIdentityContract('stored member session',MemberSessionRecordSchema,{sessionId:row.session_id,memberIdentityId:row.member_identity_id,tokenHashSha256:row.token_hash_sha256,createdAt:iso(row.created_at),lastSeenAt:iso(row.last_seen_at),expiresAt:iso(row.expires_at),idleExpiresAt:iso(row.idle_expires_at),reauthenticatedAt:iso(row.reauthenticated_at),revokedAt:iso(row.revoked_at),userAgentHashSha256:row.user_agent_hash_sha256,ipHashSha256:row.ip_hash_sha256}) as MemberSessionRecord}
function receipt(row:ImportRow):MemberImportReceipt{return parseMemberIdentityContract('stored member import receipt',MemberImportReceiptSchema,{importId:row.import_id,source:row.source,sourceSha256:row.source_sha256,staffUserId:row.staff_user_id,staffSessionId:row.staff_session_id,reauthenticationProofId:row.reauthentication_proof_id,importedCount:count(row.imported_count),skippedCount:count(row.skipped_count),createdAt:iso(row.created_at)}) as MemberImportReceipt}
function conflict(error:unknown):boolean{return typeof error==='object'&&error!==null&&'code'in error&&(error as{code?:unknown}).code==='23505'}

export class PostgresMemberIdentityRepository implements MemberIdentityRepository {
  readonly db:DbClient
  constructor(db:DbClient){this.db=db}

  async #authorized<T>(scope:MemberIdentityScope,work:(db:DbClient)=>Promise<T>):Promise<T>{
    return await this.db.transaction(async(db)=>{
      const authority=await db`select 1 from fuma_tenant_owner_keys where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and generation=${scope.generation} and state='active' and transfer_id is null and transfer_lock_id is null and transfer_fence is null for share`
      if(authority.rowCount!==1)throw new Error('Member identity scope authority denied.')
      return await work(db)
    })
  }

  async #insertIdentity(db:DbClient,scope:MemberIdentityScope,record:MemberCredentialRecord):Promise<boolean>{const value=parseMemberIdentityContract('member credential insert',MemberCredentialRecordSchema,record) as MemberCredentialRecord;return(await db`insert into fuma_member_identities(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,member_identity_id,normalized_email,display_name,password_hash,state,origin,import_receipt_id,created_at,updated_at) values(${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.identity.memberIdentityId},${value.normalizedEmail},${value.identity.displayName},${value.passwordHash},${value.identity.state},${value.identity.origin},${value.identity.importReceiptId},${value.identity.createdAt},${value.identity.updatedAt}) on conflict do nothing`).rowCount===1}
  async #insertConsent(db:DbClient,scope:MemberIdentityScope,event:MemberConsentEvent):Promise<void>{await db`insert into fuma_member_consent_events(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,event_id,member_identity_id,purpose,action,notice_version,source,source_receipt_id,occurred_at) values(${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${event.eventId},${event.memberIdentityId},${event.purpose},${event.action},${event.noticeVersion},${event.source},${event.sourceReceiptId},${event.occurredAt})`}
  async #insertSession(db:DbClient,scope:MemberIdentityScope,value:MemberSessionRecord):Promise<boolean>{return(await db`insert into fuma_member_sessions(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,session_id,member_identity_id,token_hash_sha256,created_at,last_seen_at,expires_at,idle_expires_at,reauthenticated_at,revoked_at,user_agent_hash_sha256,ip_hash_sha256) values(${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${value.sessionId},${value.memberIdentityId},${value.tokenHashSha256},${value.createdAt},${value.lastSeenAt},${value.expiresAt},${value.idleExpiresAt},${value.reauthenticatedAt},${value.revokedAt},${value.userAgentHashSha256},${value.ipHashSha256}) on conflict do nothing`).rowCount===1}

  async createIdentity(scope:MemberIdentityScope,record:MemberCredentialRecord,consent:readonly MemberConsentEvent[]):Promise<boolean>{
    try{return await this.#authorized(scope,async(db)=>{if(!await this.#insertIdentity(db,scope,record))return false;for(const event of consent)await this.#insertConsent(db,scope,event);return true})}catch(error){if(conflict(error))return false;throw error}
  }
  async findIdentityByEmail(scope:MemberIdentityScope,normalizedEmail:string):Promise<MemberCredentialRecord|null>{return await this.#authorized(scope,async(db)=>{const row=(await db<IdentityRow>`select member_identity_id,normalized_email,display_name,password_hash,state,origin,import_receipt_id,created_at,updated_at from fuma_member_identities where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and normalized_email=${normalizedEmail}`).rows[0];return row?identity(row):null})}

  /**
   * Scoped identity list for the members directory.
   *
   * EVERY ONE of the seven scope columns is in the predicate. Dropping any of them would return
   * another site's members, which is the same cross-tenant class as the shared site document - and it
   * would look like a working list.
   *
   * Selects NO password_hash: the return type is MemberIdentity rather than MemberCredentialRecord, so
   * a hash cannot travel to an admin surface even by accident.
   */
  async listIdentities(scope:MemberIdentityScope,page?:MemberIdentityPage):Promise<readonly MemberIdentity[]>{
    const limit=Math.min(page?.limit??MAX_IDENTITY_PAGE,MAX_IDENTITY_PAGE)
    const after=page?.after
    return await this.#authorized(scope,async(db)=>{
      // Ordered by (created_at, member_identity_id): two members created in the same millisecond make
      // an unstable boundary without the tiebreak, so one of them is skipped or repeated on the next page.
      const rows=after===undefined
        ?(await db<IdentityListRow>`select member_identity_id,normalized_email,display_name,state,origin,import_receipt_id,created_at,updated_at from fuma_member_identities where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} order by created_at asc,member_identity_id asc limit ${limit}`).rows
        :(await db<IdentityListRow>`select member_identity_id,normalized_email,display_name,state,origin,import_receipt_id,created_at,updated_at from fuma_member_identities where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and (created_at,member_identity_id)>(${after.createdAt},${after.memberIdentityId}) order by created_at asc,member_identity_id asc limit ${limit}`).rows
      return Object.freeze(rows.map((row)=>identityOnly(row)))
    })
  }
  async createSession(scope:MemberIdentityScope,value:MemberSessionRecord):Promise<boolean>{return await this.#authorized(scope,db=>this.#insertSession(db,scope,value))}
  async resolveSession(scope:MemberIdentityScope,tokenHashSha256:string):Promise<ResolvedMemberSession|null>{return await this.#authorized(scope,async(db)=>{const row=(await db<ResolvedRow>`select i.member_identity_id,i.normalized_email,i.display_name,i.password_hash,i.state,i.origin,i.import_receipt_id,i.created_at as identity_created_at,i.updated_at as identity_updated_at,s.session_id,s.member_identity_id,s.token_hash_sha256,s.created_at,s.last_seen_at,s.expires_at,s.idle_expires_at,s.reauthenticated_at,s.revoked_at,s.user_agent_hash_sha256,s.ip_hash_sha256 from fuma_member_sessions s join fuma_member_identities i on i.platform_id=s.platform_id and i.organization_id=s.organization_id and i.workspace_id=s.workspace_id and i.site_id=s.site_id and i.owner_key=s.owner_key and i.owner_generation=s.owner_generation and i.profile_id=s.profile_id and i.member_identity_id=s.member_identity_id where s.platform_id=${scope.platformId} and s.organization_id=${scope.organizationId} and s.workspace_id=${scope.workspaceId} and s.site_id=${scope.siteId} and s.owner_key=${scope.ownerKey} and s.owner_generation=${scope.generation} and s.profile_id=${scope.profileId} and s.token_hash_sha256=${tokenHashSha256}`).rows[0];return row?{identity:identity({...row,created_at:row.identity_created_at,updated_at:row.identity_updated_at}),session:session(row)}:null})}
  async rotateSession(scope:MemberIdentityScope,previousSessionId:string,next:MemberSessionRecord,revokedAt:string):Promise<boolean>{try{return await this.#authorized(scope,async(db)=>{const revoked=await db`update fuma_member_sessions set revoked_at=${revokedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and session_id=${previousSessionId} and revoked_at is null`;if(revoked.rowCount!==1)return false;if(!await this.#insertSession(db,scope,next))throw Object.assign(new Error('member session rotation collision'),{code:'23505'});return true})}catch(error){if(conflict(error))return false;throw error}}
  async touchSession(scope:MemberIdentityScope,sessionId:string,lastSeenAt:string,idleExpiresAt:string):Promise<boolean>{return await this.#authorized(scope,async(db)=>(await db`update fuma_member_sessions set last_seen_at=${lastSeenAt},idle_expires_at=least(expires_at,${idleExpiresAt}) where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and session_id=${sessionId} and revoked_at is null and expires_at>${lastSeenAt} and idle_expires_at>${lastSeenAt}`).rowCount===1)}
  async revokeSession(scope:MemberIdentityScope,sessionId:string,revokedAt:string):Promise<boolean>{return await this.#authorized(scope,async(db)=>(await db`update fuma_member_sessions set revoked_at=${revokedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and session_id=${sessionId} and revoked_at is null`).rowCount===1)}
  async revokeIdentitySessions(scope:MemberIdentityScope,memberIdentityId:string,revokedAt:string):Promise<number>{return await this.#authorized(scope,async(db)=>(await db`update fuma_member_sessions set revoked_at=${revokedAt} where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and member_identity_id=${memberIdentityId} and revoked_at is null`).rowCount)}

  async commitImport(scope:MemberIdentityScope,input:Readonly<{receipt:MemberImportReceipt;proof:Readonly<{authenticatedAt:string;expiresAt:string}>;identities:readonly Readonly<{record:MemberCredentialRecord;consent:readonly MemberConsentEvent[]}>[]}>):Promise<boolean>{
    try{return await this.#authorized(scope,async(db)=>{const r=input.receipt;const inserted=await db`insert into fuma_member_import_receipts(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,import_id,source,source_sha256,staff_user_id,staff_session_id,reauthentication_proof_id,reauthenticated_at,reauthentication_expires_at,imported_count,skipped_count,created_at) values(${scope.platformId},${scope.organizationId},${scope.workspaceId},${scope.siteId},${scope.ownerKey},${scope.generation},${scope.profileId},${r.importId},${r.source},${r.sourceSha256},${r.staffUserId},${r.staffSessionId},${r.reauthenticationProofId},${input.proof.authenticatedAt},${input.proof.expiresAt},${r.importedCount},${r.skippedCount},${r.createdAt}) on conflict do nothing`;if(inserted.rowCount!==1)return false;for(const item of input.identities){if(!await this.#insertIdentity(db,scope,item.record))throw Object.assign(new Error('member import collision'),{code:'23505'});for(const event of item.consent)await this.#insertConsent(db,scope,event)}return true})}catch(error){if(conflict(error))return false;throw error}
  }
  async getImportReceipt(scope:MemberIdentityScope,importId:string):Promise<MemberImportReceipt|null>{return await this.#authorized(scope,async(db)=>{const row=(await db<ImportRow>`select import_id,source,source_sha256,staff_user_id,staff_session_id,reauthentication_proof_id,imported_count,skipped_count,created_at from fuma_member_import_receipts where platform_id=${scope.platformId} and organization_id=${scope.organizationId} and workspace_id=${scope.workspaceId} and site_id=${scope.siteId} and owner_key=${scope.ownerKey} and owner_generation=${scope.generation} and profile_id=${scope.profileId} and import_id=${importId}`).rows[0];return row?receipt(row):null})}
}
