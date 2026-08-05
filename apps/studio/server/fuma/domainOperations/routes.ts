import { Type, safeParseValue, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import { ApexCapabilitySchema, CloudflarePrevalidationSchema } from '../cloudflare/contracts'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import { domainScopeFromRepository, type DomainScope } from '../domains/contracts'
import { CustomerAutomationCommandSchema, CustomerDnsSettingsSchema, DomainDiagnosticReportSchema, DomainOperationError, RegistrarTransferProjectionSchema, SiteTransferDomainChoiceSchema } from './contracts'
import type { DomainOperationsService } from './service'

const Id=Type.String({minLength:1,maxLength:255,pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]*$'})
const ErrorSchema=Type.Object({error:Type.String({minLength:1,maxLength:500})},{additionalProperties:false})
const OnboardSchema=Type.Object({domainId:Id,prevalidation:CloudflarePrevalidationSchema,capability:ApexCapabilitySchema},{additionalProperties:false})
const InboundWireSchema=Type.Object({transferOperationId:Id,domainId:Id,hostname:Type.String({minLength:3,maxLength:253}),authCode:Type.String({minLength:1,maxLength:4096}),authCodeExpiresAt:Type.String({format:'date-time'})},{additionalProperties:false})
const OutboundWireSchema=Type.Object({transferOperationId:Id,domainId:Id,hostname:Type.String({minLength:3,maxLength:253})},{additionalProperties:false})
const DetachSchema=Type.Object({domainId:Id,operationId:Id},{additionalProperties:false})
const CustomerDnsSettingsViewSchema=Type.Object({
  domainId:CustomerDnsSettingsSchema.properties.domainId,
  hostname:CustomerDnsSettingsSchema.properties.hostname,
  records:CustomerDnsSettingsSchema.properties.records,
  authoritativeDnsRetainedByCustomer:CustomerDnsSettingsSchema.properties.authoritativeDnsRetainedByCustomer,
  customerCloudflareAccountRequired:CustomerDnsSettingsSchema.properties.customerCloudflareAccountRequired,
  customerCloudflareTokenRequired:CustomerDnsSettingsSchema.properties.customerCloudflareTokenRequired,
  automation:CustomerDnsSettingsSchema.properties.automation,
  apexAlternatives:CustomerDnsSettingsSchema.properties.apexAlternatives,
  launchState:CustomerDnsSettingsSchema.properties.launchState,
  version:CustomerDnsSettingsSchema.properties.version,
  operationFence:CustomerDnsSettingsSchema.properties.operationFence,
  updatedAt:CustomerDnsSettingsSchema.properties.updatedAt,
},{additionalProperties:false})
function settingsView(value:import('./contracts').CustomerDnsSettings){return{domainId:value.domainId,hostname:value.hostname,records:value.records,authoritativeDnsRetainedByCustomer:true as const,customerCloudflareAccountRequired:false as const,customerCloudflareTokenRequired:false as const,automation:value.automation,apexAlternatives:value.apexAlternatives,launchState:value.launchState,version:value.version,operationFence:value.operationFence,updatedAt:value.updatedAt}}
function response<T extends TSchema>(schema:T,value:unknown,status=200){const parsed=safeParseValue(schema,value);if(!parsed.ok)throw new Error('Domain operation route response failed strict validation.');return new Response(JSON.stringify(parsed.value),{status,headers:{'cache-control':'no-store','content-type':'application/json; charset=utf-8'}})}
function failure(error:unknown){if(!(error instanceof DomainOperationError))return response(ErrorSchema,{error:'Domain operations are temporarily unavailable.'},500);const status=error.code==='not-found'?404:error.code==='scope'||error.code==='revoked-credential'?403:error.code==='invalid-contract'?400:error.code==='provider'?503:409;return response(ErrorSchema,{error:error.message},status)}
function scope(input:FumaScopedRouteHandlerInput):DomainScope{if(!input.context.capabilities.includes('site.settings')||input.context.profile.id!==input.context.scope.site.profileId||input.context.actor.kind!=='staff'||input.context.actor.impersonator!==null)throw new DomainOperationError('scope','Direct staff site-settings authority is required.');return domainScopeFromRepository(input.repositoryScope,input.context.profile.id)}
async function body<T extends TSchema>(input:FumaScopedRouteHandlerInput,schema:T){const value=await readValidatedBody(input.request,schema);if(value===null)throw new DomainOperationError('invalid-contract','Request contract is invalid.');return value}
export function createDomainOperationsScopedRoutes(service:DomainOperationsService):readonly FumaScopedRouteDeclaration[]{
  const route=(method:FumaScopedRouteDeclaration['method'],path:string,permission:string,handler:(input:FumaScopedRouteHandlerInput)=>Promise<Response>):FumaScopedRouteDeclaration=>Object.freeze({method,path,permission,handler:async(input)=>{try{return await handler(input)}catch(error){return failure(error)}}}) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('GET','/settings/domains/:domainId/operations','site.settings.read',async(input)=>{const value=await service.exactSettings(scope(input),input.params.domainId);return value?response(CustomerDnsSettingsViewSchema,settingsView(value)):response(ErrorSchema,{error:'Domain settings were not found.'},404)}),
    route('POST','/settings/domains/customer-dns/onboard','site.settings.write',async(input)=>{const value=await body(input,OnboardSchema);return response(CustomerDnsSettingsViewSchema,settingsView(await service.onboardCustomerDns(scope(input),value.domainId,value.prevalidation,value.capability)),201)}),
    route('POST','/settings/domains/:domainId/automation','site.settings.write',async(input)=>{
      const command=await body(input,CustomerAutomationCommandSchema)
      const value=await service.attachCustomerAutomation(scope(input),input.params.domainId,command)
      return response(CustomerDnsSettingsViewSchema,settingsView(value))
    }),
    route('POST','/settings/domains/:domainId/diagnose','site.settings.write',async(input)=>response(DomainDiagnosticReportSchema,await service.diagnose(scope(input),input.params.domainId))),
    route('POST','/settings/domains/transfers/inbound','site.settings.write',async(input)=>{const value=await body(input,InboundWireSchema);const authCode=new TextEncoder().encode(value.authCode);return response(RegistrarTransferProjectionSchema,await service.startInbound(scope(input),{...value,authCode}),201)}),
    route('POST','/settings/domains/transfers/outbound','site.settings.write',async(input)=>response(RegistrarTransferProjectionSchema,await service.startOutbound(scope(input),await body(input,OutboundWireSchema)),201)),
    route('POST','/settings/domains/transfers/:transferOperationId/resume','site.settings.write',async(input)=>response(RegistrarTransferProjectionSchema,await service.resume(scope(input),input.params.transferOperationId))),
    route('POST','/settings/domains/transfers/:transferOperationId/reconcile','site.settings.write',async(input)=>response(RegistrarTransferProjectionSchema,await service.reconcile(scope(input),input.params.transferOperationId))),
    route('POST','/settings/domains/transfers/:transferOperationId/rollback','site.settings.write',async(input)=>response(RegistrarTransferProjectionSchema,await service.rollback(scope(input),input.params.transferOperationId))),
    route('POST','/settings/domains/site-transfer-choice','site.settings.write',async(input)=>{const value=await service.siteTransferChoice(scope(input),await body(input,SiteTransferDomainChoiceSchema));return response(SiteTransferDomainChoiceSchema,value.choice,201)}),
    route('POST','/settings/domains/detach','site.settings.write',async(input)=>{const value=await body(input,DetachSchema);return response(CustomerDnsSettingsViewSchema,settingsView(await service.safeDetach(scope(input),value.domainId,value.operationId)))}),
  ])
}
