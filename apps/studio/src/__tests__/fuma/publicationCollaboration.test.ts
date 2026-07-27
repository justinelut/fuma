import { describe, expect, test } from 'bun:test'
import { applyCollaborationOperationBatch, type CollaborationOperationInput } from '@core/fuma/publication'
import { PublicationCollaborationError, PublicationCollaborationService, applyCollaborationOperations } from '../../../server/fuma/publication/collaboration'
import { InMemoryPublicationCollaborationStore, PUBLICATION_TEST_SCOPE, TEST_NOW } from '../helpers/fuma/publicationFixtures'

const input = (operationId:string, baseSequence:number, operation:Omit<CollaborationOperationInput,'operationId'|'baseSequence'>):CollaborationOperationInput => ({ operationId, baseSequence, ...operation })
const command = (mutationId:string, expectedSequence:number, operations:readonly CollaborationOperationInput[]) => ({ mutationId, resourceKind:'post' as const, resourceId:'post-1', expectedSequence, operations })

function seeded(){const store=new InMemoryPublicationCollaborationStore();store.seed('post','post-1',{title:'Before',nodes:[{id:'seed',name:'Seed',style:{color:'black'}}]});return{store,service:new PublicationCollaborationService(store,()=>new Date(TEST_NOW))}}

describe('FUMA-030 durable ordered collaboration',()=>{
  test('accepts one atomic batch, persists immutable order, and returns explicit stale rebase state',async()=>{
    const {store,service}=seeded()
    const operations=[input('op-set',0,{kind:'set',path:['title'],value:'After'}),input('op-add',0,{kind:'insert',path:['nodes',1],value:{id:'second',name:'Second',style:{color:'blue'}}})]
    const accepted=await service.reconcile(PUBLICATION_TEST_SCOPE,command('mutation-1',0,operations),{actorSessionId:'session-1'})
    expect(accepted).toMatchObject({outcome:'accepted',replayed:false,receipt:{mutationId:'mutation-1',sequence:1,operationIds:['op-set','op-add']}})
    expect(store.operations.map(({operation})=>[operation.acceptedSequence,operation.operationIndex])).toEqual([[1,0],[1,1]])
    const stale=await service.reconcile(PUBLICATION_TEST_SCOPE,command('mutation-stale',0,[input('op-stale',0,{kind:'set',path:['title'],value:'Stale'})]),{actorSessionId:'session-2'})
    expect(stale).toMatchObject({outcome:'rebase-required',mutationId:'mutation-stale',sequence:1,document:{title:'After'}})
    if(stale.outcome==='rebase-required')expect(stale.operationsSinceBase.map(operation=>operation.operationId)).toEqual(['op-set','op-add'])
  })

  test('replays an exact mutation without applying twice and rejects identity reuse with changed input or actor',async()=>{
    const {store,service}=seeded();const value=command('mutation-retry',0,[input('op-retry',0,{kind:'insert',path:['nodes',1],value:{id:'retry',name:'Retry',style:{color:'red'}}})])
    const first=await service.reconcile(PUBLICATION_TEST_SCOPE,value,{actorSessionId:'session-1'})
    const replay=await service.reconcile(PUBLICATION_TEST_SCOPE,value,{actorSessionId:'session-1'})
    expect(first.outcome).toBe('accepted');expect(replay).toMatchObject({outcome:'accepted',replayed:true});expect(store.operations).toHaveLength(1);expect(store.heads.values().next().value.sequence).toBe(1)
    await expect(service.reconcile(PUBLICATION_TEST_SCOPE,{...value,operations:[input('op-other',0,{kind:'set',path:['title'],value:'Changed'})]},{actorSessionId:'session-1'})).rejects.toMatchObject({code:'mutation-conflict'})
    await expect(service.reconcile(PUBLICATION_TEST_SCOPE,value,{actorSessionId:'session-2'})).rejects.toMatchObject({code:'mutation-conflict'})
  })

  test('rejects prototype paths/values and rolls the entire mixed batch back without tree corruption',async()=>{
    expect(()=>applyCollaborationOperations({safe:true},[input('unsafe',0,{kind:'set',path:['__proto__','polluted'],value:true})])).toThrow()
    expect(()=>applyCollaborationOperationBatch({safe:true},[{operationId:'unsupported',baseSequence:0,kind:'merge',path:['safe'],value:true} as never])).toThrow('strict contract')
    expect(()=>applyCollaborationOperationBatch({safe:true},[{...input('extra-authority',0,{kind:'set',path:['safe'],value:true}),actorSessionId:'caller-controlled'} as never])).toThrow('strict contract')
    const polluted=Object.create(null) as Record<string,unknown>;polluted.prototype={polluted:true}
    expect(()=>applyCollaborationOperationBatch({safe:true},[input('unsafe-value',0,{kind:'set',path:['safe'],value:polluted})])).toThrow('Prototype keys')
    const {store,service}=seeded();const before=structuredClone(store.heads.values().next().value)
    await expect(service.reconcile(PUBLICATION_TEST_SCOPE,command('mutation-bad',0,[input('valid-first',0,{kind:'set',path:['title'],value:'Never committed'}),input('bad',0,{kind:'remove',path:['nodes',99]})]),{actorSessionId:'session'})).rejects.toBeInstanceOf(PublicationCollaborationError)
    expect(store.heads.values().next().value).toEqual(before);expect(store.operations).toEqual([]);expect(store.mutations.size).toBe(0)
  })

  test('serializes concurrent writers into one acceptance and one visible rebase, then converges after retry',async()=>{
    const {service}=seeded()
    const add=command('mutation-add',0,[input('op-add',0,{kind:'insert',path:['nodes',1],value:{id:'added',name:'Added',style:{color:'green'}}})])
    const rename=command('mutation-rename',0,[input('op-rename',0,{kind:'set',path:['nodes',0,'name'],value:'Renamed'})])
    const [left,right]=await Promise.all([service.reconcile(PUBLICATION_TEST_SCOPE,add,{actorSessionId:'left'}),service.reconcile(PUBLICATION_TEST_SCOPE,rename,{actorSessionId:'right'})])
    expect([left.outcome,right.outcome].sort()).toEqual(['accepted','rebase-required'])
    const stale=left.outcome==='rebase-required'?left:right
    const staleCommand=left.outcome==='rebase-required'?add:rename
    if(stale.outcome!=='rebase-required')throw new Error('Expected one stale writer.')
    const rebased=staleCommand.operations.map(operation=>({...operation,baseSequence:stale.sequence}))
    const retry=await service.reconcile(PUBLICATION_TEST_SCOPE,command(`${staleCommand.mutationId}-retry`,stale.sequence,rebased),{actorSessionId:'retry'})
    expect(retry.outcome).toBe('accepted')
    const catchUp=await service.catchUp(PUBLICATION_TEST_SCOPE,'post','post-1',0)
    expect(catchUp.sequence).toBe(2);expect(catchUp.operationsSinceBase.map(operation=>operation.acceptedSequence)).toEqual([1,2])
    expect(catchUp.document).toEqual({title:'Before',nodes:[{id:'seed',name:'Renamed',style:{color:'black'}},{id:'added',name:'Added',style:{color:'green'}}]})
  })

  test('randomized valid add/move/rename/style batches replay to the authoritative final tree in accepted order',async()=>{
    const {service}=seeded();let sequence=0;let expected:unknown={title:'Before',nodes:[{id:'seed',name:'Seed',style:{color:'black'}}]};let state=0x5eed1234
    const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state}
    const acceptedLog:CollaborationOperationInput[][]=[]
    for(let index=0;index<80;index+=1){
      const nodes=(expected as {nodes:Array<{id:string}>}).nodes;const choice=index<4?index:random()%4;let operation:CollaborationOperationInput
      if(choice===0)operation=input(`op-${index}`,sequence,{kind:'insert',path:['nodes',nodes.length],value:{id:`node-${index}`,name:`Node ${index}`,style:{color:'black'}}})
      else if(choice===1&&nodes.length>1){const from=random()%nodes.length;const to=random()%nodes.length;operation=input(`op-${index}`,sequence,{kind:'move',path:['nodes',from],toIndex:to})}
      else if(choice===2){const at=random()%nodes.length;operation=input(`op-${index}`,sequence,{kind:'set',path:['nodes',at,'name'],value:`Renamed ${index}`})}
      else{const at=random()%nodes.length;operation=input(`op-${index}`,sequence,{kind:'set',path:['nodes',at,'style','color'],value:['red','green','blue'][random()%3]})}
      expected=applyCollaborationOperationBatch(expected,[operation]);acceptedLog.push([operation])
      const result=await service.reconcile(PUBLICATION_TEST_SCOPE,command(`mutation-${index}`,sequence,[operation]),{actorSessionId:`session-${index%3}`})
      expect(result.outcome).toBe('accepted');sequence+=1
    }
    const catchUp=await service.catchUp(PUBLICATION_TEST_SCOPE,'post','post-1',0);expect(catchUp.operationsSinceBase).toHaveLength(80);expect(catchUp.document).toEqual(expected)
    const replayed=applyCollaborationOperationBatch({title:'Before',nodes:[{id:'seed',name:'Seed',style:{color:'black'}}]},catchUp.operationsSinceBase)
    expect(replayed).toEqual(expected)
  })

  test('demo: concurrent add/move/rename/style, reconnect, and compare every final tree',async()=>{
    const store=new InMemoryPublicationCollaborationStore();const initial={title:'Demo',nodes:[{id:'a',name:'A',style:{color:'black'}},{id:'b',name:'B',style:{color:'black'}}]};store.seed('post','post-1',initial);const service=new PublicationCollaborationService(store,()=>new Date(TEST_NOW))
    const addAndStyle=command('demo-left',0,[input('demo-add',0,{kind:'insert',path:['nodes',2],value:{id:'c',name:'C',style:{color:'black'}}}),input('demo-style',0,{kind:'set',path:['nodes',0,'style','color'],value:'purple'})])
    const moveAndRename=command('demo-right',0,[input('demo-move',0,{kind:'move',path:['nodes',1],toIndex:0}),input('demo-rename',0,{kind:'set',path:['nodes',0,'name'],value:'B renamed'})])
    const [left,right]=await Promise.all([service.reconcile(PUBLICATION_TEST_SCOPE,addAndStyle,{actorSessionId:'left'}),service.reconcile(PUBLICATION_TEST_SCOPE,moveAndRename,{actorSessionId:'right'})]);const accepted=left.outcome==='accepted'?left:right;const stale=left.outcome==='rebase-required'?left:right;const staleCommand=left.outcome==='rebase-required'?addAndStyle:moveAndRename
    if(accepted.outcome!=='accepted'||stale.outcome!=='rebase-required')throw new Error('Demo requires one accepted and one stale batch.')
    const retryOperations=staleCommand.operations.map(operation=>({...operation,baseSequence:stale.sequence}));const retry=await service.reconcile(PUBLICATION_TEST_SCOPE,command('demo-retry',stale.sequence,retryOperations),{actorSessionId:'reconnected'});if(retry.outcome!=='accepted')throw new Error('Demo retry must be accepted.')
    const firstClientTree=applyCollaborationOperationBatch(accepted.document,retry.receipt.operations);const reconnected=await service.catchUp(PUBLICATION_TEST_SCOPE,'post','post-1',0);const ledgerTree=applyCollaborationOperationBatch(initial,reconnected.operationsSinceBase)
    expect(firstClientTree).toEqual(retry.document);expect(reconnected.document).toEqual(retry.document);expect(ledgerTree).toEqual(retry.document);expect(reconnected.operationsSinceBase.map(operation=>operation.operationId).sort()).toEqual(['demo-add','demo-move','demo-rename','demo-style'])
  })
})
