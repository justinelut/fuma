import { Value } from '@core/utils/typeboxHelpers'
import { ApexCapabilitySchema, CloudflarePrevalidationSchema, type ApexCapability, type CloudflarePrevalidation, type DnsInstruction } from '../cloudflare/contracts'
import { DomainCredentialAuthoritySchema, DomainScopeSchema, normalizeDomainHostname, sameDomainScope, type DomainCredentialAuthority, type DomainScope } from '../domains/contracts'
import { CustomerAutomationCommandSchema, CustomerDnsSettingsSchema, DomainDiagnosticReportSchema, DomainOperationError, InboundTransferCommandSchema, OutboundTransferCommandSchema, RegistrarTransferProjectionSchema, RegistrarTransferSchema, SiteTransferDomainChoiceSchema, domainOperationHash, parseDomainOperations, type CustomerDnsSettings, type DomainDiagnostic, type DomainDiagnosticReport, type InboundTransferCommand, type OutboundTransferCommand, type RegistrarTransfer, type RegistrarTransferProjection, type SiteTransferDomainChoice, type SiteTransferDomainState } from './contracts'
import type { RegistrarAuthCodeAuthority, RegistrarAuthCodeVault } from './authCodeVault'
import type { DomainOperationsRepository } from './repository'

export interface DomainDnsObservationPort { observe(settings: CustomerDnsSettings): Promise<unknown> }
export interface DomainAutomationCredentialPort { state(authority: DomainCredentialAuthority, credentialId: string): Promise<'active'|'revoked'|'missing'> }
export interface RegistrarTransferProvider {
  registrarLocked(hostname: string): Promise<boolean>
  submitInbound(hostname: string, authCode: Uint8Array, idempotencyKey: string): Promise<Readonly<{ providerReference: string }>>
  submitOutbound(hostname: string, idempotencyKey: string): Promise<Readonly<{ providerReference: string; authCode: Uint8Array; expiresAt: string }>>
  lookup(idempotencyKey: string): Promise<Readonly<{ providerReference: string }> | null>
  status(providerReference: string): Promise<Readonly<{ state: 'pending'|'completed'|'failed'; ownership: 'customer'|'fuma'|'external'; failureCode: string|null }>>
  cancel(providerReference: string, idempotencyKey: string): Promise<void>
}
export interface RegistrarAuthCodeDeliveryPort { deliver(hostname: string, authCode: Uint8Array, expiresAt: string, idempotencyKey: string): Promise<void> }
export interface CustomerDnsDetachPort { detach(settings: CustomerDnsSettings, operationId: string): Promise<'detached'> }
export type DomainOperationsServiceOptions = Readonly<{ repository: DomainOperationsRepository; dns: DomainDnsObservationPort; automation: DomainAutomationCredentialPort; registrar: RegistrarTransferProvider; delivery: RegistrarAuthCodeDeliveryPort; authCodes: RegistrarAuthCodeVault; detach: CustomerDnsDetachPort; now?: () => Date }>

const exactScope = (scope: DomainScope, value: DomainScope): void => { if (!Value.Check(DomainScopeSchema, scope) || !sameDomainScope(scope, value)) throw new DomainOperationError('scope', 'Exact domain owner authority is required.') }
const nowIso = (now: () => Date): string => { const value = now(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new DomainOperationError('conflict', 'Domain operations clock is invalid.'); return value.toISOString() }
const recordKey = (record: DnsInstruction): string => `${record.type}:${record.name}:${record.purpose}`
const sameRecord = (left: DnsInstruction, right: DnsInstruction): boolean => recordKey(left) === recordKey(right) && left.value === right.value
const authority = (scope: DomainScope, transfer: Pick<RegistrarTransfer,'transferOperationId'|'domainId'|'direction'>): RegistrarAuthCodeAuthority => ({ scope, transferOperationId: transfer.transferOperationId, domainId: transfer.domainId, direction: transfer.direction })
function alternatives(hostname: string, capability: ApexCapability) {
  const apex = hostname.endsWith('.co.ke') ? hostname.split('.').length === 3 : hostname.split('.').length === 2
  const rows = [
    { kind: 'www-cname' as const, available: true, instruction: `Use www.${hostname} with the CNAME-first launch path.` },
    { kind: 'alias' as const, available: capability.alias, instruction: 'Use provider-supported ALIAS at the apex.' },
    { kind: 'aname' as const, available: capability.aname, instruction: 'Use provider-supported ANAME at the apex.' },
    { kind: 'cname-flattening' as const, available: capability.cnameFlattening, instruction: 'Use provider-supported CNAME flattening at the apex.' },
    { kind: 'registrar-redirect' as const, available: capability.registrarRedirect, instruction: `Redirect ${hostname} to www.${hostname} at the registrar.` },
  ]
  return Object.freeze(apex ? rows : rows.slice(0, 1))
}
function projection(value: RegistrarTransfer): RegistrarTransferProjection {
  return parseDomainOperations(RegistrarTransferProjectionSchema, { transferOperationId: value.transferOperationId, domainId: value.domainId, hostname: value.hostname, direction: value.direction, state: value.lifecycle, registrarLocked: value.registrarLocked, authCodeExpiresAt: value.authCode?.expiresAt ?? null, ownership: value.ownership, renewalHandoff: value.renewalHandoff, authCodeDelivery:value.authCodeDelivery, version: value.version, failureCode: value.failureCode, updatedAt: value.updatedAt }, 'Registrar transfer projection') as RegistrarTransferProjection
}

export class DomainOperationsService {
  readonly #repository: DomainOperationsRepository; readonly #dns: DomainDnsObservationPort; readonly #automation: DomainAutomationCredentialPort
  readonly #registrar: RegistrarTransferProvider; readonly #delivery: RegistrarAuthCodeDeliveryPort; readonly #authCodes: RegistrarAuthCodeVault; readonly #detach: CustomerDnsDetachPort; readonly #now: () => Date
  constructor(options: DomainOperationsServiceOptions) { this.#repository=options.repository; this.#dns=options.dns; this.#automation=options.automation; this.#registrar=options.registrar; this.#delivery=options.delivery; this.#authCodes=options.authCodes; this.#detach=options.detach; this.#now=options.now ?? (()=>new Date()) }

  async onboardCustomerDns(scope: DomainScope, domainId: string, raw: unknown, capabilityRaw: unknown): Promise<CustomerDnsSettings> {
    const prevalidation = parseDomainOperations(CloudflarePrevalidationSchema, raw, 'Cloudflare customer-DNS onboarding') as CloudflarePrevalidation
    const capability = parseDomainOperations(ApexCapabilitySchema, capabilityRaw, 'Apex provider capability') as ApexCapability
    exactScope(scope, prevalidation.binding); if (prevalidation.binding.domainId !== domainId) throw new DomainOperationError('scope', 'Cloudflare binding belongs to another domain.')
    if (prevalidation.customerAccountRequired || prevalidation.customerTokenRequired || !prevalidation.authoritativeDnsRetainedByCustomer) throw new DomainOperationError('invalid-contract', 'Customer DNS onboarding must retain authoritative DNS without a Cloudflare account or token.')
    const prior = await this.#repository.settings(scope, domainId); const at = nowIso(this.#now)
    const value = parseDomainOperations(CustomerDnsSettingsSchema, { ...scope, domainId, hostname: prevalidation.binding.hostname, records: prevalidation.records, authoritativeDnsRetainedByCustomer: true, customerCloudflareAccountRequired: false, customerCloudflareTokenRequired: false, automation: prior?.automation ?? { mode:'manual', credentialId:null, credentialState:null }, apexAlternatives: alternatives(prevalidation.binding.hostname, capability), launchState: prevalidation.binding.sslStatus === 'active' ? 'active' : prevalidation.binding.ownershipVerified ? 'awaiting-tls' : 'awaiting-records', version: (prior?.version ?? 0)+1, operationFence:(prior?.operationFence ?? 0)+1, updatedAt:at }, 'Customer DNS settings') as CustomerDnsSettings
    return await this.#repository.saveSettings(scope, value, prior?.version ?? null)
  }

  async attachCustomerAutomation(scope: DomainScope, domainId: string, raw: unknown): Promise<CustomerDnsSettings> {
    const command = parseDomainOperations(CustomerAutomationCommandSchema, raw, 'Customer automation command') as { credentialId:string; authority:DomainCredentialAuthority }
    const settings = await this.#requiredSettings(scope,domainId); exactScope(scope, settings)
    if (!Value.Check(DomainCredentialAuthoritySchema, command.authority) || command.authority.scope !== 'customer-automation' || command.authority.platformId!==scope.platformId || command.authority.organizationId!==scope.organizationId || command.authority.workspaceId!==scope.workspaceId || command.authority.siteId!==scope.siteId || command.authority.ownerKey!==scope.ownerKey || command.authority.ownerGeneration!==scope.generation || command.authority.profileId!==scope.profileId) throw new DomainOperationError('scope','Customer automation credential authority is not exact.')
    const state = await this.#automation.state(command.authority,command.credentialId); if(state!=='active') throw new DomainOperationError('revoked-credential','Customer automation credential is revoked or missing.')
    const next = parseDomainOperations(CustomerDnsSettingsSchema,{...settings,automation:{mode:'customer-managed',credentialId:command.credentialId,credentialState:'active'},version:settings.version+1,operationFence:settings.operationFence+1,updatedAt:nowIso(this.#now)},'Customer automation settings') as CustomerDnsSettings
    return await this.#repository.saveSettings(scope,next,settings.version)
  }

  async diagnose(scope: DomainScope, domainId: string): Promise<DomainDiagnosticReport> {
    const settings=await this.#requiredSettings(scope,domainId); const observation=parseDomainOperations((await import('./contracts')).DnsObservationSchema,await this.#dns.observe(settings),'Observed customer DNS')
    const actual=new Map((observation.records as readonly DnsInstruction[]).map((record)=>[recordKey(record),record])); const diagnostics:DomainDiagnostic[]=[]
    for(const expected of settings.records){const observed=actual.get(recordKey(expected));if(!observed)diagnostics.push({code:'record-missing',severity:'error',message:`${expected.type} record for ${expected.purpose} is missing.`,expected,observedValue:null});else if(!sameRecord(expected,observed))diagnostics.push({code:'record-wrong-value',severity:'error',message:`${expected.type} record for ${expected.purpose} has the wrong value.`,expected,observedValue:observed.value})}
    if(observation.tls==='pending')diagnostics.push({code:'tls-pending',severity:'warning',message:'TLS certificate issuance is pending.',expected:null,observedValue:null})
    if(observation.tls==='failed')diagnostics.push({code:'tls-failed',severity:'error',message:'TLS certificate issuance failed.',expected:null,observedValue:null})
    if(settings.automation.mode==='customer-managed'){const credentialAuthority={scope:'customer-automation' as const,platformId:scope.platformId,organizationId:scope.organizationId,workspaceId:scope.workspaceId,siteId:scope.siteId,ownerKey:scope.ownerKey,ownerGeneration:scope.generation,profileId:scope.profileId};const state=await this.#automation.state(credentialAuthority,settings.automation.credentialId);if(state!=='active')diagnostics.push({code:'automation-credential-revoked',severity:'warning',message:'Optional customer-managed DNS automation credential is revoked; manual DNS remains available.',expected:null,observedValue:null})}
    if(!diagnostics.length)diagnostics.push({code:'healthy',severity:'info',message:'Exact DNS records and TLS are healthy.',expected:null,observedValue:null})
    return parseDomainOperations(DomainDiagnosticReportSchema,{domainId,hostname:settings.hostname,diagnostics,observedAt:observation.observedAt,canCutover:diagnostics.every((entry)=>entry.severity!=='error')&&observation.tls==='active'},'Domain diagnostic report') as DomainDiagnosticReport
  }

  async startInbound(scope:DomainScope,raw:unknown):Promise<RegistrarTransferProjection>{const command=parseDomainOperations(InboundTransferCommandSchema,raw,'Inbound registrar transfer') as InboundTransferCommand;return projection(await this.#start(scope,command,'inbound'))}
  async startOutbound(scope:DomainScope,raw:unknown):Promise<RegistrarTransferProjection>{const command=parseDomainOperations(OutboundTransferCommandSchema,raw,'Outbound registrar transfer') as OutboundTransferCommand;return projection(await this.#start(scope,command,'outbound'))}
  async #start(scope:DomainScope,command:InboundTransferCommand|OutboundTransferCommand,direction:'inbound'|'outbound'):Promise<RegistrarTransfer>{
    const host=normalizeDomainHostname(command.hostname).hostname;const settings=await this.#requiredSettings(scope,command.domainId);if(settings.hostname!==host)throw new DomainOperationError('scope','Registrar transfer hostname does not match domain settings.')
    const existing=await this.#repository.registrarTransfer(scope,command.transferOperationId);const authCodeFingerprint='authCode' in command?new Bun.CryptoHasher('sha256').update(command.authCode).digest('hex'):null;const sanitized={...command,authCode:'authCode' in command?'[REDACTED]':undefined,authCodeFingerprint,direction}
    const hash=domainOperationHash(sanitized);if(existing){if(existing.operationSha256!==hash)throw new DomainOperationError('conflict','Registrar transfer identity changed on replay.');return existing}
    let envelope=null
    if(direction==='inbound'){
      const inbound=command as InboundTransferCommand;if(Date.parse(inbound.authCodeExpiresAt)<=this.#now().getTime()){inbound.authCode.fill(0);throw new DomainOperationError('expired-auth-code','Registrar auth code expired.')}
      try{envelope=await this.#authCodes.seal(authority(scope,{...command,direction}),inbound.authCode,inbound.authCodeExpiresAt)}finally{inbound.authCode.fill(0)}
    }
    const locked=await this.#registrar.registrarLocked(host);const at=nowIso(this.#now)
    const value=parseDomainOperations(RegistrarTransferSchema,{...scope,transferOperationId:command.transferOperationId,domainId:command.domainId,hostname:host,direction,lifecycle:locked?'awaiting-unlock':direction==='inbound'?'awaiting-auth-code':'requested',registrarLocked:locked,authCode:envelope,providerReference:null,ownership:'customer',renewalHandoff:'pending',authCodeDelivery:direction==='inbound'?'not-applicable':'pending',version:1,fence:1,operationSha256:hash,failureCode:null,createdAt:at,updatedAt:at},'Registrar transfer') as RegistrarTransfer
    return await this.#repository.saveRegistrarTransfer(scope,value,null)
  }

  async resume(scope:DomainScope,id:string):Promise<RegistrarTransferProjection>{let current=await this.#requiredTransfer(scope,id);if(['completed','rolled-back','detached'].includes(current.lifecycle))return projection(current)
    const locked=await this.#registrar.registrarLocked(current.hostname);if(locked){current=await this.#advance(scope,current,{lifecycle:'awaiting-unlock',registrarLocked:true,failureCode:null},'registrar-lock');return projection(current)}
    if(current.direction==='inbound'){
      if(!current.authCode)throw new DomainOperationError('not-found','Inbound registrar auth code is unavailable.')
      if(Date.parse(current.authCode.expiresAt)<=this.#now().getTime()){const expired=await this.#advance(scope,current,{lifecycle:'failed',registrarLocked:false,authCode:null,failureCode:'expired-auth-code'},'expired-auth-code');await this.#authCodes.destroy(authority(scope,current),current.authCode);throw new DomainOperationError('expired-auth-code',`Registrar auth code expired at ${expired.updatedAt}.`)}
      const idempotencyKey=`domain-transfer:${id}:inbound`;let result:Readonly<{providerReference:string}>
      try{result=await this.#authCodes.use(authority(scope,current),current.authCode,(secret)=>this.#registrar.submitInbound(current.hostname,secret,idempotencyKey))}catch(error){const found=await this.#registrar.lookup(idempotencyKey);if(!found)throw error;result=found}await this.#authCodes.destroy(authority(scope,current),current.authCode)
      current=await this.#advance(scope,current,{lifecycle:'submitted',registrarLocked:false,authCode:null,providerReference:result.providerReference,failureCode:null},'inbound-submitted')
    }else{
      if(!current.authCode||!current.providerReference){const result=await this.#registrar.submitOutbound(current.hostname,`domain-transfer:${id}:outbound`);const envelope=await this.#authCodes.seal(authority(scope,current),result.authCode,result.expiresAt);result.authCode.fill(0);current=await this.#advance(scope,current,{lifecycle:'awaiting-auth-code',registrarLocked:false,authCode:envelope,providerReference:result.providerReference,authCodeDelivery:'pending',failureCode:null},'outbound-auth-code-sealed')}
      const outboundCode=current.authCode;if(!outboundCode)throw new DomainOperationError('not-found','Encrypted outbound registrar auth code is unavailable.')
      if(Date.parse(outboundCode.expiresAt)<=this.#now().getTime()){await this.#authCodes.destroy(authority(scope,current),outboundCode);await this.#advance(scope,current,{lifecycle:'failed',authCode:null,failureCode:'expired-auth-code'},'outbound-auth-code-expired');throw new DomainOperationError('expired-auth-code','Outbound registrar auth code expired before protected delivery.')}
      await this.#authCodes.use(authority(scope,current),outboundCode,(secret)=>this.#delivery.deliver(current.hostname,secret,outboundCode.expiresAt,`domain-transfer:${id}:outbound-delivery`));await this.#authCodes.destroy(authority(scope,current),outboundCode);current=await this.#advance(scope,current,{lifecycle:'submitted',authCode:null,authCodeDelivery:'delivered',failureCode:null},'outbound-auth-code-delivered')
    }
    return projection(current)
  }

  async reconcile(scope:DomainScope,id:string):Promise<RegistrarTransferProjection>{const current=await this.#requiredTransfer(scope,id);if(current.lifecycle==='completed')return projection(current);if(current.lifecycle!=='submitted'||!current.providerReference)throw new DomainOperationError('conflict','Registrar transfer is not submitted.')
    const status=await this.#registrar.status(current.providerReference);if(status.state==='pending')return projection(current)
    if(status.state==='failed')return projection(await this.#advance(scope,current,{lifecycle:'failed',failureCode:status.failureCode??'provider-failed'},'provider-failed'))
    const expected=current.direction==='inbound'?'fuma':'external';if(status.ownership!==expected)return projection(await this.#advance(scope,current,{lifecycle:'failed',failureCode:'ownership-mismatch',ownership:status.ownership},'ownership-mismatch'))
    if(current.authCode)await this.#authCodes.destroy(authority(scope,current),current.authCode)
    return projection(await this.#advance(scope,current,{lifecycle:'completed',authCode:null,ownership:status.ownership,renewalHandoff:current.direction==='inbound'?'fuma-managed':'customer-managed',failureCode:null},'ownership-changed'))
  }

  async rollback(scope:DomainScope,id:string):Promise<RegistrarTransferProjection>{let current=await this.#requiredTransfer(scope,id);if(current.lifecycle==='rolled-back')return projection(current);if(current.lifecycle==='completed')throw new DomainOperationError('unsafe-detachment','Completed registrar ownership change cannot be rolled back automatically.')
    current=await this.#advance(scope,current,{lifecycle:'rolling-back'},'rollback-start');if(current.providerReference)await this.#registrar.cancel(current.providerReference,`domain-transfer:${id}:rollback`);if(current.authCode)await this.#authCodes.destroy(authority(scope,current),current.authCode)
    return projection(await this.#advance(scope,current,{lifecycle:'rolled-back',authCode:null,providerReference:null,renewalHandoff:'not-applicable'},'rolled-back'))
  }

  async siteTransferChoice(scope: DomainScope, raw: unknown): Promise<SiteTransferDomainState> {
    const choice = parseDomainOperations(SiteTransferDomainChoiceSchema, raw, 'Site-transfer domain choice') as SiteTransferDomainChoice
    exactScope(scope, choice.source)
    if (choice.source.platformId !== choice.destination.platformId || choice.source.siteId !== choice.destination.siteId
      || (choice.source.organizationId === choice.destination.organizationId && choice.source.workspaceId === choice.destination.workspaceId)
      || choice.source.ownerKey === choice.destination.ownerKey || choice.destination.generation <= choice.source.generation) {
      throw new DomainOperationError('scope', 'Site-transfer domain choice requires the exact new owner generation for the same site.')
    }
    const settings = await this.#requiredSettings(scope, choice.domainId)
    return await this.#repository.recordDomainChoice(choice, settings)
  }

  async safeDetach(scope:DomainScope,domainId:string,operationId:string):Promise<CustomerDnsSettings>{const settings=await this.#requiredSettings(scope,domainId);const active=await this.#repository.activeRegistrarTransfer(scope,domainId);if(active)throw new DomainOperationError('unsafe-detachment','Domain cannot detach while registrar ownership transfer is active.')
    await this.#detach.detach(settings,operationId);const next=parseDomainOperations(CustomerDnsSettingsSchema,{...settings,launchState:'detached',version:settings.version+1,operationFence:settings.operationFence+1,updatedAt:nowIso(this.#now)},'Detached domain settings') as CustomerDnsSettings;return await this.#repository.saveSettings(scope,next,settings.version)}
  async exactSettings(scope:DomainScope,domainId:string){return await this.#repository.settings(scope,domainId)}
  async exactTransfer(scope:DomainScope,id:string){const value=await this.#repository.registrarTransfer(scope,id);return value?projection(value):null}
  async #requiredSettings(scope:DomainScope,id:string){const value=await this.#repository.settings(scope,id);if(!value)throw new DomainOperationError('not-found','Customer DNS settings are unavailable.');exactScope(scope,value);return value}
  async #requiredTransfer(scope:DomainScope,id:string){const value=await this.#repository.registrarTransfer(scope,id);if(!value)throw new DomainOperationError('not-found','Registrar transfer is unavailable.');exactScope(scope,value);return value}
  async #advance(scope:DomainScope,current:RegistrarTransfer,patch:Partial<RegistrarTransfer>,reason:string){const at=nowIso(this.#now);const next=parseDomainOperations(RegistrarTransferSchema,{...current,...patch,version:current.version+1,fence:current.fence+1,updatedAt:at,operationSha256:current.operationSha256},'Advanced registrar transfer') as RegistrarTransfer;void reason;return await this.#repository.saveRegistrarTransfer(scope,next,current.version)}
}
