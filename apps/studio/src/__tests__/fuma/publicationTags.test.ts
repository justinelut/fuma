import {describe,expect,test} from 'bun:test'
import {publicationFixture} from '../helpers/fuma/publicationFixtures'

describe('FUMA-033 Publication tags',()=>{
 test('upserts scoped tags and lists them deterministically without tenant authority in values',async()=>{const h=publicationFixture();expect(await h.store.putTag(h.scope,{tagId:'tag-b',name:'Zebra',slug:'zebra',description:''})).toBe(true);expect(await h.store.putTag(h.scope,{tagId:'tag-a',name:'Acacia',slug:'acacia',description:'Kenya'})).toBe(true);expect((await h.store.listTags(h.scope)).map(tag=>tag.tagId)).toEqual(['tag-a','tag-b']);expect(await h.store.putTag(h.scope,{tagId:'tag-c',name:'Duplicate',slug:'acacia',description:''})).toBe(false)})
})
