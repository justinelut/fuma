import { describe, expect, test } from 'bun:test'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  PublicationPreviewIssueCommandSchema,
  PublicationPublicResolveRequestSchema,
  PublicationScheduleCommandSchema,
  type PublicationContent,
  type PublicationPreviewTokenRecord,
  type PublicationScheduleRecord,
} from '@core/fuma/publication'
import { PublicationMemberAccessService } from '../../../server/fuma/publication/memberAccess'
import { PublicationEditorialService } from '../../../server/fuma/publication/services'
import {
  PublicationSchedulingService,
  formatPublicationSchedule,
  type PublicationScheduleClaim,
  type PublicationSchedulingRepository,
} from '../../../server/fuma/publication/schedulingAccess'
import type { PublicationRepositoryScope } from '../../../server/fuma/publication/scope'
import { publicationFixture } from '../helpers/fuma/publicationFixtures'

const START = '2040-01-02T03:00:00.000Z'
const DUE = '2040-01-02T04:00:00.000Z'
const LATE = '2040-01-02T07:00:00.000Z'
const EARLIER = '2040-01-01T00:00:00.000Z'
function scopeKey(scope:PublicationRepositoryScope,id:string){return [scope.platformId,scope.organizationId,scope.workspaceId,scope.siteId,scope.ownerKey,scope.generation,scope.profileId,id].join('\0')}

class MemorySchedulingRepository implements PublicationSchedulingRepository {
  readonly schedules=new Map<string,PublicationScheduleRecord>()
  readonly tokens=new Map<string,PublicationPreviewTokenRecord>()
  putSchedule(scope:PublicationRepositoryScope,value:PublicationScheduleRecord){const key=scopeKey(scope,value.scheduleId),active=[...this.schedules].some(([id,item])=>id.startsWith(scopeKey(scope,''))&&item.contentId===value.contentId&&item.action===value.action&&['pending','claimed'].includes(item.state));if(this.schedules.has(key)||active)return Promise.resolve(false);this.schedules.set(key,structuredClone(value));return Promise.resolve(true)}
  listRecoverable(scope:PublicationRepositoryScope,dueAt:string,limit:number){return Promise.resolve([...this.schedules].filter(([id,item])=>id.startsWith(scopeKey(scope,''))&&((item.state==='pending'&&item.dueAt<=dueAt)||(item.state==='claimed'&&item.claimExpiresAt!==null&&item.claimExpiresAt<=dueAt))).map(([,item])=>structuredClone(item)).sort((a,b)=>a.dueAt.localeCompare(b.dueAt)||a.scheduleId.localeCompare(b.scheduleId)).slice(0,limit))}
  claimDue(scope:PublicationRepositoryScope,id:string,worker:string,now:string,lease:string):Promise<PublicationScheduleClaim|null>{const key=scopeKey(scope,id),current=this.schedules.get(key);if(!current||current.dueAt>now||!(current.state==='pending'||(current.state==='claimed'&&current.claimExpiresAt!==null&&current.claimExpiresAt<=now)))return Promise.resolve(null);const record={...current,state:'claimed' as const,claimedBy:worker,claimExpiresAt:lease,claimFence:current.claimFence+1};this.schedules.set(key,record);return Promise.resolve({record:structuredClone(record),fence:record.claimFence})}
  finishClaim(scope:PublicationRepositoryScope,id:string,worker:string,fence:number,state:'completed'|'superseded',at:string){const key=scopeKey(scope,id),current=this.schedules.get(key);if(!current||current.state!=='claimed'||current.claimedBy!==worker||current.claimFence!==fence)return Promise.resolve(false);this.schedules.set(key,{...current,state,claimedBy:null,claimExpiresAt:null,completedAt:at});return Promise.resolve(true)}
  putPreviewToken(scope:PublicationRepositoryScope,value:PublicationPreviewTokenRecord){const key=scopeKey(scope,value.tokenId);if(this.tokens.has(key))return Promise.resolve(false);this.tokens.set(key,structuredClone(value));return Promise.resolve(true)}
  usePreviewToken(scope:PublicationRepositoryScope,id:string,digest:string,at:string){const key=scopeKey(scope,id),current=this.tokens.get(key);if(!current||current.tokenDigestSha256!==digest||current.revokedAt!==null||current.expiresAt<=at)return Promise.resolve(null);const used={...current,lastUsedAt:at,useCount:current.useCount+1};this.tokens.set(key,used);return Promise.resolve(structuredClone(used))}
  revokePreviewToken(scope:PublicationRepositoryScope,id:string,at:string){const key=scopeKey(scope,id),current=this.tokens.get(key);if(!current||current.revokedAt!==null||current.expiresAt<=at)return Promise.resolve(false);this.tokens.set(key,{...current,revokedAt:at});return Promise.resolve(true)}
}
class CapturingJobs {
  readonly calls:unknown[]=[];readonly keys=new Set<string>()
  enqueue(input:{idempotencyKey:string}){this.calls.push(structuredClone(input));const created=!this.keys.has(input.idempotencyKey);this.keys.add(input.idempotencyKey);return Promise.resolve({created})}
}
function content(input:Partial<PublicationContent>&Pick<PublicationContent,'contentId'>):PublicationContent{return {contentId:input.contentId,kind:'post',metadata:{title:`Secret ${input.contentId}`,slug:input.contentId,excerpt:'Private launch detail',canonicalUrl:null,redirects:[],openGraph:{title:null,description:null,imageId:null,type:'article'},social:{title:null,description:null,imageId:null,card:'summary'},visibility:{kind:'public'},featureImageId:null,seoTitle:null,seoDescription:null,tagIds:[],primaryTagId:null,authorIds:['author-1']},document:{type:'doc'},status:'published',workflowVersion:1,scheduledAt:null,publishedAt:EARLIER,createdAt:EARLIER,updatedAt:START,...input}}
function harness(){
  const base=publicationFixture(),repository=new MemorySchedulingRepository(),jobs=new CapturingJobs();let now=Date.parse(START)
  const editorial=new PublicationEditorialService(base.store)
  const members=new PublicationMemberAccessService({repository:base.store,domain:base.store,ids:base.ids,now:()=>new Date(now)})
  const service=new PublicationSchedulingService({repository,domain:base.store,editorial,members,jobs,now:()=>new Date(now),leaseMs:1000})
  return{...base,repository,jobs,editorial,members,service,setNow:(value:string)=>{now=Date.parse(value)}}
}
async function seedMember(h:ReturnType<typeof harness>){await h.store.putMember(h.scope,{memberId:'member-1',email:'member@example.test',name:'Member',status:'active',accountId:null,attributes:{edition:'daily'},createdAt:EARLIER,updatedAt:START});await h.members.saveAccount(h.scope,{accountId:'account-1',memberIdentityId:'identity-1',memberId:'member-1',displayName:'Member',locale:'en-KE',timezone:'Africa/Nairobi',state:'active',createdAt:EARLIER,updatedAt:START,deletedAt:null},null)}
const ORIGIN='https://publication.example.test'
function request(contentId:string,previewToken:string|null=null){return{contentId,previewToken,requestedPath:`/${contentId}`}}
function resolve(h:ReturnType<typeof harness>,contentId:string,memberIdentityId:string|null=null,previewToken:string|null=null){return h.service.resolve(h.scope,request(contentId,previewToken),memberIdentityId,ORIGIN)}

describe('FUMA-036 scheduling and public access',()=>{
  test('keeps schedule, preview, and public boundaries strict and authority-free',()=>{
    expect(safeParseValue(PublicationScheduleCommandSchema,{scheduleId:'s',contentId:'c',action:'publish',expectedWorkflowVersion:1,dueAt:DUE,displayTimezone:'Africa/Nairobi',ownerKey:'forged'}).ok).toBe(false)
    expect(safeParseValue(PublicationPreviewIssueCommandSchema,{tokenId:'t',contentId:'c',expiresAt:DUE,token:'chosen'}).ok).toBe(false)
    expect(safeParseValue(PublicationPublicResolveRequestSchema,{...request('c'),evaluatedAt:EARLIER}).ok).toBe(false)
  })

  test('formats absolute instants across DST fallback and non-DST timezones without ambiguity',()=>{
    const first=formatPublicationSchedule('2024-11-03T05:30:00.000Z','America/New_York')
    const second=formatPublicationSchedule('2024-11-03T06:30:00.000Z','America/New_York')
    expect(first).not.toBe(second);expect(first).toContain('GMT-4');expect(second).toContain('GMT-5')
    expect(formatPublicationSchedule('2024-11-03T05:30:00.000Z','Africa/Nairobi')).toContain('GMT+3')
    expect(()=>formatPublicationSchedule(DUE,'Not/A_Timezone')).toThrow('timezone')
  })

  test('recovers a missed publish after restart and duplicate schedulers apply it exactly once',async()=>{
    const h=harness();await h.store.putContent(h.scope,content({contentId:'scheduled-post',status:'scheduled',publishedAt:null,scheduledAt:DUE}),null)
    await h.service.schedule(h.scope,{scheduleId:'publish-1',contentId:'scheduled-post',action:'publish',expectedWorkflowVersion:1,dueAt:DUE,displayTimezone:'Africa/Nairobi'})
    h.setNow(LATE);expect(await h.service.recover(h.scope)).toBe(1);expect(h.jobs.calls).toHaveLength(2);expect(h.jobs.keys.size).toBe(1)
    const [left,right]=await Promise.all([h.service.runDue(h.scope,'publish-1','scheduler-a'),h.service.runDue(h.scope,'publish-1','scheduler-b')])
    expect([left.applied,right.applied].filter(Boolean)).toHaveLength(1)
    expect(await h.store.getContent(h.scope,'scheduled-post')).toMatchObject({status:'published',workflowVersion:2,publishedAt:LATE})
    expect(h.store.transitions.filter(item=>item.contentId==='scheduled-post')).toHaveLength(1)
  })

  test('runs scheduled unpublish late, once, and supersedes stale versions',async()=>{
    const h=harness();await h.store.putContent(h.scope,content({contentId:'live-post'}),null)
    await h.service.schedule(h.scope,{scheduleId:'unpublish-1',contentId:'live-post',action:'unpublish',expectedWorkflowVersion:1,dueAt:DUE,displayTimezone:'Africa/Nairobi'})
    h.setNow(LATE);expect(await h.service.runDue(h.scope,'unpublish-1','late-worker')).toEqual({scheduleId:'unpublish-1',applied:true,state:'completed'})
    expect(await h.store.getContent(h.scope,'live-post')).toMatchObject({status:'unpublished',workflowVersion:2})
    expect(await h.service.runDue(h.scope,'unpublish-1','duplicate-worker')).toEqual({scheduleId:'unpublish-1',applied:false,state:'completed'})
    await h.store.putContent(h.scope,content({contentId:'stale-post'}),null);await h.service.schedule(h.scope,{scheduleId:'stale-1',contentId:'stale-post',action:'unpublish',expectedWorkflowVersion:1,dueAt:'2040-01-02T08:00:00.000Z',displayTimezone:'Africa/Nairobi'});await h.editorial.transition(h.scope,{transitionId:'manual',contentId:'stale-post',from:'published',to:'unpublished',actorId:'staff',expectedVersion:1,scheduledAt:null,note:'manual',createdAt:'2040-01-02T07:30:00.000Z'});await h.editorial.transition(h.scope,{transitionId:'manual-republish',contentId:'stale-post',from:'unpublished',to:'published',actorId:'staff',expectedVersion:2,scheduledAt:null,note:'manual',createdAt:'2040-01-02T07:45:00.000Z'});h.setNow('2040-01-02T09:00:00.000Z');expect(await h.service.runDue(h.scope,'stale-1','worker')).toMatchObject({applied:false,state:'superseded'})
  })

  test('stores only preview digests and enforces issue, use, revocation, expiry, content, and exact scope',async()=>{
    const h=harness();await h.store.putContent(h.scope,content({contentId:'draft-post',status:'draft',publishedAt:null}),null)
    const issued=await h.service.issuePreview(h.scope,{tokenId:'preview-1',contentId:'draft-post',expiresAt:DUE})
    const stored=h.repository.tokens.get(scopeKey(h.scope,'preview-1'))!;expect(stored.tokenDigestSha256).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(stored)).not.toContain(issued.token)
    expect(await resolve(h,'draft-post',null,issued.token)).toMatchObject({audience:'preview',presentation:{delivery:'render',preview:true,robots:'noindex,nofollow'}})
    expect(stored.useCount).toBe(0);expect(h.repository.tokens.get(scopeKey(h.scope,'preview-1'))?.useCount).toBe(1)
    const foreign={...h.scope,siteId:'other-site',ownerKey:'other-owner'};await expect(h.service.resolve(foreign,request('draft-post',issued.token),null,ORIGIN)).rejects.toMatchObject({code:'preview-expired'})
    expect(await h.service.revokePreview(h.scope,'preview-1')).toBe(true);await expect(resolve(h,'draft-post',null,issued.token)).rejects.toMatchObject({code:'preview-expired'})
    const expiring=await h.service.issuePreview(h.scope,{tokenId:'preview-2',contentId:'draft-post',expiresAt:'2040-01-02T03:10:00.000Z'});h.setNow('2040-01-02T03:11:00.000Z');await expect(resolve(h,'draft-post',null,expiring.token)).rejects.toMatchObject({code:'preview-expired'})
  })

  test('delegates public/member/segment enforcement to FUMA-039 and never leaks private metadata',async()=>{
    const h=harness();await seedMember(h);await h.store.putContent(h.scope,content({contentId:'segment-post',metadata:{...content({contentId:'x'}).metadata,slug:'segment-post',title:'Embargoed merger',excerpt:'Do not leak',visibility:{kind:'segment',segmentIds:['daily']}}}),null)
    const anonymous=await resolve(h,'segment-post');expect(anonymous.presentation).toMatchObject({delivery:'deny',title:'Restricted content',html:null});expect(JSON.stringify(anonymous)).not.toContain('Embargoed merger');expect(JSON.stringify(anonymous)).not.toContain('Do not leak')
    const before=await resolve(h,'segment-post','identity-1');expect(before.presentation.delivery).toBe('deny')
    await h.members.saveSegment(h.scope,{segmentId:'daily',name:'Daily',kind:'dynamic',match:'all',rules:[{field:'edition',operator:'equals',value:'daily'}],explicitMemberIds:[],version:1,recalculatedAt:null,createdAt:EARLIER,updatedAt:START},null);await h.members.recalculateSegment(h.scope,'daily',START)
    expect(await resolve(h,'segment-post','identity-1')).toMatchObject({audience:'segment',presentation:{delivery:'render',access:'allowed',reason:'published'}})
  })

  test('deterministically serves one public, member, and segment audience without cross-audience reuse',async()=>{
    const h=harness();await seedMember(h);await h.store.putContent(h.scope,content({contentId:'public-post'}),null);await h.store.putContent(h.scope,content({contentId:'member-post',metadata:{...content({contentId:'x'}).metadata,slug:'member-post',visibility:{kind:'member'}}}),null);await h.store.putContent(h.scope,content({contentId:'segment-demo',metadata:{...content({contentId:'x'}).metadata,slug:'segment-demo',visibility:{kind:'segment',segmentIds:['daily']}}}),null)
    await h.members.saveSegment(h.scope,{segmentId:'daily',name:'Daily',kind:'explicit',match:'all',rules:[],explicitMemberIds:['member-1'],version:1,recalculatedAt:null,createdAt:EARLIER,updatedAt:START},null);await h.members.recalculateSegment(h.scope,'daily',START)
    const transcript=[] as string[];for(const [id,identity] of [['public-post',null],['member-post','identity-1'],['segment-demo','identity-1']] as const){const result=await resolve(h,id,identity);transcript.push(`${id}:${result.audience}:${result.presentation.delivery}`)}
    expect(transcript).toEqual(['public-post:anonymous:render','member-post:member:render','segment-demo:segment:render'])
  })
})
