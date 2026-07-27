import { describe, expect, test } from 'bun:test'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import { PublicationContentImportSchema, type PublicationContent } from '@core/fuma/publication'
import { createPublicationScopedRouteDeclarations } from '../../../server/fuma/publication/routes'
import { PublicationEditorialService, PublicationIdentityService } from '../../../server/fuma/publication/services'
import { publicationFixture, PUBLICATION_TEST_SCOPE, TEST_NOW } from '../helpers/fuma/publicationFixtures'

function content(contentId:string,kind:'post'|'page',overrides:Partial<PublicationContent['metadata']>={}):PublicationContent{return{
  contentId,kind,
  metadata:{title:kind==='post'?'Universal post':'Universal page',slug:contentId,excerpt:'Stored once',canonicalUrl:null,redirects:[],openGraph:{title:null,description:null,imageId:null,type:kind==='post'?'article':'website'},social:{title:null,description:null,imageId:null,card:'summary-large-image'},visibility:{kind:'public'},featureImageId:'media-1',seoTitle:null,seoDescription:null,tagIds:['tag-news','tag-kenya'],primaryTagId:'tag-news',authorIds:['author-a','author-b'],...overrides},
  document:{type:'visual-document',nodes:[{id:'hero',type:'text',text:'Owned content'}]},
  status:'draft',workflowVersion:1,scheduledAt:null,publishedAt:null,createdAt:TEST_NOW,updatedAt:TEST_NOW,
}}

describe('FUMA-033 Publication universal content',()=>{
  test('CRUD keeps posts/pages, visual documents, co-authors, primary tags, media, and settings in scoped records',async()=>{
    const h=publicationFixture(),editorial=new PublicationEditorialService(h.store),identity=new PublicationIdentityService(h.store)
    h.store.seedAuthor(h.scope,{authorId:'author-a',displayName:'Amina',email:'amina@example.com',image:null})
    h.store.seedAuthor(h.scope,{authorId:'author-b',displayName:'Baraka',email:'baraka@example.com',image:'https://example.com/baraka.jpg'})
    await h.store.putTag(h.scope,{tagId:'tag-news',name:'News',slug:'news',description:'Newsroom'})
    await h.store.putTag(h.scope,{tagId:'tag-kenya',name:'Kenya',slug:'kenya',description:'Kenyan reporting'})
    const post=await editorial.save(h.scope,content('post-stable','post'),null)
    const page=await editorial.save(h.scope,content('page-stable','page',{featureImageId:null}),null)
    const edited=await editorial.save(h.scope,{...post,metadata:{...post.metadata,excerpt:'Updated once'},updatedAt:'2040-01-02T04:00:00.000Z'},1)
    expect(edited.workflowVersion).toBe(2)
    expect((await h.store.getContent(h.scope,'post-stable'))?.document).toEqual(post.document)
    expect((await h.store.listContent(h.scope)).map(item=>item.contentId).sort()).toEqual(['page-stable','post-stable'])
    expect((await h.store.listAuthors(h.scope)).map(item=>item.authorId)).toEqual(['author-a','author-b'])
    expect((await h.store.listTags(h.scope)).map(item=>item.tagId)).toEqual(['tag-kenya','tag-news'])
    const settings=await identity.save(h.scope,{publicationId:'publication-stable',name:'Acacia Daily',description:'Independent reporting',language:'en-KE',timezone:'Africa/Nairobi',version:1,updatedAt:TEST_NOW},null)
    expect(await identity.get(h.scope)).toEqual(settings)
    await editorial.remove(h.scope,page.contentId,page.workflowVersion)
    expect(await h.store.getContent(h.scope,page.contentId)).toBeNull()
  })

  test('imports stable IDs atomically and rejects duplicate/partial conflict batches',async()=>{
    const h=publicationFixture(),editorial=new PublicationEditorialService(h.store)
    const first=content('import-post','post',{featureImageId:null,tagIds:[],primaryTagId:null,authorIds:['author-a']})
    const second=content('import-page','page',{featureImageId:null,tagIds:[],primaryTagId:null,authorIds:['author-a']})
    await expect(editorial.importMany(h.scope,{items:[{content:first,expectedVersion:null},{content:second,expectedVersion:null}]})).resolves.toHaveLength(2)
    expect((await h.store.getContent(h.scope,'import-post'))?.contentId).toBe('import-post')
    await expect(editorial.importMany(h.scope,{items:[{content:{...first,contentId:'new-before-conflict'},expectedVersion:null},{content:second,expectedVersion:null}]})).rejects.toThrow('conflicts')
    expect(await h.store.getContent(h.scope,'new-before-conflict')).toBeNull()
    expect(safeParseValue(PublicationContentImportSchema,{items:[{content:first,expectedVersion:null}],profileId:'forged'}).ok).toBe(false)
    await expect(editorial.importMany(h.scope,{items:[{content:first,expectedVersion:null},{content:first,expectedVersion:null}]})).rejects.toThrow('duplicate stable IDs')
  })

  test('isolates identical IDs across site, owner generation, and assigned profile scopes',async()=>{
    const h=publicationFixture(),editorial=new PublicationEditorialService(h.store),identity=new PublicationIdentityService(h.store)
    const otherSite={...PUBLICATION_TEST_SCOPE,siteId:'other-site',ownerKey:'other-owner'}
    const otherProfile={...PUBLICATION_TEST_SCOPE,profileId:'other-profile'}
    const otherGeneration={...PUBLICATION_TEST_SCOPE,generation:2}
    const value=content('same-id','post',{featureImageId:null,tagIds:[],primaryTagId:null,authorIds:['author-a']})
    await editorial.save(h.scope,value,null)
    await editorial.save(otherSite,{...value,metadata:{...value.metadata,title:'Other site'}},null)
    await editorial.save(otherProfile,{...value,metadata:{...value.metadata,title:'Other profile'}},null)
    await identity.save(h.scope,{publicationId:'identity',name:'Primary',description:'',language:'en-KE',timezone:'Africa/Nairobi',version:1,updatedAt:TEST_NOW},null)
    expect((await h.store.getContent(h.scope,'same-id'))?.metadata.title).toBe('Universal post')
    expect((await h.store.getContent(otherSite,'same-id'))?.metadata.title).toBe('Other site')
    expect((await h.store.getContent(otherProfile,'same-id'))?.metadata.title).toBe('Other profile')
    expect(await h.store.getContent(otherGeneration,'same-id')).toBeNull()
    expect(await h.store.getSettings(otherProfile)).toBeNull()
  })

  test('declares every FUMA-033 mutation behind exact write permissions',()=>{
    const declarations=createPublicationScopedRouteDeclarations({} as never)
    const permissions=new Map(declarations.map(route=>[`${route.method} ${route.path}`,route.permission]))
    expect(permissions.get('POST /publication/content')).toBe('publication.posts.write')
    expect(permissions.get('POST /publication/content/import')).toBe('publication.posts.write')
    expect(permissions.get('DELETE /publication/content/:contentId')).toBe('publication.posts.write')
    expect(permissions.get('POST /publication/tags')).toBe('publication.tags.write')
    expect(permissions.get('POST /publication/settings')).toBe('site.settings.write')
    expect(permissions.get('GET /publication/authors')).toBe('publication.posts.read')
  })

  test('emits the deterministic author/tag/content universal-store demo transcript',async()=>{
    const h=publicationFixture(),editorial=new PublicationEditorialService(h.store)
    for(const author of [{authorId:'author-a',displayName:'Amina',email:'amina@example.com',image:null},{authorId:'author-b',displayName:'Baraka',email:'baraka@example.com',image:null}] as const)h.store.seedAuthor(h.scope,author)
    await h.store.putTag(h.scope,{tagId:'tag-news',name:'News',slug:'news',description:''})
    await h.store.putTag(h.scope,{tagId:'tag-kenya',name:'Kenya',slug:'kenya',description:''})
    const post=await editorial.save(h.scope,content('demo-post','post',{featureImageId:null}),null)
    const transcript={universalRows:(await h.store.listContent(h.scope)).map(item=>({stableId:item.contentId,kind:item.kind,visualDocument:item.document})),relations:{authors:post.metadata.authorIds,tags:post.metadata.tagIds,primaryTag:post.metadata.primaryTagId}}
    process.stdout.write(`[FUMA-033 demo] ${JSON.stringify(transcript)}\n`)
    expect(transcript).toMatchObject({universalRows:[{stableId:'demo-post',kind:'post'}],relations:{authors:['author-a','author-b'],tags:['tag-news','tag-kenya'],primaryTag:'tag-news'}})
  })
})
