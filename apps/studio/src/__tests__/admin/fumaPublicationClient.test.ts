import { describe,expect,test } from 'bun:test'
import { PublicationHttpClient } from '../../admin/fuma/publication/client'

describe('Publication scoped HTTP client',()=>{
 test('encodes complete ancestry in every path without sending profile authority',async()=>{const calls:Array<{url:string;body:string}>=[];const client=new PublicationHttpClient({organizationId:'org / one',workspaceId:'workspace',siteId:'site',profileId:'publication'},async(input,init)=>{calls.push({url:String(input),body:String(init?.body??'')});return new Response(JSON.stringify({accepted:true}),{headers:{'content-type':'application/json'}})});await client.heartbeat({resourceKind:'post',resourceId:'post-1',displayName:'Editor',selection:{kind:'none'},draftSequence:1});expect(calls[0]?.url).toContain('/organizations/org%20%2F%20one/workspaces/workspace/sites/site/publication/presence');expect(calls[0]?.body).not.toContain('profileId');expect(calls[0]?.body).not.toContain('ownerKey')})
 test('rejects malformed success envelopes',async()=>{const client=new PublicationHttpClient({organizationId:'o',workspaceId:'w',siteId:'s',profileId:'publication'},async()=>new Response(JSON.stringify({accepted:'yes'}),{headers:{'content-type':'application/json'}}));await expect(client.heartbeat({resourceKind:'post',resourceId:'p',displayName:'E',selection:{kind:'none'},draftSequence:0})).rejects.toThrow()})
})
