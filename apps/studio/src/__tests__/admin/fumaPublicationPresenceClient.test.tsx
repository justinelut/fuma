import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { usePublicationPresence } from '../../../src/admin/fuma/publication/usePublicationPresence'

const target={organizationId:'organization',workspaceId:'workspace',siteId:'site',profileId:'publication'} as const
class FakeWebSocket {
  static readonly OPEN=1
  readyState=0;readonly sent:string[]=[];closed=false;readonly listeners=new Map<string,Set<(event:{data?:unknown})=>void>>()
  constructor(readonly url:string){}
  addEventListener(type:string,listener:(event:{data?:unknown})=>void){let values=this.listeners.get(type);if(!values){values=new Set();this.listeners.set(type,values)}values.add(listener)}
  emit(type:string,event:{data?:unknown}={}){for(const listener of this.listeners.get(type)??[])listener(event)}
  open(){this.readyState=1;this.emit('open')}
  send(value:string){this.sent.push(value)}
  close(){if(this.closed)return;this.closed=true;this.readyState=3;this.emit('close')}
  snapshot(entries:unknown[]){this.emit('message',{data:JSON.stringify({type:'snapshot',entries})})}
}
afterEach(cleanup)
function options(factory:(url:string)=>WebSocket){return{target,resourceKind:'post' as const,resourceId:'post-1',displayName:'Editor',selection:{kind:'none' as const},draftSequence:1,socketFactory:factory}}

describe('FUMA-029 Publication presence client',()=>{
 test('uses distinct tab identities, decodes collaborators, and keeps edit authority out of presence state',async()=>{const sockets:FakeWebSocket[]=[];const factory=(url:string)=>{const socket=new FakeWebSocket(url);sockets.push(socket);return socket as never};const alpha=renderHook(()=>usePublicationPresence(options(factory)));const beta=renderHook(()=>usePublicationPresence(options(factory)));expect(new URL(sockets[0]!.url).searchParams.get('tab')).not.toBe(new URL(sockets[1]!.url).searchParams.get('tab'));act(()=>sockets[0]!.open());const observedAt='2040-01-02T03:04:05.000Z';act(()=>sockets[0]!.snapshot([{actorId:'actor-b',sessionId:'presence-b',displayName:'Beta',resourceKind:'post',resourceId:'post-1',selection:{kind:'none'},draftSequence:1,observedAt}]));await waitFor(()=>expect(alpha.result.current.entries).toHaveLength(1));expect(alpha.result.current.entries[0]).not.toHaveProperty('canWrite');expect(beta.result.current.entries).toEqual([])})
 test('reconnects with the same tab identity and cancels reconnect on cleanup',async()=>{const sockets:FakeWebSocket[]=[];const factory=(url:string)=>{const socket=new FakeWebSocket(url);sockets.push(socket);return socket as never};const view=renderHook(()=>usePublicationPresence(options(factory)));const firstTab=new URL(sockets[0]!.url).searchParams.get('tab');act(()=>sockets[0]!.open());act(()=>sockets[0]!.close());await waitFor(()=>expect(sockets.length).toBe(2),{timeout:1000});expect(new URL(sockets[1]!.url).searchParams.get('tab')).toBe(firstTab);view.unmount();const count=sockets.length;await Bun.sleep(300);expect(sockets).toHaveLength(count);expect(sockets.at(-1)?.closed).toBe(true)})
})
