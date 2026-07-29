import { AesGcmRegistrarAuthCodeVault } from '../../../server/fuma/domainOperations/authCodeVault'
import { DeterministicAuthCodeDelivery, DeterministicAuthCodeKeys, DeterministicAutomationCredentials, DeterministicDetachPort, DeterministicDnsObserver, DeterministicRegistrarTransferProvider } from '../../../server/fuma/domainOperations/fakes'
import { MemoryDomainOperationsRepository } from '../../../server/fuma/domainOperations/repository'
import { DomainOperationsService } from '../../../server/fuma/domainOperations/service'
import type { ApexCapability, CloudflarePrevalidation, DnsInstruction } from '../../../server/fuma/cloudflare/contracts'
import type { DomainScope } from '../../../server/fuma/domains/contracts'

export const scope:DomainScope={platformId:'fuma',organizationId:'org-a',workspaceId:'workspace-a',siteId:'site-a',ownerKey:'owner-a',generation:1,state:'active',transferFence:null,profileId:'website'}
export const destination:DomainScope={platformId:'fuma',organizationId:'org-b',workspaceId:'workspace-b',siteId:'site-a',ownerKey:'owner-b',generation:2,state:'active',transferFence:null,profileId:'website'}
export const records:readonly DnsInstruction[]=[
  {type:'CNAME',name:'www.example.co.ke',value:'customers.fuma.co.ke',purpose:'routing'},
  {type:'TXT',name:'_cf-custom-hostname.www.example.co.ke',value:'ownership-token',purpose:'ownership'},
  {type:'TXT',name:'_acme-challenge.www.example.co.ke',value:'tls-token',purpose:'tls-validation'},
]
export const capability:ApexCapability={alias:false,aname:true,cnameFlattening:false,registrarRedirect:true,enterpriseApex:false,actualQuoteApproved:false,securityReviewApproved:false,marginGatePassed:false}
export const prevalidation:CloudflarePrevalidation={binding:{...scope,domainId:'domain-a',hostname:'www.example.co.ke',providerHostnameId:'cf-host-a',lifecycle:'awaiting-dns',providerStatus:'pending',sslStatus:'pending',ownershipVerified:false,instructions:[...records],diagnostics:[],version:1,reconcileFence:1,lastEventSequence:'0',lastOperationId:'prevalidate-a',lastOperationSha256:'a'.repeat(64),createdAt:'2026-07-28T12:00:00.000Z',updatedAt:'2026-07-28T12:00:00.000Z'},records:[...records],customerAccountRequired:false,customerTokenRequired:false,authoritativeDnsRetainedByCustomer:true}
export function fixture(){let now=new Date('2026-07-28T12:00:00.000Z');let iv=0;const repository=new MemoryDomainOperationsRepository();const dns=new DeterministicDnsObserver();const automation=new DeterministicAutomationCredentials();const registrar=new DeterministicRegistrarTransferProvider();const delivery=new DeterministicAuthCodeDelivery();const detach=new DeterministicDetachPort();const vault=new AesGcmRegistrarAuthCodeVault(new DeterministicAuthCodeKeys(),()=>{const value=new Uint8Array(12);value[11]=++iv;return value});const service=new DomainOperationsService({repository,dns,automation,registrar,delivery,detach,authCodes:vault,now:()=>new Date(now)});return{repository,dns,automation,registrar,delivery,detach,service,setNow:(value:string)=>{now=new Date(value)}}}
export async function onboard(value=fixture()){await value.service.onboardCustomerDns(scope,'domain-a',prevalidation,capability);return value}
