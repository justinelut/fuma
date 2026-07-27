import {
  PublicationPreviewIssueCommandSchema,
  PublicationPreviewIssueResultSchema,
  PublicationPreviewRevokeCommandSchema,
  PublicationPublicResolveRequestSchema,
  PublicationPublicResolveResultSchema,
  PublicationScheduleCommandSchema,
  PublicationScheduleRecordSchema,
} from '@core/fuma/publication'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import { bindPublicationScope, type PublicationRepositoryScope } from './scope'
import type { PublicationSchedulingService } from './schedulingAccess'

const BooleanResultSchema = Type.Object({ accepted: Type.Boolean() }, { additionalProperties: false })
function response<T extends TSchema>(schema:T,value:unknown,status=200):Response{const parsed=safeParseValue(schema,value);if(!parsed.ok)throw new Error('Publication scheduling response failed validation.');return new Response(JSON.stringify(parsed.value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}})}
async function body<T extends TSchema>(request:Request,schema:T):Promise<Static<T>>{const value=await readValidatedBody(request,schema);if(value===null)throw new TypeError('Publication scheduling request is invalid.');return value}
function failure(error:unknown):Response{const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';const status=code==='not-found'?404:code==='preview-expired'||code==='invalid-preview'?403:code==='conflict'||code==='invalid-schedule'?409:400;return response(Type.Object({error:Type.String()},{additionalProperties:false}),{error:status===404?'Resource not found.':error instanceof Error?error.message:'Publication scheduling request failed.'},status)}

export function createPublicationSchedulingScopedRoutes(service: PublicationSchedulingService): readonly FumaScopedRouteDeclaration[] {
  const route=(method:FumaScopedRouteDeclaration['method'],path:string,permission:string,handler:(input:FumaScopedRouteHandlerInput)=>Promise<Response>):FumaScopedRouteDeclaration=>Object.freeze({method,path,permission,handler:async(input)=>{try{return await handler(input)}catch(error){return failure(error)}}}) as FumaScopedRouteDeclaration
  const scope=(input:FumaScopedRouteHandlerInput)=>bindPublicationScope(input.repositoryScope,input.context.profile.id)
  return Object.freeze([
    route('POST','/publication/schedules','publication.posts.schedule',async(input)=>response(PublicationScheduleRecordSchema,await service.schedule(scope(input),await body(input.request,PublicationScheduleCommandSchema)),201)),
    route('POST','/publication/preview-tokens','publication.posts.write',async(input)=>response(PublicationPreviewIssueResultSchema,await service.issuePreview(scope(input),await body(input.request,PublicationPreviewIssueCommandSchema)),201)),
    route('POST','/publication/preview-tokens/revoke','publication.posts.write',async(input)=>{const command=await body(input.request,PublicationPreviewRevokeCommandSchema);return response(BooleanResultSchema,{accepted:await service.revokePreview(scope(input),command.tokenId)})}),
  ])
}

/** Public hosts must supply a server-derived exact scope; the request cannot carry tenancy or clock authority. */
export class PublicationPublicAccessAdapter {
  readonly #service:Pick<PublicationSchedulingService,'resolve'>
  constructor(service:Pick<PublicationSchedulingService,'resolve'>){this.#service=service}
  async resolve(scope:PublicationRepositoryScope,memberIdentityId:string|null,origin:string,request:Request):Promise<Response>{try{return response(PublicationPublicResolveResultSchema,await this.#service.resolve(scope,await body(request,PublicationPublicResolveRequestSchema),memberIdentityId,origin))}catch(error){return failure(error)}}
}
