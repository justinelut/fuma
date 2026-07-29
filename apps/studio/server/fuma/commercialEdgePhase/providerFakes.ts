import type { PaystackHttp } from '../paystack/transport'
import type { RegistrarAdapter, RegistrarQuote, DomainRegistration } from '../registrar/service'
import type { DomainCredentialEnvelope, DomainSecretCipher } from '../domains/service'
import { credentialAuthorityKey, type DomainCredentialAuthority } from '../domains/contracts'

export class FakePaystackHttp implements PaystackHttp {
 readonly requests:Readonly<{url:string;method:string;authorizationPresent:boolean}>[]=[]
 private readonly responses=new Map<string,{status:number;body:unknown}>()
 respond(method:'GET'|'POST',url:string,status:number,body:unknown){this.responses.set(`${method} ${url}`,{status,body})}
 async request(input:Readonly<{url:string;method:'GET'|'POST';headers:Readonly<Record<string,string>>;body?:string}>){(this.requests as {url:string;method:string;authorizationPresent:boolean}[]).push({url:input.url,method:input.method,authorizationPresent:Boolean(input.headers.authorization)});return this.responses.get(`${input.method} ${input.url}`)??{status:503,body:{status:false}}}
}

export class FakeRegistrarAdapter implements RegistrarAdapter {
 readonly purchases=new Map<string,{providerReference:string;registeredAt:string;expiresAt:string}>()
 readonly renewals=new Map<string,{providerReference:string;expiresAt:string}>()
 available=true
 async search(){return{available:this.available}}
 async quote(hostname:string,years:number):Promise<RegistrarQuote>{return{quoteId:`quote:${hostname}:${years}`,provider:'fake-registrar',hostname,available:true,currency:'KES',registrationAmountMinor:120000,renewalAmountMinor:130000,periodYears:years,expiresAt:'2099-01-01T00:00:00.000Z',providerQuoteReference:`provider-quote:${hostname}`,termsHash:'a'.repeat(64)}}
 async purchase(quote:RegistrarQuote,_contact:unknown,key:string){const existing=this.purchases.get(key);if(existing)return existing;const value={providerReference:`registration:${quote.hostname}`,registeredAt:'2026-07-26T00:00:00.000Z',expiresAt:'2027-07-26T00:00:00.000Z'};this.purchases.set(key,value);return value}
 async lookupByIdempotency(key:string){return this.purchases.get(key)??null}
 async renew(registration:DomainRegistration,years:number,key:string){const existing=this.renewals.get(key);if(existing)return existing;const value={providerReference:`renew:${registration.registrationId}:${years}`,expiresAt:'2099-01-01T00:00:00.000Z'};this.renewals.set(key,value);return value}
 async lookupRenewalByIdempotency(key:string){return this.renewals.get(key)??null}
}

export type FakeDnsObservation = Readonly<{
 type:'CNAME'|'TXT'|'A'
 name:string
 values:readonly string[]
 ttl:number|null
}>

export class FakeDnsProbe {
 readonly records=new Map<string,FakeDnsObservation>()
 async lookup(type:'CNAME'|'TXT'|'A',name:string){return this.records.get(`${type}:${name}`)??{type,name,values:[],ttl:null}}
 set(observation:FakeDnsObservation){this.records.set(`${observation.type}:${observation.name}`,observation)}
}

/** Test-only reversible envelope. It stores only base64 ciphertext and enforces exact scope on decrypt. */
export class FakeDomainSecretCipher implements DomainSecretCipher {
 private readonly scopes=new Map<string,string>()
 async encrypt(authority:DomainCredentialAuthority,plaintext:Uint8Array){const ciphertext=Buffer.from(plaintext.map((value)=>value^0xa5)).toString('base64');this.scopes.set(ciphertext,credentialAuthorityKey(authority));return{ciphertext,keyId:'fake-test-key'}}
 async decrypt(authority:DomainCredentialAuthority,envelope:DomainCredentialEnvelope){if(this.scopes.get(envelope.ciphertext)!==credentialAuthorityKey(authority))throw new Error('credential scope denied');return new Uint8Array(Buffer.from(envelope.ciphertext,'base64')).map((value)=>value^0xa5)}
}
