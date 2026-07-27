import { createHash, createPrivateKey, sign } from 'node:crypto'
import type { OciRequestSigner } from './ociEmailDelivery'

export type OciRsaRequestSignerOptions=Readonly<{
  tenancyId:string
  userId:string
  fingerprint:string
  privateKeyPem:string
  now?:()=>Date
}>

/** OCI Signature v1 signer for body-bearing Email Delivery POST requests. */
export class OciRsaRequestSigner implements OciRequestSigner {
  readonly #keyId:string
  readonly #privateKey:ReturnType<typeof createPrivateKey>|null
  readonly #now:()=>Date
  constructor(options:OciRsaRequestSignerOptions){
    const local=options.tenancyId.startsWith('fake-local-')&&options.userId.startsWith('fake-local-')&&options.fingerprint.startsWith('fake-local-')
    if(!local&&!options.tenancyId.startsWith('ocid1.tenancy.'))throw new TypeError('OCI tenancy OCID is invalid.')
    if(!local&&!options.userId.startsWith('ocid1.user.'))throw new TypeError('OCI user OCID is invalid.')
    if(!local&&!/^[0-9a-f]{2}(?::[0-9a-f]{2})+$/i.test(options.fingerprint))throw new TypeError('OCI key fingerprint is invalid.')
    this.#keyId=`${options.tenancyId}/${options.userId}/${options.fingerprint}`
    this.#privateKey=local?null:createPrivateKey(options.privateKeyPem)
    this.#now=options.now??(()=>new Date())
  }
  async headers(input:Readonly<{method:'POST';url:string;body:string;contentType:string}>):Promise<Readonly<Record<string,string>>>{
    if(this.#privateKey===null)throw new TypeError('Fake-local OCI signing authority cannot submit email.')
    const url=new URL(input.url);const date=this.#now().toUTCString();const bodyBytes=Buffer.from(input.body,'utf8');const digest=createHash('sha256').update(bodyBytes).digest('base64')
    const names='(request-target) host date x-content-sha256 content-type content-length'
    const signing=[`(request-target): ${input.method.toLowerCase()} ${url.pathname}${url.search}`,`host: ${url.host}`,`date: ${date}`,`x-content-sha256: ${digest}`,`content-type: ${input.contentType}`,`content-length: ${bodyBytes.byteLength}`].join('\n')
    const signature=sign('RSA-SHA256',Buffer.from(signing,'utf8'),this.#privateKey).toString('base64')
    return Object.freeze({host:url.host,date,'x-content-sha256':digest,'content-length':String(bodyBytes.byteLength),authorization:`Signature version="1",keyId="${this.#keyId}",algorithm="rsa-sha256",headers="${names}",signature="${signature}"`})
  }
}
