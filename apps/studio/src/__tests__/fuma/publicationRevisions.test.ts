import { describe, expect, test } from 'bun:test'
import type { PublicationRevisionList, PublicationRevisionRecord } from '@core/fuma/publication'
import { FakeObjectStorageTransport, FumaObjectStorage } from '../../../server/fuma/objectStorage'
import {
  PublicationRevisionService,
  PublicationRevisionSnapshotStore,
  canonicalRevisionDocument,
  type PublicationRevisionRepository,
  type RevisionSnapshot,
} from '../../../server/fuma/publication/revisions'
import { samePublicationScope, type PublicationRepositoryScope } from '../../../server/fuma/publication/scope'
import { PUBLICATION_TEST_SCOPE } from '../helpers/fuma/publicationFixtures'

type SnapshotState=RevisionSnapshot&{state:'available'|'deleting'}

class MemoryRevisionRepository implements PublicationRevisionRepository {
  readonly scope:PublicationRepositoryScope
  readonly records:PublicationRevisionRecord[]=[]
  readonly snapshots=new Map<string,SnapshotState>()
  readonly refs=new Map<string,{snapshotId:string;protected:boolean;retainedUntil:string|null}>()
  readonly audit:string[]=[]
  head={sequence:0,document:{title:'Launch',sections:[{id:'hero',text:'Keep'},{id:'pricing',text:'Delete me'}]},headRevisionId:null as string|null}
  constructor(scope:PublicationRepositoryScope){this.scope=scope}
  #same(scope:PublicationRepositoryScope){return samePublicationScope(scope,this.scope)}
  edit(document:unknown){this.head={...this.head,sequence:this.head.sequence+1,document:structuredClone(document)}}
  async currentHead(scope:PublicationRepositoryScope){if(!this.#same(scope))throw new Error('scope denied');return structuredClone(this.head)}
  async ensureSnapshot(scope:PublicationRepositoryScope,snapshot:RevisionSnapshot){if(!this.#same(scope))throw new Error('scope denied');const prior=this.snapshots.get(snapshot.snapshotId);if(prior&&JSON.stringify(prior)!==JSON.stringify({...snapshot,state:'available'}))throw new Error('snapshot conflict');this.snapshots.set(snapshot.snapshotId,{...snapshot,state:'available'})}
  async capture(scope:PublicationRepositoryScope,revision:PublicationRevisionRecord,expected:string|null){if(!this.#same(scope)||this.head.sequence!==revision.sequence||this.head.headRevisionId!==expected||this.records.some(item=>item.revisionId===revision.revisionId)||this.snapshots.get(revision.snapshotId)?.state!=='available')return false;this.records.push(structuredClone(revision));this.refs.set(revision.revisionId,{snapshotId:revision.snapshotId,protected:revision.retainedUntil===null,retainedUntil:revision.retainedUntil});this.head.headRevisionId=revision.revisionId;this.audit.push(`revision-created:${revision.revisionId}`);return true}
  async list(scope:PublicationRepositoryScope,resourceKind:string,resourceId:string):Promise<PublicationRevisionList>{if(!this.#same(scope))return{revisions:[],headRevisionId:null,currentSequence:0};return{revisions:this.records.filter(item=>item.resourceKind===resourceKind&&item.resourceId===resourceId).map(item=>({...structuredClone(item),snapshotAvailable:this.refs.has(item.revisionId)&&this.snapshots.get(item.snapshotId)?.state==='available'})).toReversed(),headRevisionId:this.head.headRevisionId,currentSequence:this.head.sequence}}
  async getAvailable(scope:PublicationRepositoryScope,resourceKind:string,resourceId:string,revisionId:string){if(!this.#same(scope))return null;const record=this.records.find(item=>item.resourceKind===resourceKind&&item.resourceId===resourceId&&item.revisionId===revisionId);return record&&this.refs.has(revisionId)&&this.snapshots.get(record.snapshotId)?.state==='available'?structuredClone(record):null}
  async restore(scope:PublicationRepositoryScope,source:PublicationRevisionRecord,restored:PublicationRevisionRecord,expected:string,document:unknown){if(!this.#same(scope)||this.head.headRevisionId!==expected||restored.sequence!==this.head.sequence+1||!this.refs.has(source.revisionId)||this.records.some(item=>item.revisionId===restored.revisionId))return false;this.head={sequence:restored.sequence,document:structuredClone(document),headRevisionId:restored.revisionId};this.records.push(structuredClone(restored));this.refs.set(restored.revisionId,{snapshotId:restored.snapshotId,protected:true,retainedUntil:null});this.audit.push(`revision-restored:${restored.revisionId}`);return true}
  async expireReferences(scope:PublicationRepositoryScope,before:string,_actorId:string,_eventIds:readonly string[],limit:number){if(!this.#same(scope))return 0;let count=0;for(const record of this.records){const ref=this.refs.get(record.revisionId);if(count>=limit)break;if(ref&&!ref.protected&&ref.retainedUntil!==null&&ref.retainedUntil<before&&record.revisionId!==this.head.headRevisionId){this.refs.delete(record.revisionId);this.audit.push(`snapshot-reference-expired:${record.revisionId}`);count+=1}}return count}
  async claimUnreferencedSnapshots(scope:PublicationRepositoryScope,before:string,limit:number){if(!this.#same(scope))return[];const referenced=new Set([...this.refs.values()].map(ref=>ref.snapshotId));const claimed:SnapshotState[]=[];for(const snapshot of this.snapshots.values()){if(claimed.length>=limit)break;if(snapshot.state==='available'&&snapshot.createdAt<before&&!referenced.has(snapshot.snapshotId)){snapshot.state='deleting';claimed.push(structuredClone(snapshot))}}return claimed}
  async completeSnapshotCollection(scope:PublicationRepositoryScope,snapshotId:string,_actorId:string,_eventId:string,_createdAt:string){if(!this.#same(scope)||[...this.refs.values()].some(ref=>ref.snapshotId===snapshotId)||this.snapshots.get(snapshotId)?.state!=='deleting')return false;this.snapshots.delete(snapshotId);this.audit.push(`snapshot-collected:${snapshotId}`);return true}
  async releaseSnapshotClaim(scope:PublicationRepositoryScope,snapshotId:string){if(this.#same(scope)){const snapshot=this.snapshots.get(snapshotId);if(snapshot?.state==='deleting')snapshot.state='available'}}
}

function harness(){
  let nowMs=Date.parse('2040-01-01T00:00:00.000Z');let id=0
  const transport=new FakeObjectStorageTransport(()=>nowMs)
  const storage=new FumaObjectStorage({transport,policy:{allowedMimeTypes:['application/json'],maxObjectBytes:1024*1024,maxTenantBytes:10*1024*1024},signingSecret:'revision-test-signing-secret-000000000000',accessUrlBase:'https://objects.example.test',nowMs:()=>nowMs})
  const repository=new MemoryRevisionRepository(PUBLICATION_TEST_SCOPE)
  const snapshots=new PublicationRevisionSnapshotStore(storage)
  const ids={id:(kind:string)=>`${kind}-${++id}`,sha256:(value:string)=>new Bun.CryptoHasher('sha256').update(value).digest('hex')}
  const service=new PublicationRevisionService({repository,snapshots,ids,now:()=>new Date(nowMs)})
  return{repository,snapshots,service,transport,advance:(milliseconds:number)=>{nowMs+=milliseconds},now:()=>new Date(nowMs).toISOString()}
}

async function checkpoint(h:ReturnType<typeof harness>,revisionId:string,name:string){return h.service.create(PUBLICATION_TEST_SCOPE,'actor-editor',{revisionId,resourceKind:'post',resourceId:'post-1',expectedSequence:h.repository.head.sequence,expectedHeadRevisionId:h.repository.head.headRevisionId,reason:'manual-checkpoint',checkpointName:name,document:h.repository.head.document,retentionDays:30})}

describe('FUMA-031 immutable revisions, checkpoints, restore, and GC',()=>{
  test('demo: checkpoint → destructive shared edit → compare → restore creates a new head without rewriting history',async()=>{
    const h=harness();const first=await checkpoint(h,'revision-checkpoint','Before redesign')
    expect(h.transport.physicalKeys()).toContain(`organizations/organization/workspaces/workspace/sites/site/objects/publication-revisions/g1/publication/${first.snapshotId}.json`)
    const checkpointDocument=structuredClone(h.repository.head.document)
    h.repository.edit({title:'Destroyed',sections:[{id:'hero',text:'Changed'}],newSetting:true})
    const destructive=await h.service.capturePeriodicCurrent(PUBLICATION_TEST_SCOPE,'actor-job',{revisionId:'revision-destructive',resourceKind:'post',resourceId:'post-1',retentionDays:7})
    const comparison=await h.service.compare(PUBLICATION_TEST_SCOPE,'post','post-1',first.revisionId,destructive.revisionId)
    expect(comparison.entries.map(entry=>[entry.path,entry.kind])).toEqual([['/newSetting','added'],['/sections/0/text','changed'],['/sections/1','removed'],['/title','changed']])
    await expect(h.service.restore(PUBLICATION_TEST_SCOPE,'post','post-1','actor-editor',{sourceRevisionId:first.revisionId,expectedHeadRevisionId:'stale-head',restoreRevisionId:'revision-conflict'})).rejects.toMatchObject({code:'revision-conflict'})
    const restored=await h.service.restore(PUBLICATION_TEST_SCOPE,'post','post-1','actor-editor',{sourceRevisionId:first.revisionId,expectedHeadRevisionId:destructive.revisionId,restoreRevisionId:'revision-restored'})
    expect(h.repository.head.document).toEqual(checkpointDocument)
    expect(restored).toMatchObject({revisionId:'revision-restored',parentRevisionId:'revision-destructive',reason:'restore',sequence:2,snapshotId:first.snapshotId})
    expect(h.repository.records.map(item=>item.revisionId)).toEqual(['revision-checkpoint','revision-destructive','revision-restored'])
    expect(h.repository.records[0]).toEqual(first)
    expect(h.repository.audit).toEqual(['revision-created:revision-checkpoint','revision-created:revision-destructive','revision-restored:revision-restored'])
    process.stdout.write(`[FUMA-031 demo] ${JSON.stringify({checkpoint:first.revisionId,destructiveHead:destructive.revisionId,diff:comparison.entries.map(entry=>`${entry.kind}:${entry.path}`),restoredHead:restored.revisionId,parent:restored.parentRevisionId,history:h.repository.records.map(item=>item.revisionId),document:h.repository.head.document})}\n`)
  })

  test('preserves exact scope and rejects unavailable/foreign revision restore',async()=>{
    const h=harness();const first=await checkpoint(h,'revision-scope','Scoped checkpoint')
    const foreign={...PUBLICATION_TEST_SCOPE,siteId:'foreign-site',ownerKey:'foreign-owner'}
    await expect(h.service.restore(foreign,'post','post-1','actor-foreign',{sourceRevisionId:first.revisionId,expectedHeadRevisionId:first.revisionId,restoreRevisionId:'foreign-restore'})).rejects.toMatchObject({code:'not-found'})
    expect(h.repository.records).toHaveLength(1);expect(h.repository.head.headRevisionId).toBe(first.revisionId)
  })

  test('expires only non-head periodic references and GC collects only snapshots with no references',async()=>{
    const h=harness();const periodic=await h.service.capturePeriodicCurrent(PUBLICATION_TEST_SCOPE,'actor-job',{revisionId:'revision-periodic',resourceKind:'post',resourceId:'post-1',retentionDays:1})
    h.repository.edit({title:'Protected',sections:[]});const retained=await checkpoint(h,'revision-retained','Protected checkpoint')
    const orphanDocument={orphan:true};const orphanCanonical=canonicalRevisionDocument(orphanDocument);const orphanChecksum=new Bun.CryptoHasher('sha256').update(orphanCanonical).digest('hex');const orphan=await h.snapshots.put(PUBLICATION_TEST_SCOPE,orphanCanonical,orphanChecksum,h.now());await h.repository.ensureSnapshot(PUBLICATION_TEST_SCOPE,orphan)
    h.advance(2*86_400_000)
    expect(await h.service.expireRetention(PUBLICATION_TEST_SCOPE,'actor-retention')).toBe(1)
    expect((await h.service.list(PUBLICATION_TEST_SCOPE,'post','post-1')).revisions.find(item=>item.revisionId===periodic.revisionId)?.snapshotAvailable).toBe(false)
    expect(await h.service.collectGarbage(PUBLICATION_TEST_SCOPE,'actor-gc',60_000)).toBe(2)
    expect(h.repository.snapshots.has(periodic.snapshotId)).toBe(false);expect(h.repository.snapshots.has(orphan.snapshotId)).toBe(false)
    expect(h.repository.snapshots.has(retained.snapshotId)).toBe(true);expect(h.repository.refs.has(retained.revisionId)).toBe(true)
    expect(h.repository.records.map(item=>item.revisionId)).toEqual(['revision-periodic','revision-retained'])
  })
})
