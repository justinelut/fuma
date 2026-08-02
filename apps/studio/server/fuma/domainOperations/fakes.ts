import type { DomainCredentialAuthority } from '../domains/contracts'
import type { TransferSagaFence } from '../transfers/stepRegistry'
import { DomainOperationError, type CustomerDnsSettings, type DnsObservation, type SiteTransferDomainState } from './contracts'
import type { DnsInstruction } from '../cloudflare/contracts'
import type { RegistrarAuthCodeKeyAuthority } from './authCodeVault'
import type { CustomerDnsDetachPort, DomainAutomationCredentialPort, DomainDnsObservationPort, RegistrarAuthCodeDeliveryPort, RegistrarTransferProvider } from './service'
import type { DomainOutcomeEffectPort, DomainOutcomeOwnerAuthority } from './transferStep'

export class DeterministicDnsObserver implements DomainDnsObservationPort {
  records:readonly DnsInstruction[]=[];tls:DnsObservation['tls']='pending';observedAt='2026-07-28T12:00:00.000Z'
  set(records:readonly DnsInstruction[],tls:DnsObservation['tls'],observedAt=this.observedAt):void{this.records=structuredClone(records);this.tls=tls;this.observedAt=observedAt}
  async observe(_settings:CustomerDnsSettings){return structuredClone({records:this.records,tls:this.tls,observedAt:this.observedAt})}
}
export class DeterministicAutomationCredentials implements DomainAutomationCredentialPort {
  readonly states=new Map<string,'active'|'revoked'>()
  set(credentialId:string,state:'active'|'revoked'):void{this.states.set(credentialId,state)}
  async state(_authority:DomainCredentialAuthority,credentialId:string){return this.states.get(credentialId)??'missing' as const}
}
type ProviderStatus=Readonly<{state:'pending'|'completed'|'failed';ownership:'customer'|'fuma'|'external';failureCode:string|null}>
export class DeterministicRegistrarTransferProvider implements RegistrarTransferProvider {
  readonly locks=new Map<string,boolean>();readonly statuses=new Map<string,ProviderStatus>();readonly calls:string[]=[]
  inboundSubmissions=0;outboundSubmissions=0;cancellations=0;timeoutAfterInboundCommit=false
  setLocked(hostname:string,value:boolean):void{this.locks.set(hostname,value)}
  complete(reference:string,ownership:'fuma'|'external'):void{this.statuses.set(reference,{state:'completed',ownership,failureCode:null})}
  fail(reference:string,code='provider-failed'):void{this.statuses.set(reference,{state:'failed',ownership:'customer',failureCode:code})}
  async registrarLocked(hostname:string){this.calls.push(`lock:${hostname}`);return this.locks.get(hostname)??false}
  async submitInbound(hostname:string,authCode:Uint8Array,idempotencyKey:string){if(!authCode.byteLength)throw new DomainOperationError('provider','Auth code missing.');const reference=`in-${domainId(idempotencyKey)}`;if(!this.statuses.has(reference)){this.inboundSubmissions++;this.statuses.set(reference,{state:'pending',ownership:'customer',failureCode:null})}this.calls.push(`inbound:${hostname}:${idempotencyKey}`);if(this.timeoutAfterInboundCommit)throw new DomainOperationError('provider','Deterministic timeout after commit.');return{providerReference:reference}}
  async submitOutbound(hostname:string,idempotencyKey:string){const reference=`out-${domainId(idempotencyKey)}`;if(!this.statuses.has(reference)){this.outboundSubmissions++;this.statuses.set(reference,{state:'pending',ownership:'customer',failureCode:null})}this.calls.push(`outbound:${hostname}:${idempotencyKey}`);return{providerReference:reference,authCode:new TextEncoder().encode('OUTBOUND-CODE'),expiresAt:'2026-07-29T12:00:00.000Z'}}
  async lookup(idempotencyKey:string){const prefix=idempotencyKey.endsWith(':inbound')?'in-':'out-';const providerReference=`${prefix}${domainId(idempotencyKey)}`;return this.statuses.has(providerReference)?{providerReference}:null}
  async status(reference:string){this.calls.push(`status:${reference}`);return this.statuses.get(reference)??{state:'pending',ownership:'customer',failureCode:null}}
  async cancel(reference:string,idempotencyKey:string){this.cancellations++;this.calls.push(`cancel:${reference}:${idempotencyKey}`);this.statuses.set(reference,{state:'failed',ownership:'customer',failureCode:'cancelled'})}
}
export class DeterministicAuthCodeDelivery implements RegistrarAuthCodeDeliveryPort {
  deliveries=0;failNext=false;readonly identities=new Set<string>()
  async deliver(_hostname:string,authCode:Uint8Array,_expiresAt:string,idempotencyKey:string){if(!authCode.byteLength)throw new DomainOperationError('provider','Outbound auth code is missing.');if(this.failNext){this.failNext=false;throw new Error('deterministic delivery interruption')}if(!this.identities.has(idempotencyKey)){this.identities.add(idempotencyKey);this.deliveries++}}
}
const domainId=(key:string):string=>new Bun.CryptoHasher('sha256').update(key).digest('hex').slice(0,16)
export class DeterministicDetachPort implements CustomerDnsDetachPort{calls:string[]=[];async detach(settings:CustomerDnsSettings,operationId:string){this.calls.push(`${settings.domainId}:${operationId}`);return'detached' as const}}
export class DeterministicDomainOutcomeEffects implements DomainOutcomeEffectPort{
  readonly values=new Map<string,CustomerDnsSettings>();failAfterApply=false
  async apply(state:SiteTransferDomainState,settings:CustomerDnsSettings,_saga:TransferSagaFence){this.values.set(state.choice.domainId,structuredClone(settings));if(this.failAfterApply){this.failAfterApply=false;throw new Error('deterministic death after domain effect')}}
  async inspect(state:SiteTransferDomainState,_saga:TransferSagaFence){return structuredClone(this.values.get(state.choice.domainId)??state.sourceSettings)}
  async restore(state:SiteTransferDomainState,_saga:TransferSagaFence){this.values.set(state.choice.domainId,structuredClone(state.sourceSettings))}
}
export class DeterministicDomainOutcomeOwner implements DomainOutcomeOwnerAuthority{denied=false;async assertCurrent(_state:SiteTransferDomainState,_saga:TransferSagaFence,_phase:'apply'|'verify'|'compensate'){if(this.denied)throw new DomainOperationError('scope','Domain owner generation changed.')}}
export class DeterministicAuthCodeKeys implements RegistrarAuthCodeKeyAuthority{
  readonly keyId='domain-transfer-test-key';#key:CryptoKey|null=null
  async #value(){this.#key??=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(7),{name:'AES-GCM'},false,['encrypt','decrypt']);return this.#key}
  async current(){return{keyId:this.keyId,key:await this.#value()}}
  async exact(keyId:string){return keyId===this.keyId?await this.#value():null}
}
