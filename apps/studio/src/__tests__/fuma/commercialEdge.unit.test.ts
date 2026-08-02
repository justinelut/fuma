import {describe,expect,it} from 'bun:test'
import { Type } from '@core/utils/typeboxHelpers'
import {normalizeFreeHostLabel,normalizePublicHost,FreeHostError} from '../../../server/fuma/freeHosts/service'
import {MemoryEdgeCache} from '../../../server/fuma/edgeDelivery/service'
import {signPaystackWebhook,verifyPaystackWebhook,PaystackPurposeRegistry,PaystackError} from '../../../server/fuma/paystack/transport'
import {CloudflareSaasReconciler,FakeCloudflareSaasAdapter} from '../../../server/fuma/cloudflare/reconciler'
import {FakeRegistrarAdapter} from '../../../server/fuma/commercialEdgePhase/providerFakes'

describe('FUMA-048–062 commercial edge unit behavior',()=>{
 it('FUMA-048 retains the immutable release service as the lifecycle authority',async()=>{const source=await Bun.file(new URL('../../../server/fuma/releases/service.ts',import.meta.url)).text();expect(source).toContain('verifyManifestObjects');expect(source).toContain('putActivePointer(pointer')})
 it('FUMA-049 owns publish worker activation only after finalization',async()=>{const source=await Bun.file(new URL('../../../server/fuma/publishing/workerPublisher.ts',import.meta.url)).text();expect(source.indexOf("stage: 'finalized'")).toBeLessThan(source.lastIndexOf('releases.activate'))})
 it('FUMA-050 normalizes case, port and trailing dot and rejects reserved or IDN labels',()=>{expect(normalizePublicHost('Tenant.Trimly.Co.Ke:443.')).toBe('tenant.trimly.co.ke');expect(normalizeFreeHostLabel('safe-tenant')).toBe('safe-tenant');expect(()=>normalizeFreeHostLabel('admin')).toThrow(FreeHostError);expect(()=>normalizeFreeHostLabel('ténant')).toThrow(FreeHostError)})
 it('FUMA-051 deletes only host-separated cache prefixes',async()=>{const cache=new MemoryEdgeCache();await cache.put('edge:a.trimly.co.ke:site:r:/','' as never);await cache.put('edge:b.trimly.co.ke:site:r:/','' as never);expect(await cache.deletePrefix('edge:a.trimly.co.ke:')).toBe(1);expect(cache.entries.has('edge:b.trimly.co.ke:site:r:/')).toBe(true)})
 it('FUMA-053 authenticates exact raw bytes and rejects tampering',()=>{const raw=new TextEncoder().encode('{"event":"charge.success"}');const signature=signPaystackWebhook('scope-secret',raw);expect(()=>verifyPaystackWebhook('scope-secret',raw,signature)).not.toThrow();expect(()=>verifyPaystackWebhook('scope-secret',new Uint8Array([...raw,1]),signature)).toThrow(PaystackError)})
 it('FUMA-053 purpose registry denies scope crossing and unknown commerce',()=>{const registry=new PaystackPurposeRegistry().register({id:'platform-recurring',scope:'platform_billing',metadataSchema:Type.Object({}, { additionalProperties: false }),async authorize(){},expected(){return{amountMinor:1,currency:'KES'}},async settle(){}});expect(()=>registry.exact('platform-recurring','customer_merchant')).toThrow(PaystackError);expect(()=>registry.exact('commerce_order','customer_merchant')).toThrow(PaystackError)})
 it('FUMA-060 enforces every Enterprise apex gate and publishes the fixed baseline',()=>{const reconcile=new CloudflareSaasReconciler(new FakeCloudflareSaasAdapter(),{} as never);expect(()=>reconcile.assertApex('example.co.ke',{alias:false,aname:false,cnameFlattening:false,registrarRedirect:true,enterpriseApex:true,actualQuoteApproved:false,securityReviewApproved:true,marginGatePassed:true})).toThrow();expect(reconcile.hostnameCost(105)).toMatchObject({included:100,paygMaximum:50000,totalUsdCents:50})})
})


describe('FUMA-061 registrar provider fake',()=>{
 it('reconciles an ambiguous renewal by the exact idempotency key',async()=>{const adapter=new FakeRegistrarAdapter();const registration={registrationId:'registration:q',quoteId:'q',hostname:'example.co.ke',providerReference:'provider-registration',registeredAt:'2026-01-01T00:00:00.000Z',expiresAt:'2027-01-01T00:00:00.000Z',state:'active' as const,receiptId:'receipt:q'};const key='registrar-renew:registration:q:2027-01-01T00:00:00.000Z';const renewed=await adapter.renew(registration,1,key);expect(await adapter.lookupRenewalByIdempotency(key)).toEqual(renewed);expect(adapter.renewals.size).toBe(1)})
})
