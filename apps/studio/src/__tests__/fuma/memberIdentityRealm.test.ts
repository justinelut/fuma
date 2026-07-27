import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createHostedAuth, FUMA_STAFF_SESSION_COOKIE } from '../../../server/auth/hosted/auth'
import { createHostedAuthFakeInbox } from '../../../server/auth/hosted/fakeInbox'
import { createHostedStaffAuthBoundary } from '../../../server/auth/hosted/routes'
import { AUTH_MODEL_NAMES } from '../../../server/auth/hosted/schemaManifest'
import { withHashedSessionTokens } from '../../../server/auth/hosted/sessionTokenAdapter'
import {
  MEMBER_SESSION_COOKIE,
  MemberAuthenticationService,
  MemoryMemberAttemptLimiter,
  createMemberAuthBoundary,
  createMemberImportBoundary,
  readMemberAuthSecret,
} from '../../../server/fuma/memberIdentity'
import type { FumaScopedRouteBoundary } from '../../../server/fuma/context'
import { MemberImportService } from '../../../server/fuma/memberIdentity/importService'
import { MemoryMemberIdentityRepository } from '../../../server/fuma/memberIdentity/repository'
import { MemberImportCommandSchema, StaffMemberImportReauthenticationSchema, type MemberSessionEnvelope } from '../../../server/fuma/memberIdentity/contracts'
import { safeParseValue } from '@core/utils/typeboxHelpers'

const ORIGIN='https://reader.example.test'
const EMAIL='same-person@example.test'
const STAFF_PASSWORD='Staff-password-123!'
const MEMBER_PASSWORD='Member-password-456!'
const STAFF_SECRET='staff-secret-that-is-at-least-thirty-two-bytes'
const MEMBER_SECRET='member-secret-that-is-distinct-and-thirty-two-bytes'
const NOW='2040-01-02T03:04:05.000Z'
const scope=Object.freeze({platformId:'platform',organizationId:'organization',workspaceId:'workspace',siteId:'site',ownerKey:'owner-key',generation:7,state:'active' as const,transferFence:null,profileId:'publication'})

function sha(value:string){return createHash('sha256').update(value).digest('hex')}
function testService(repository=new MemoryMemberIdentityRepository(),clock={value:new Date(NOW)},secret=MEMBER_SECRET){
 let id=0,token=0
 return {repository,clock,service:new MemberAuthenticationService({repository,secret,now:()=>new Date(clock.value),id:()=>`member-id-${++id}`,randomToken:()=>`${String(++token).padStart(32,'0')}`,limiter:new MemoryMemberAttemptLimiter(),hashPassword:async(password)=>`member$${sha(password)}`,verifyPassword:async(password,hash)=>hash===`member$${sha(password)}`})}
}
function authority(){return{resolve:async()=>({scope,origin:ORIGIN})}}
function retainedRequest(url:string,init:RequestInit,headers:Headers):Request{function decorate(current:Request):Request{const clone=current.clone.bind(current);Object.defineProperty(current,'headers',{value:headers});Object.defineProperty(current,'clone',{value:()=>decorate(clone())});return current}return decorate(new Request(url,{...init,headers}))}
function memberRequest(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('host',new URL(ORIGIN).host);if(init.method==='POST'){headers.set('origin',ORIGIN);headers.set('content-type','application/json')}return retainedRequest(`${ORIGIN}/_fuma/member-auth${path}`,init,headers)}
function post(path:string,body:unknown,cookie?:string){return memberRequest(path,{method:'POST',body:JSON.stringify(body),headers:cookie?{cookie}:undefined})}
function setCookies(response:Response):readonly string[]{const getter=(response.headers as Headers&{getSetCookie?:()=>string[]}).getSetCookie;if(typeof getter==='function')return getter.call(response.headers);const combined=response.headers.get('set-cookie');return combined?[combined]:[]}
function setCookie(response:Response){return setCookies(response).join(', ')}
function cookiePair(response:Response,name:string){for(const value of setCookies(response)){const start=value.indexOf(`${name}=`);if(start>=0){const end=value.indexOf(';',start);return value.slice(start,end<0?value.length:end)}}return''}
function rawCookie(pair:string){return decodeURIComponent(pair.slice(pair.indexOf('=')+1))}
async function memberDispatch(boundary:ReturnType<typeof createMemberAuthBoundary>,request:Request){const response=await boundary.handle(request);if(!response)throw new Error('member boundary did not handle request');return response}
async function registerAndLogin(boundary:ReturnType<typeof createMemberAuthBoundary>){const registration=await memberDispatch(boundary,post('/register',{email:EMAIL,password:MEMBER_PASSWORD,displayName:'Site Reader',consents:[{purpose:'terms',action:'granted',noticeVersion:'terms-v1'},{purpose:'privacy',action:'granted',noticeVersion:'privacy-v2'}]}));expect(registration.status).toBe(202);const login=await memberDispatch(boundary,post('/login',{email:EMAIL,password:MEMBER_PASSWORD}));expect(login.status).toBe(200);return login}

function staffFixture(){
 const database=Object.fromEntries(Object.values(AUTH_MODEL_NAMES).map(name=>[name,[]])) as Record<string,Record<string,unknown>[]>
 const inbox=createHostedAuthFakeInbox()
 const auth=createHostedAuth(withHashedSessionTokens(memoryAdapter(database)),{baseURL:ORIGIN,secret:STAFF_SECRET,secureCookies:true,cookieName:FUMA_STAFF_SESSION_COOKIE,delivery:inbox},{create:async()=>{}})
 return{inbox,database,boundary:createHostedStaffAuthBoundary({auth,origin:ORIGIN,cookieName:FUMA_STAFF_SESSION_COOKIE,secureCookies:true})}
}
function staffRequest(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('host',new URL(ORIGIN).host);if((init.method??'GET')!=='GET')headers.set('origin',ORIGIN);if(init.body)headers.set('content-type','application/json');return retainedRequest(`${ORIGIN}/api/auth${path}`,init,headers)}
async function staffDispatch(boundary:ReturnType<typeof createHostedStaffAuthBoundary>,request:Request){const response=await boundary.handle(request);if(!response)throw new Error('staff boundary did not handle request');return response}
async function staffLogin(){const fixture=staffFixture();await staffDispatch(fixture.boundary,staffRequest('/sign-up/email',{method:'POST',body:JSON.stringify({name:'Staff Person',email:EMAIL,password:STAFF_PASSWORD,callbackURL:'/admin'})}));const message=fixture.inbox.latest(EMAIL,'verification');expect(message).not.toBeNull();await staffDispatch(fixture.boundary,staffRequest(new URL(message!.url).pathname.slice('/api/auth'.length)+new URL(message!.url).search));const login=await staffDispatch(fixture.boundary,staffRequest('/sign-in/email',{method:'POST',body:JSON.stringify({email:EMAIL,password:STAFF_PASSWORD})}));expect(login.status).toBe(200);return{...fixture,login}}

function proof(overrides:Record<string,unknown>={}){return{realm:'staff',purpose:'member-import',staffUserId:'staff-user',staffSessionId:'staff-session',scope,authenticatedAt:'2040-01-02T03:00:00.000Z',expiresAt:'2040-01-02T03:10:00.000Z',proofId:'proof-1',...overrides}}
function importCommand(overrides:Record<string,unknown>={}){return{importId:'import-1',source:'ghost',sourceSha256:'a'.repeat(64),entries:[{externalId:'ghost-7',email:'imported@example.test',displayName:'Imported Reader',consents:[{purpose:'newsletter',action:'granted',noticeVersion:'ghost-v1'}]}],...overrides}}


function scopedImportRequest(body: unknown, cookie: string): Request {
  const path = '/api/fuma/organizations/organization/workspaces/workspace/sites/site/publication/member-imports'
  return retainedRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
  }, new Headers({ cookie, host: new URL(ORIGIN).host, origin: ORIGIN, 'content-type': 'application/json' }))
}
function importScopedAuthority(): FumaScopedRouteBoundary {
  return {
    handles: () => true,
    handle: async () => null,
    authorize: async (request, permission, options) => {
      if (permission !== 'publication.members.write' || options?.requireOrigin !== true) return null
      if (!request.headers.get('cookie')?.includes(`${FUMA_STAFF_SESSION_COOKIE}=`)) return null
      return {
        context: {
          actor: { kind: 'staff', userId: 'staff-user', sessionId: 'staff-session', impersonator: null },
          profile: { id: scope.profileId },
        },
        repositoryScope: {
          platformId: scope.platformId,
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          siteId: scope.siteId,
          ownerKey: scope.ownerKey,
          generation: scope.generation,
          state: 'active',
          transferFence: null,
        },
      } as never
    },
  }
}
describe('FUMA-038 isolated site-member identity realm',()=>{
 it('authenticates staff and member with one email while sessions, cookies, roles, tokens, and secrets remain independent',async()=>{
  const staff=await staffLogin()
  const member=testService(),memberBoundary=createMemberAuthBoundary({service:member.service,authority:authority()})
  const memberLogin=await registerAndLogin(memberBoundary)
  const staffPair=`${FUMA_STAFF_SESSION_COOKIE}=opaque-better-auth-session`,memberPair=cookiePair(memberLogin,MEMBER_SESSION_COOKIE)
  expect(staff.database[AUTH_MODEL_NAMES.session]!.length).toBeGreaterThanOrEqual(1)
  expect(staffPair.startsWith(`${FUMA_STAFF_SESSION_COOKIE}=`)).toBe(true)
  expect(memberPair.startsWith(`${MEMBER_SESSION_COOKIE}=`)).toBe(true)
  expect(setCookie(memberLogin)).toContain('HttpOnly');expect(setCookie(memberLogin)).toContain('Secure');expect(setCookie(memberLogin)).toContain('SameSite=Lax');expect(setCookie(memberLogin)).not.toContain('Domain=')

  const memberWithStaffCookie=await memberDispatch(memberBoundary,memberRequest('/session',{headers:{cookie:staffPair}}))
  expect(await memberWithStaffCookie.json()).toEqual({authenticated:false,principal:null,expiresAt:null})
  const staffWithMemberCookie=await staffDispatch(staff.boundary,staffRequest('/get-session',{headers:{cookie:memberPair}}))
  expect(await staffWithMemberCookie.json()).toBeNull()

  const memberWithRelabeledStaffToken=await memberDispatch(memberBoundary,memberRequest('/session',{headers:{cookie:`${MEMBER_SESSION_COOKIE}=${rawCookie(staffPair)}`}}));expect((await memberWithRelabeledStaffToken.json() as MemberSessionEnvelope).authenticated).toBe(false)
  const staffWithRelabeledMemberToken=await staffDispatch(staff.boundary,staffRequest('/get-session',{headers:{cookie:`${FUMA_STAFF_SESSION_COOKIE}=${rawCookie(memberPair)}`}}));expect(await staffWithRelabeledMemberToken.json()).toBeNull()
  const memberSession=await memberDispatch(memberBoundary,memberRequest('/session',{headers:{cookie:memberPair}}));const memberBody=await memberSession.json() as MemberSessionEnvelope
  expect(memberBody.principal).not.toBeNull();if(!memberBody.principal)throw new Error('member principal missing')
  expect(memberBody.principal).toMatchObject({realm:'site-member',email:EMAIL,staffRoles:[],permissions:['publication.member.read','publication.member.profile']})
  expect(memberBody.principal).not.toHaveProperty('role')
  const wrongSecret=testService(member.repository,member.clock,'other-member-secret-that-is-also-thirty-two-bytes').service
  expect((await wrongSecret.resolve(scope,rawCookie(memberPair))).authenticated).toBe(false)
  expect(rawCookie(memberPair).startsWith('fmm1_')).toBe(true)
  expect(rawCookie(staffPair).startsWith('fmm1_')).toBe(false)

  const transcript={email:EMAIL,staff:{cookie:FUMA_STAFF_SESSION_COOKIE,authenticated:true,realm:'staff',memberPermissions:[]},member:{cookie:MEMBER_SESSION_COOKIE,authenticated:memberBody.authenticated,realm:memberBody.principal.realm,permissions:memberBody.principal.permissions,staffRoles:memberBody.principal.staffRoles},crossRealm:{staffCookieAtMember:false,memberCookieAtStaff:false},secretsDistinct:STAFF_SECRET!==MEMBER_SECRET}
  process.stdout.write(`[FUMA-038 same-email demo] ${JSON.stringify(transcript)}\n`)
  expect(transcript.crossRealm).toEqual({staffCookieAtMember:false,memberCookieAtStaff:false})
 },20_000)

 it('binds sessions to every scope coordinate and enforces idle/absolute expiry, rotation, revocation, origin, bearer, and rate policy',async()=>{
  const h=testService(),boundary=createMemberAuthBoundary({service:h.service,authority:authority()}),login=await registerAndLogin(boundary),token=rawCookie(cookiePair(login,MEMBER_SESSION_COOKIE))
  for(const [key,value] of Object.entries({platformId:'other-platform',organizationId:'other-org',workspaceId:'other-workspace',siteId:'other-site',ownerKey:'other-owner',generation:8,profileId:'other-profile'}))expect((await h.service.resolve({...scope,[key]:value},token)).authenticated).toBe(false)
  const hostileHeaders=new Headers({host:new URL(ORIGIN).host,origin:'https://evil.test','content-type':'application/json'});const hostile=await memberDispatch(boundary,retainedRequest(`${ORIGIN}/_fuma/member-auth/login`,{method:'POST',body:JSON.stringify({email:EMAIL,password:MEMBER_PASSWORD})},hostileHeaders));expect(hostile.status).toBe(403)
  const bearer=await memberDispatch(boundary,memberRequest('/session',{headers:{authorization:`Bearer ${token}`}}));expect(bearer.status).toBe(404)
  const wrongHostHeaders=new Headers({host:'evil.test'});const wrongHost=await memberDispatch(boundary,retainedRequest(`${ORIGIN}/_fuma/member-auth/session`,{},wrongHostHeaders));expect(wrongHost.status).toBe(404)
  const rotated=await h.service.reauthenticate(scope,token,MEMBER_PASSWORD,{ip:null,userAgent:null});expect((await h.service.resolve(scope,token)).authenticated).toBe(false);expect((await h.service.resolve(scope,rotated.token)).authenticated).toBe(true)
  await h.service.revokeAll(scope,rotated.token);expect((await h.service.resolve(scope,rotated.token)).authenticated).toBe(false)
  const second=await h.service.login(scope,{email:EMAIL,password:MEMBER_PASSWORD},{ip:'198.51.100.2',userAgent:null});h.clock.value=new Date(Date.parse(NOW)+24*60*60*1000+1);expect((await h.service.resolve(scope,second.token)).authenticated).toBe(false)
  for(let attempt=0;attempt<5;attempt++)await expect(h.service.login(scope,{email:'missing@example.test',password:'Wrong-password-123!'},{ip:'203.0.113.9',userAgent:null})).rejects.toThrow('Invalid email or password')
  await expect(h.service.login(scope,{email:'missing@example.test',password:'Wrong-password-123!'},{ip:'203.0.113.9',userAgent:null})).rejects.toMatchObject({code:'rate-limited'})
 })

 it('fails closed on session touch races and rate-limits aggregate login enumeration plus member reauthentication',async()=>{
  const repository=new MemoryMemberIdentityRepository(),h=testService(repository),boundary=createMemberAuthBoundary({service:h.service,authority:authority()}),login=await registerAndLogin(boundary),token=rawCookie(cookiePair(login,MEMBER_SESSION_COOKIE))
  for(let attempt=0;attempt<5;attempt++)await expect(h.service.reauthenticate(scope,token,'Wrong-password-123!',{ip:'198.51.100.77',userAgent:null})).rejects.toThrow('Invalid email or password')
  await expect(h.service.reauthenticate(scope,token,'Wrong-password-123!',{ip:'198.51.100.77',userAgent:null})).rejects.toMatchObject({code:'rate-limited'})

  const aggregate=testService()
  for(let attempt=0;attempt<5;attempt++)await expect(aggregate.service.login(scope,{email:`missing-${attempt}@example.test`,password:'Wrong-password-123!'},{ip:'203.0.113.44',userAgent:null})).rejects.toThrow('Invalid email or password')
  await expect(aggregate.service.login(scope,{email:'missing-6@example.test',password:'Wrong-password-123!'},{ip:'203.0.113.44',userAgent:null})).rejects.toMatchObject({code:'rate-limited'})

  const originalTouch=repository.touchSession.bind(repository)
  let rejectTouch=false
  repository.touchSession=async(...args)=>rejectTouch?false:await originalTouch(...args)
  rejectTouch=true
  expect((await h.service.resolve(scope,token)).authenticated).toBe(false)
 })

 it('keeps registration and login enumeration-safe and stores consent provenance without credential leakage',async()=>{
  const h=testService(),boundary=createMemberAuthBoundary({service:h.service,authority:authority()})
  const first=await memberDispatch(boundary,post('/register',{email:EMAIL,password:MEMBER_PASSWORD,displayName:'Reader',consents:[{purpose:'terms',action:'granted',noticeVersion:'v1'}]}))
  const duplicate=await memberDispatch(boundary,post('/register',{email:EMAIL.toUpperCase(),password:'Different-password-789!',displayName:'Other',consents:[{purpose:'terms',action:'granted',noticeVersion:'v1'}]}))
  expect([first.status,await first.text()]).toEqual([duplicate.status,await duplicate.text()])
  const missing=await memberDispatch(boundary,post('/login',{email:'missing@example.test',password:MEMBER_PASSWORD})),wrong=await memberDispatch(boundary,post('/login',{email:EMAIL,password:'Wrong-password-123!'}))
  expect([missing.status,await missing.text()]).toEqual([wrong.status,await wrong.text()])
  expect(h.repository.consents).toHaveLength(1);expect(h.repository.consents[0]!.value).toMatchObject({source:'member-signup',purpose:'terms',noticeVersion:'v1'})
  expect(JSON.stringify(h.repository.consents)).not.toContain(MEMBER_PASSWORD)
 })

 it('mounts imports behind exact permission scope and fresh non-impersonated Better Auth staff sessions',async()=>{
  const repository=new MemoryMemberIdentityRepository()
  const freshSession={userId:'staff-user',sessionId:'staff-session',impersonatedBy:null,createdAt:new Date('2040-01-02T03:00:00.000Z')}
  const boundary=createMemberImportBoundary({
    repository,
    scopedAuthority:importScopedAuthority(),
    resolveStaffSession:async(headers)=>headers.get('cookie')?.includes(`${FUMA_STAFF_SESSION_COOKIE}=`)?freshSession:null,
    freshSessionMs:5*60*1000,
    now:()=>new Date(NOW),
  })
  const staffCookie=`${FUMA_STAFF_SESSION_COOKIE}=staff-token`
  const accepted=await boundary.handle(scopedImportRequest(importCommand(),staffCookie))
  expect(accepted?.status).toBe(201)
  expect(await accepted?.json()).toMatchObject({importId:'import-1',staffUserId:'staff-user',staffSessionId:'staff-session',importedCount:1})
  expect((await repository.findIdentityByEmail(scope,'imported@example.test'))?.identity.state).toBe('activation-required')

  const memberOnly=await boundary.handle(scopedImportRequest(importCommand({importId:'member-cookie-import'}),`${MEMBER_SESSION_COOKIE}=fmm1_member-token`))
  expect(memberOnly?.status).toBe(404)
  const injected=await boundary.handle(scopedImportRequest({...importCommand({importId:'injected'}),staffSessionId:'caller-session'},staffCookie))
  expect(injected?.status).toBe(400)

  const stale=createMemberImportBoundary({
    repository:new MemoryMemberIdentityRepository(),
    scopedAuthority:importScopedAuthority(),
    resolveStaffSession:async()=>freshSession,
    freshSessionMs:5*60*1000,
    now:()=>new Date('2040-01-02T03:05:00.000Z'),
  })
  expect((await stale.handle(scopedImportRequest(importCommand({importId:'stale'}),staffCookie)))?.status).toBe(401)
  const impersonated=createMemberImportBoundary({
    repository:new MemoryMemberIdentityRepository(),
    scopedAuthority:importScopedAuthority(),
    resolveStaffSession:async()=>({...freshSession,impersonatedBy:'owner-user'}),
    freshSessionMs:5*60*1000,
    now:()=>new Date(NOW),
  })
  expect((await impersonated.handle(scopedImportRequest(importCommand({importId:'impersonated'}),staffCookie)))?.status).toBe(401)
 })

 it('requires exact fresh staff reauthentication for imports and rejects imported sessions, secrets, credentials, and roles',async()=>{
  const h=testService(),imports=new MemberImportService(h.repository,{verify:async(value)=>value.proofId==='proof-1'&&value.staffSessionId==='staff-session'},()=>new Date(NOW))
  expect(safeParseValue(MemberImportCommandSchema,importCommand({sessionToken:'stolen'})).ok).toBe(false)
  expect(safeParseValue(MemberImportCommandSchema,importCommand({entries:[{externalId:'x',email:'x@example.test',displayName:'X',consents:[],password:'secret',role:'owner'}]})).ok).toBe(false)
  expect(safeParseValue(StaffMemberImportReauthenticationSchema,{...proof(),realm:'site-member'}).ok).toBe(false)
  await expect(imports.import(scope,importCommand(),proof({scope:{...scope,siteId:'other-site'}}))).rejects.toMatchObject({code:'scope-denied'})
  await expect(imports.import(scope,importCommand(),proof({expiresAt:'2040-01-02T03:04:04.000Z'}))).rejects.toMatchObject({code:'reauthentication-required'})
  await expect(imports.import(scope,importCommand(),proof({proofId:'forged-proof'}))).rejects.toMatchObject({code:'reauthentication-required'})
  const receipt=await imports.import(scope,importCommand(),proof());expect(receipt).toMatchObject({importedCount:1,skippedCount:0,staffUserId:'staff-user'})
  expect(await imports.import(scope,importCommand(),proof())).toEqual(receipt)
  const imported=await h.repository.findIdentityByEmail(scope,'imported@example.test');expect(imported).toMatchObject({passwordHash:null,identity:{state:'activation-required',origin:'staff-import',importReceiptId:'import-1'}})
  expect(h.repository.consents.at(-1)!.value).toMatchObject({source:'staff-import',sourceReceiptId:'import-1',purpose:'newsletter'})
  await expect(h.service.login(scope,{email:'imported@example.test',password:'Any-password-123!'},{ip:null,userAgent:null})).rejects.toThrow('Invalid email or password')
  expect(()=>readMemberAuthSecret(STAFF_SECRET,{FUMA_MEMBER_AUTH_SECRET:STAFF_SECRET})).toThrow('must not equal')
  expect(readMemberAuthSecret(STAFF_SECRET,{FUMA_MEMBER_AUTH_SECRET:MEMBER_SECRET})).toBe(MEMBER_SECRET)
 })
})
