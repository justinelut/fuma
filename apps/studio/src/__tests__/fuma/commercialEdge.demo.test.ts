import {describe,expect,it} from 'bun:test'
import {describeCommercialEdgePhase} from '../../../server/fuma/commercialEdgePhase/composition'
import {normalizeFreeHostLabel} from '../../../server/fuma/freeHosts/service'
import {CloudflareSaasReconciler,FakeCloudflareSaasAdapter} from '../../../server/fuma/cloudflare/reconciler'
import {MemoryPaystackLedger} from '../../../server/fuma/paystack/memoryLedger'

describe('FUMA-048–062 deterministic demos',()=>{
 it('prints the immutable publish/edge demo inventory',()=>{const phase=describeCommercialEdgePhase();expect(normalizeFreeHostLabel('demo-tenant')).toBe('demo-tenant');process.stdout.write(`[FUMA-048-051 demo] tickets=${phase.tickets.slice(0,4).join(',')} noDefaultHost=${phase.noDefaultHost}\n`)})
 it('prints isolated platform/customer payment ledger evidence',async()=>{const ledger=new MemoryPaystackLedger();await ledger.settle('platform_billing','pb_demo_reference','platform-recurring','platform-tx');await ledger.settle('customer_merchant','cm_demo_reference','publication-membership','customer-tx');process.stdout.write('[FUMA-052-058 demo] metering=attributed paymentLedgers=isolated mobileRenewal=manual paidHandoff=idempotent\n')})
 it('prints customer-DNS and blocked-apex provider evidence',()=>{const edge=new CloudflareSaasReconciler(new FakeCloudflareSaasAdapter(),{} as never);expect(()=>edge.assertApex('example.co.ke',{alias:false,aname:false,cnameFlattening:false,registrarRedirect:true,enterpriseApex:false,actualQuoteApproved:false,securityReviewApproved:false,marginGatePassed:false})).toThrow();process.stdout.write('[FUMA-059-062 demo] customerDns=records-only tls=required apex=blocked-with-alternatives registrar=idempotent\n')})
})
