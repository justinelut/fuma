import { createHmac, timingSafeEqual } from 'node:crypto'
import { OciEmailProviderEventSchema, parsePublicationContract, type OciEmailProviderEvent } from '@core/fuma/publication'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import { clientIp } from '../../auth/security'
import type { FumaRedisCoordination } from '../redis'
import { PublicationRepositoryScopeSchema, type PublicationRepositoryScope } from './scope'
import type { PublicationDeliverabilityService } from './services'
import type { PublicationUnsubscribeTokenSigner } from './unsubscribeTokens'

const UNSUBSCRIBE_PATH = '/_fuma/publication/unsubscribe'
const OCI_EVENTS_PATH = '/_fuma/publication/oci-events'
const MAX_EVENT_BYTES = 256 * 1024

export interface PublicationProviderEventVerifier {
  verify(rawBody: Uint8Array, headers: Headers): Promise<boolean>
}

export class HmacPublicationProviderEventVerifier implements PublicationProviderEventVerifier {
  readonly #secret: string
  constructor(secret: string) {
    if (new TextEncoder().encode(secret).byteLength < 32) throw new TypeError('Publication provider event secret must contain at least 32 bytes.')
    this.#secret = secret
  }
  async verify(rawBody: Uint8Array, headers: Headers): Promise<boolean> {
    const supplied = headers.get('x-fuma-oci-signature')?.replace(/^sha256=/, '') ?? ''
    const expected = createHmac('sha256', this.#secret).update(rawBody).digest('hex')
    const left = Buffer.from(supplied, 'utf8');const right = Buffer.from(expected, 'utf8')
    return left.length === right.length && timingSafeEqual(left, right)
  }
}

interface ProviderScopeRow { platform_id:string;organization_id:string;workspace_id:string;site_id:string;owner_key:string;owner_generation:string|number|bigint;profile_id:string }

export interface PublicationPublicAuthority {
  scopeForProviderMessage(providerMessageId:string, recipientEmail:string):Promise<PublicationRepositoryScope|null>
}

export class PostgresPublicationPublicAuthority implements PublicationPublicAuthority {
  readonly #db:DbClient
  constructor(db:DbClient){this.#db=db}
  async scopeForProviderMessage(providerMessageId:string,recipientEmail:string):Promise<PublicationRepositoryScope|null>{
    const {rows}=await this.#db<ProviderScopeRow>`select d.platform_id,k.organization_id,k.workspace_id,k.site_id,d.owner_key,d.owner_generation,d.profile_id from fuma_publication_campaign_deliveries d join fuma_tenant_owner_keys k on k.platform_id=d.platform_id and k.owner_key=d.owner_key and k.generation=d.owner_generation where d.provider_message_id=${providerMessageId} and lower(d.recipient_email)=lower(${recipientEmail}) and k.state='active' and k.transfer_id is null and k.transfer_lock_id is null and k.transfer_fence is null limit 2`
    if(rows.length!==1)return null
    const row=rows[0]!;const parsed=safeParseValue(PublicationRepositoryScopeSchema,{platformId:row.platform_id,organizationId:row.organization_id,workspaceId:row.workspace_id,siteId:row.site_id,ownerKey:row.owner_key,generation:Number(row.owner_generation),state:'active',transferFence:null,profileId:row.profile_id})
    return parsed.ok?Object.freeze(parsed.value):null
  }
}

export type PublicationPublicBoundaryOptions=Readonly<{
  signer:PublicationUnsubscribeTokenSigner
  deliverability:PublicationDeliverabilityService
  authority:PublicationPublicAuthority
  verifier:PublicationProviderEventVerifier
  redis:Pick<FumaRedisCoordination,'consumeLimit'>
  now?:()=>Date
}>

function response(status=202):Response{return new Response(JSON.stringify({accepted:true}),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
function key(request:Request,kind:string):string{return `publication-public:${kind}:${clientIp(request)??'unknown'}`}

export class PublicationPublicBoundary {
  readonly #options:PublicationPublicBoundaryOptions
  constructor(options:PublicationPublicBoundaryOptions){this.#options=options}
  handles(request:Request):boolean{const path=new URL(request.url).pathname;return path===UNSUBSCRIBE_PATH||path===OCI_EVENTS_PATH}
  async handle(request:Request):Promise<Response|null>{
    const url=new URL(request.url)
    if(url.pathname===UNSUBSCRIBE_PATH)return await this.#unsubscribe(request,url)
    if(url.pathname===OCI_EVENTS_PATH)return await this.#event(request)
    return null
  }
  async #unsubscribe(request:Request,url:URL):Promise<Response>{
    if(request.method!=='GET'&&request.method!=='POST')return response(405)
    const limit=await this.#options.redis.consumeLimit(key(request,'unsubscribe'),{limit:20,windowMs:60_000})
    if(!limit.allowed)return response(429)
    const token=url.searchParams.get('token')??''
    const payload=this.#options.signer.verify(token,(this.#options.now??(()=>new Date()))())
    if(payload){try{await this.#options.deliverability.unsubscribe(payload.scope,payload.claims.tokenId)}catch(_error){/* non-oracular */}}
    return response()
  }
  async #event(request:Request):Promise<Response>{
    if(request.method!=='POST')return response(405)
    const limit=await this.#options.redis.consumeLimit(key(request,'oci-events'),{limit:600,windowMs:60_000})
    if(!limit.allowed)return response(429)
    const bytes=new Uint8Array(await request.arrayBuffer())
    if(bytes.byteLength===0||bytes.byteLength>MAX_EVENT_BYTES||!await this.#options.verifier.verify(bytes,request.headers))return response(401)
    let candidate:unknown
    try{candidate=JSON.parse(new TextDecoder().decode(bytes))}catch(_error){return response(400)}
    const parsed=safeParseValue(OciEmailProviderEventSchema,candidate)
    if(!parsed.ok)return response(400)
    const event:OciEmailProviderEvent=parsePublicationContract('OCI provider event',OciEmailProviderEventSchema,parsed.value)
    const scope=await this.#options.authority.scopeForProviderMessage(event.providerMessageId,event.recipientEmail)
    if(!scope)return response()
    await this.#options.deliverability.ingestOciEvent(scope,new TextDecoder().decode(bytes),event)
    return response()
  }
}
