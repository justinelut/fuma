import { createHmac, timingSafeEqual } from 'node:crypto'
import { PublicationEngagementEventSchema } from '@core/fuma/publication'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { PublicationRepositoryScopeSchema } from './scope'

export const PublicationEngagementTokenClaimsSchema=Type.Object({
  kind:PublicationEngagementEventSchema.properties.kind,
  campaignId:PublicationEngagementEventSchema.properties.campaignId,
  memberId:PublicationEngagementEventSchema.properties.memberId,
  targetUrlHashSha256:PublicationEngagementEventSchema.properties.targetUrlHashSha256,
  expiresAt:PublicationEngagementEventSchema.properties.expiresAt,
},{additionalProperties:false})
const SignedEngagementPayloadSchema=Type.Object({scope:PublicationRepositoryScopeSchema,claims:PublicationEngagementTokenClaimsSchema},{additionalProperties:false})
export type SignedEngagementPayload=Readonly<Static<typeof SignedEngagementPayloadSchema>>

export class PublicationEngagementTokenSigner{
  readonly #secret:string
  constructor(secret:string){if(new TextEncoder().encode(secret).byteLength<32)throw new TypeError('Publication engagement secret must contain at least 32 bytes.');this.#secret=secret}
  issue(payload:SignedEngagementPayload):string{const parsed=safeParseValue(SignedEngagementPayloadSchema,payload);if(!parsed.ok)throw new TypeError('Publication engagement payload is invalid.');const body=Buffer.from(JSON.stringify(parsed.value)).toString('base64url');return `${body}.${this.#signature(body)}`}
  verify(token:string,now:Date):SignedEngagementPayload|null{if(token.length>8192)return null;const parts=token.split('.');if(parts.length!==2||!parts[0]||!parts[1]||!this.#equal(parts[1],this.#signature(parts[0])))return null;let decoded:unknown;try{decoded=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'))}catch{return null}const parsed=safeParseValue(SignedEngagementPayloadSchema,decoded);if(!parsed.ok||Date.parse(parsed.value.claims.expiresAt)<=now.getTime())return null;return Object.freeze({scope:Object.freeze(parsed.value.scope),claims:Object.freeze(parsed.value.claims)})}
  #signature(body:string):string{return createHmac('sha256',this.#secret).update('fuma-publication-engagement-v1\0').update(body).digest('base64url')}
  #equal(left:string,right:string):boolean{const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b)}
}
