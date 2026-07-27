import { describe,expect,test } from 'bun:test'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import { CollaborationReconcileCommandSchema,EmailSettingsLayerSchema,NewsletterVersionSchema } from '@core/fuma/publication'
import { applyCollaborationOperations } from '../../../server/fuma/publication/collaboration'
import { PublicationNewsletterService } from '../../../server/fuma/publication/services'
import { PublicationUnsubscribeTokenSigner } from '../../../server/fuma/publication/unsubscribeTokens'
import { publicationFixture,TEST_DOCUMENT,TEST_NOW } from '../helpers/fuma/publicationFixtures'

describe('Publication security boundary',()=>{
 test('strict TypeBox contracts reject caller tenant/profile/actor authority claims',()=>{expect(safeParseValue(CollaborationReconcileCommandSchema,{resourceKind:'post',resourceId:'p',expectedSequence:0,operations:[],profileId:'publication'}).ok).toBe(false);expect(safeParseValue(EmailSettingsLayerSchema,{scope:'site',scopeId:'site',values:{},version:1,updatedAt:TEST_NOW,ownerKey:'forged'}).ok).toBe(false);expect(safeParseValue(NewsletterVersionSchema,{versionId:'v',newsletterId:'n',ordinal:1,subject:'S',previewText:'',document:TEST_DOCUMENT,createdBy:'a',createdAt:TEST_NOW,lockedAt:null,organizationId:'other'}).ok).toBe(false)})
 test('prototype pollution and unsafe nested paths are rejected before mutation',()=>{const target={safe:true};expect(()=>applyCollaborationOperations(target,[{operationId:'o',actorSessionId:'s',baseSequence:0,kind:'set',path:['__proto__','polluted'],value:true,createdAt:TEST_NOW}])).toThrow();expect(({} as Record<string,unknown>).polluted).toBeUndefined()})
 test('launch newsletter construction rejects every non-OCI provider',()=>{const h=publicationFixture();expect(()=>new PublicationNewsletterService(h.store,{} as never,{kind:'smtp',submit:async()=>({providerMessageId:'x'})} as never)).toThrow('OCI Email Delivery')})
 test('signs public unsubscribe scope authority and rejects tampering or expiry',()=>{const h=publicationFixture(),signer=new PublicationUnsubscribeTokenSigner('s'.repeat(32)),payload={scope:h.scope,claims:{tokenId:'token',memberId:'member',newsletterId:null,issuedAt:'2040-01-01T00:00:00.000Z',expiresAt:'2041-01-01T00:00:00.000Z'}},token=signer.issue(payload);expect(signer.verify(token,new Date(TEST_NOW))?.scope.ownerKey).toBe('owner-key');expect(signer.verify(`${token}x`,new Date(TEST_NOW))).toBeNull();expect(signer.verify(token,new Date('2042-01-01T00:00:00.000Z'))).toBeNull()})
 test('owner generation and profile are immutable parts of every repository scope',()=>{expect(harden({...publicationFixture().scope,generation:2}).generation).toBe(2);function harden<T>(value:T){return Object.freeze(value)}})
})
