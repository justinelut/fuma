import { describe,expect,test } from 'bun:test'
import type { CollaborationReconcileCommand, CollaborationReconcileResult, CollaborationSocketServerMessage } from '@core/fuma/publication'
import { PublicationCollaborationCoordinator, PublicationCollaborationSocketClient } from '../../admin/fuma/publication/collaborationCoordinator'

const accepted=(mutationId:string,sequence:number,document:unknown):CollaborationReconcileResult=>({outcome:'accepted',replayed:false,receipt:{mutationId,sequence,operationIds:[`op-${sequence}`],operations:[{operationId:`op-${sequence}`,mutationId,actorSessionId:'session',baseSequence:sequence-1,acceptedSequence:sequence,operationIndex:0,kind:'set',path:['title'],value:(document as {title:string}).title,createdAt:'2040-01-02T03:04:05.000Z'}]},document})

describe('FUMA-030 browser collaborative reconciliation',()=>{
  test('keeps local work visible and rebases retry operations against the explicit authoritative document',async()=>{
    const client={reconcile:async(command:CollaborationReconcileCommand)=>({outcome:'rebase-required' as const,mutationId:command.mutationId,sequence:2,document:{title:'remote',nodes:[]},operationsSinceBase:[]})}
    const coordinator=new PublicationCollaborationCoordinator({client,resourceKind:'post',resourceId:'post-1',document:{title:'base',nodes:[]},sequence:1,mutationId:()=> 'mutation-local'})
    coordinator.update({title:'local',nodes:[]},{operationId:'op-local',baseSequence:1,kind:'set',path:['title'],value:'local'})
    await coordinator.flush();expect(coordinator.getSnapshot()).toMatchObject({state:'rebase-required',document:{title:'local'},authoritative:{document:{title:'remote'},sequence:2}})
    coordinator.resolve('retry-local');expect(coordinator.getSnapshot()).toMatchObject({state:'dirty',sequence:2,document:{title:'local'},localOperations:[{baseSequence:2}]})
  })

  test('fails unsupported retry visibly without replacing either local or authoritative tree',async()=>{
    const client={reconcile:async(command:CollaborationReconcileCommand)=>({outcome:'rebase-required' as const,mutationId:command.mutationId,sequence:2,document:{nodes:[]},operationsSinceBase:[]})}
    const coordinator=new PublicationCollaborationCoordinator({client,resourceKind:'post',resourceId:'post',document:{nodes:[{name:'base'}]},sequence:1,mutationId:()=> 'mutation'})
    coordinator.update({nodes:[]},{operationId:'remove',baseSequence:1,kind:'remove',path:['nodes',0]});await coordinator.flush()
    const before=coordinator.getSnapshot();expect(()=>coordinator.resolve('retry-local')).toThrow('Remove array index');expect(coordinator.getSnapshot()).toBe(before)
    coordinator.resolve('accept-authoritative');expect(coordinator.getSnapshot()).toMatchObject({state:'clean',sequence:2,document:{nodes:[]},localOperations:[]})
  })

  test('applies clean accepted fan-out, ignores duplicate/stale frames, and exposes out-of-order catch-up as a rebase when dirty',()=>{
    const coordinator=new PublicationCollaborationCoordinator({client:{reconcile:async()=>{throw new Error('unused')}},resourceKind:'post',resourceId:'post',document:{title:'base'},sequence:0})
    const first=accepted('remote-1',1,{title:'remote-1'});if(first.outcome!=='accepted')throw new Error()
    const frame:CollaborationSocketServerMessage={type:'collaboration-accepted',replayed:false,receipt:first.receipt,document:first.document}
    coordinator.receive(frame);coordinator.receive(frame);expect(coordinator.getSnapshot()).toMatchObject({state:'clean',sequence:1,document:{title:'remote-1'}})
    coordinator.update({title:'local'},{operationId:'local',baseSequence:1,kind:'set',path:['title'],value:'local'})
    coordinator.receive({type:'collaboration-catch-up',sequence:3,document:{title:'remote-3'},operationsSinceBase:[]})
    expect(coordinator.getSnapshot()).toMatchObject({state:'rebase-required',sequence:1,document:{title:'local'},authoritative:{sequence:3,document:{title:'remote-3'}}})
  })
})

class FakeSocket {
  static readonly OPEN=1
  readyState=0
  readonly sent:string[]=[]
  readonly listeners=new Map<string,Set<(event:{data?:unknown})=>void>>()
  constructor(readonly url:string){}
  addEventListener(type:string,listener:(event:{data?:unknown})=>void){let values=this.listeners.get(type);if(!values){values=new Set();this.listeners.set(type,values)}values.add(listener)}
  send(value:string){this.sent.push(value)}
  close(){this.readyState=3;this.emit('close')}
  open(){this.readyState=1;this.emit('open')}
  message(value:unknown){this.emit('message',{data:JSON.stringify(value)})}
  emit(type:string,event:{data?:unknown}={}){for(const listener of this.listeners.get(type)??[])listener(event)}
}

describe('FUMA-030 reconnecting collaboration transport',()=>{
  test('requests catch-up, retries the same pending mutation ID after reconnect, and consumes its acknowledgement once',async()=>{
    const sockets:FakeSocket[]=[];const holder:{transport?:PublicationCollaborationSocketClient<{title:string}>}={}
    const client={reconcile:(command:CollaborationReconcileCommand)=>holder.transport!.reconcile(command)}
    const coordinator=new PublicationCollaborationCoordinator({client,resourceKind:'post',resourceId:'post',document:{title:'base'},sequence:0,mutationId:()=> 'mutation-pending'})
    const transport=new PublicationCollaborationSocketClient({target:{organizationId:'org',workspaceId:'workspace',siteId:'site',profileId:'publication'},resourceKind:'post',resourceId:'post',coordinator,socketFactory:(url)=>{const socket=new FakeSocket(url);sockets.push(socket);return socket as never},tabId:'tab-stable',location:{protocol:'https:',host:'5174.blyss.co.ke'}});holder.transport=transport
    transport.start();sockets[0]!.open();expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({type:'collaboration-catch-up',afterSequence:0})
    coordinator.update({title:'local'},{operationId:'op-local',baseSequence:0,kind:'set',path:['title'],value:'local'});const flushing=coordinator.flush();expect(JSON.parse(sockets[0]!.sent[1]!).command.mutationId).toBe('mutation-pending')
    sockets[0]!.close();await Bun.sleep(280);expect(sockets).toHaveLength(2);expect(new URL(sockets[1]!.url).searchParams.get('tab')).toBe('tab-stable');sockets[1]!.open()
    const resent=sockets[1]!.sent.map(value=>JSON.parse(value));expect(resent[0]).toEqual({type:'collaboration-catch-up',afterSequence:0});expect(resent[1].command.mutationId).toBe('mutation-pending')
    const result=accepted('mutation-pending',1,{title:'local'});if(result.outcome!=='accepted')throw new Error();sockets[1]!.message({type:'collaboration-accepted',replayed:true,receipt:result.receipt,document:result.document});await flushing
    expect(coordinator.getSnapshot()).toMatchObject({state:'clean',sequence:1,document:{title:'local'}});transport.stop()
  })
})
