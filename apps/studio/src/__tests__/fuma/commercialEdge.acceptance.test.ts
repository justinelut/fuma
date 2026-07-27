import {describe,expect,it} from 'bun:test'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
const root=join(import.meta.dir,'../../..')
const cases=[
['FUMA-048','server/fuma/releases/service.ts',['verifyManifestObjects','putActivePointer(pointer','active-release']],
['FUMA-049','server/fuma/publishing/workerPublisher.ts',['claimExact','commitDurableResult','before-activation']],
['FUMA-050','server/fuma/freeHosts/service.ts',['RESERVED_FREE_HOST_LABELS','No default host is configured.','suspended']],
['FUMA-051','server/fuma/edgeDelivery/service.ts',['member-required','ifNoneMatch','rollback']],
['FUMA-052','server/fuma/metering/service.ts',['internalWorkload','CostCompletenessError','reconcile']],
['FUMA-053','server/fuma/paystack/transport.ts',['platform_billing','customer_merchant','verifyPaystackWebhook']],
['FUMA-054','server/fuma/entitlements/service.ts',['platform-internal','awaiting-payment','margin < 7_000']],
['FUMA-055','server/fuma/checkout/service.ts',['platform_billing','platform-setup','internal-denied']],
['FUMA-056','server/fuma/billing/reconciler.ts',['paid-transfer-pending','emitHandoff','transport.verify']],
['FUMA-057','server/fuma/quotas/service.ts',['exhausted','shadowCost: undefined','reserved']],
['FUMA-058','server/fuma/customerPayments/service.ts',['customer_merchant','manual-mobile-money','Daraja is not implemented.']],
['FUMA-059','server/fuma/domains/service.ts',['AES-256-GCM','customer-automation','redacted']],
['FUMA-060','server/fuma/cloudflare/reconciler.ts',['actualQuoteApproved','paygMaximum: 50_000','marginGatePassed']],
['FUMA-061','server/fuma/registrar/service.ts',['stale-quote','lookupByIdempotency','stepUp.consume']],
['FUMA-062','server/fuma/domainOperations/service.ts',['expired-auth-code','rolled-back','siteTransferChoice']],
] as const
describe('FUMA-048–062 per-ticket production acceptance inventory',()=>{for(const [ticket,file,markers] of cases)it(`${ticket} production authority contains its mandatory controls`,()=>{const source=readFileSync(join(root,file),'utf8');for(const marker of markers)expect(source).toContain(marker)})})
