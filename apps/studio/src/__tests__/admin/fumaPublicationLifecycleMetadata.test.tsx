import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PublicationContent, PublicationPresentationDecision } from '@core/fuma/publication'
import { PublicationWorkspace } from '../../admin/fuma/publication'
import { PublicationHttpClient } from '../../admin/fuma/publication/client'

const originalWebSocket = globalThis.WebSocket
class QuietWebSocket { static readonly OPEN=1; readonly readyState=0; addEventListener(){} send(){} close(){} }
afterEach(() => { globalThis.WebSocket = originalWebSocket })

const content: PublicationContent = {
  contentId:'post-1',kind:'post',metadata:{title:'Launch',slug:'launch',excerpt:'News',canonicalUrl:'https://news.example.test/launch',redirects:[{fromPath:'/old-launch',toPath:'/launch',statusCode:308}],openGraph:{title:'Launch OG',description:null,imageId:null,type:'article'},social:{title:'Launch social',description:null,imageId:null,card:'summary-large-image'},visibility:{kind:'paid'},featureImageId:null,seoTitle:'Launch SEO',seoDescription:'Search description',tagIds:[],primaryTagId:null,authorIds:['author-1']},document:{unsafe:'<script>never render</script>'},status:'draft',workflowVersion:1,scheduledAt:null,publishedAt:null,createdAt:'2040-01-01T00:00:00.000Z',updatedAt:'2040-01-01T00:00:00.000Z',
}
const decision: PublicationPresentationDecision = { delivery:'render',access:'denied',preview:true,statusCode:200,canonicalUrl:'https://news.example.test/launch',redirectLocation:null,robots:'noindex,nofollow',title:'Launch SEO',description:'Search description',openGraph:{title:'Launch OG',description:'Search description',imageId:null,type:'article'},social:{title:'Launch social',description:'Search description',imageId:null,card:'summary-large-image'},html:'<article><h1>Launch</h1></article>',reason:'preview' }

describe('FUMA-034 Studio lifecycle and metadata panels', () => {
  test('edits metadata, transitions lifecycle, and inspects a sandboxed denied-access preview', async () => {
    globalThis.WebSocket = QuietWebSocket as unknown as typeof WebSocket
    const calls: string[] = []
    const client = new PublicationHttpClient({organizationId:'org',workspaceId:'workspace',siteId:'site',profileId:'publication'}, async (input, init) => {
      const url = String(input); calls.push(`${init?.method} ${url}`)
      if (url.includes('/revisions/post/post-1')) return new Response(JSON.stringify({headRevisionId:null,currentSequence:0,revisions:[]}),{headers:{'content-type':'application/json'}})
      if (url.endsWith('/workflow')) return new Response(JSON.stringify({...content,status:'published',workflowVersion:2,publishedAt:'2040-01-02T00:00:00.000Z',updatedAt:'2040-01-02T00:00:00.000Z'}),{headers:{'content-type':'application/json'}})
      if (url.endsWith('/content/post-1/presentation')) return new Response(JSON.stringify(decision),{headers:{'content-type':'application/json'}})
      return new Response(JSON.stringify({error:'unexpected'}),{status:500,headers:{'content-type':'application/json'}})
    })
    render(<PublicationWorkspace surface="posts" client={client} canWrite content={[content]} authors={[{authorId:'author-1',displayName:'Editor',email:'editor@example.com',image:null}]} tags={[]} templates={[]}/>)
    expect(await screen.findByRole('heading',{name:'SEO, social, and access'})).toBeTruthy()
    expect((screen.getByLabelText('SEO title') as HTMLInputElement).value).toBe('Launch SEO')
    expect((screen.getByLabelText('Canonical URL') as HTMLInputElement).value).toBe('https://news.example.test/launch')
    expect((screen.getByLabelText('Visibility') as HTMLSelectElement).value).toBe('paid')
    expect(screen.getByRole('group',{name:'Publication lifecycle'})).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Next state'),{target:{value:'published'}})
    fireEvent.click(screen.getByRole('button',{name:'Apply lifecycle transition'}))
    await waitFor(()=>expect(screen.getByText(/Current state:/).textContent).toContain('published'))
    fireEvent.change(screen.getByLabelText('Audience'),{target:{value:'member'}})
    fireEvent.click(screen.getByRole('button',{name:'Inspect safe preview'}))
    const region=await screen.findByRole('region',{name:'Publication presentation decision'})
    expect(region.textContent).toContain('denied')
    expect(screen.getByTitle('Safe semantic publication preview').getAttribute('sandbox')).toBe('')
    expect(calls.some(call=>call.includes('POST')&&call.endsWith('/workflow'))).toBe(true)
    expect(calls.some(call=>call.includes('POST')&&call.endsWith('/content/post-1/presentation'))).toBe(true)
  })
})
