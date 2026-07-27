import type { DomainCredentialEnvelope, DomainSecretCipher } from './service'

export interface DomainCredentialKeyAuthority {
 current():Promise<Readonly<{keyId:string;key:CryptoKey}>>
 exact(keyId:string):Promise<CryptoKey|null>
}
export class DomainCredentialCipherError extends Error{
 readonly code: 'invalid-key'|'invalid-envelope'|'decrypt-denied';
 constructor(code:'invalid-key'|'invalid-envelope'|'decrypt-denied',message:string){super(message); this.code = code;this.name='DomainCredentialCipherError'}}
function base64(bytes:Uint8Array):string{return Buffer.from(bytes).toString('base64url')}
function bytes(value:string):Uint8Array<ArrayBuffer>{try{return Uint8Array.from(Buffer.from(value,'base64url'))}catch{throw new DomainCredentialCipherError('invalid-envelope','Credential envelope encoding is invalid.')}}

/** AES-256-GCM envelope encryption. Scope is authenticated AAD and cannot be substituted. */
export class AesGcmDomainSecretCipher implements DomainSecretCipher{
 private readonly keys: DomainCredentialKeyAuthority;
 constructor(keys:DomainCredentialKeyAuthority){ this.keys = keys;}
 async encrypt(scope:string,plaintext:Uint8Array){const active=await this.keys.current();if(active.key.algorithm.name!=='AES-GCM'||(active.key.algorithm as AesKeyAlgorithm).length!==256)throw new DomainCredentialCipherError('invalid-key','Domain credential key must be AES-256-GCM.');const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(scope),tagLength:128},active.key,Uint8Array.from(plaintext));return{ciphertext:`v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`,keyId:active.keyId}}
 async decrypt(scope:string,envelope:DomainCredentialEnvelope){const [version,ivText,cipherText,...extra]=envelope.ciphertext.split('.');if(version!=='v1'||!ivText||!cipherText||extra.length)throw new DomainCredentialCipherError('invalid-envelope','Credential envelope shape is invalid.');const key=await this.keys.exact(envelope.keyId);if(!key)throw new DomainCredentialCipherError('decrypt-denied','Credential key is unavailable.');try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(ivText),additionalData:new TextEncoder().encode(scope),tagLength:128},key,bytes(cipherText)))}catch{throw new DomainCredentialCipherError('decrypt-denied','Credential scope, key, or ciphertext authentication failed.')}}
}
