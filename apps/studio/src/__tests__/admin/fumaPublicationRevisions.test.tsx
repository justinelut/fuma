import { afterEach, describe, expect, test } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PublicationContent } from '@core/fuma/publication'
import { PublicationWorkspace } from '../../admin/fuma/publication'
import { PublicationHttpClient } from '../../admin/fuma/publication/client'

const originalWebSocket=globalThis.WebSocket
class QuietWebSocket {
  static readonly OPEN=1
  readonly readyState=0
  addEventListener(){}
  send(){}
  close(){}
}
afterEach(()=>{globalThis.WebSocket=originalWebSocket})

const content:PublicationContent={contentId:'post-1',kind:'post',metadata:{title:'Launch',slug:'launch',excerpt:'',canonicalUrl:null,redirects:[],openGraph:{title:null,description:null,imageId:null,type:'article'},social:{title:null,description:null,imageId:null,card:'summary-large-image'},visibility:{kind:'public'},featureImageId:null,seoTitle:null,seoDescription:null,tagIds:[],primaryTagId:null,authorIds:['author-1']},document:{title:'Launch'},status:'draft',workflowVersion:2,scheduledAt:null,publishedAt:null,createdAt:'2040-01-01T00:00:00.000Z',updatedAt:'2040-01-01T00:00:00.000Z'}
const checksum='a'.repeat(64)
const revisions={headRevisionId:'revision-head',currentSequence:2,revisions:[{revisionId:'revision-head',resourceKind:'post',resourceId:'post-1',sequence:2,parentRevisionId:'revision-before',actorId:'actor-1',reason:'periodic',checkpointName:null,snapshotId:checksum,checksumSha256:checksum,sizeBytes:20,retainedUntil:'2040-02-01T00:00:00.000Z',snapshotAvailable:true,createdAt:'2040-01-02T00:00:00.000Z'},{revisionId:'revision-before',resourceKind:'post',resourceId:'post-1',sequence:1,parentRevisionId:null,actorId:'actor-1',reason:'manual-checkpoint',checkpointName:'Before redesign',snapshotId:'b'.repeat(64),checksumSha256:'b'.repeat(64),sizeBytes:20,retainedUntil:null,snapshotAvailable:true,createdAt:'2040-01-01T00:00:00.000Z'}]}

describe('FUMA-031 Studio revision accessibility',()=>{
  test('exposes named checkpoint, comparison, and two-step restore controls with labelled regions',async()=>{
    globalThis.WebSocket=QuietWebSocket as unknown as typeof WebSocket
    const client=new PublicationHttpClient({organizationId:'org',workspaceId:'workspace',siteId:'site',profileId:'publication'},async(input)=>{
      const url=String(input)
      if(url.includes('/revisions/post/post-1'))return new Response(JSON.stringify(revisions),{status:200,headers:{'content-type':'application/json'}})
      return new Response(JSON.stringify({error:'unexpected'}),{status:500,headers:{'content-type':'application/json'}})
    })
    render(<PublicationWorkspace surface="posts" client={client} canWrite content={[content]} authors={[{authorId:'author-1',displayName:'Editor',email:'editor@example.com',image:null}]} tags={[]} templates={[]}/>)
    expect(await screen.findByRole('heading',{name:'Revision history'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'Create named checkpoint'}).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Checkpoint name'),{target:{value:'Launch approved'}})
    expect(screen.getByRole('button',{name:'Create named checkpoint'}).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('group',{name:'Compare revisions'})).toBeTruthy()
    await waitFor(()=>expect(screen.getByText('Before redesign')).toBeTruthy())
    const restoreButtons=screen.getAllByRole('button',{name:'Review restore'});const enabledRestore=restoreButtons.find(button=>!button.hasAttribute('disabled'));expect(enabledRestore).toBeTruthy();fireEvent.click(enabledRestore!)
    expect(screen.getByRole('alert').textContent).toContain('Existing revisions remain immutable')
    expect(screen.getByRole('button',{name:'Restore as new head'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'Cancel'})).toBeTruthy()
  })
})
