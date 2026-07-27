import {
  PublicationAnalyticsCollectRequestSchema,
  PublicationAnalyticsCollectionContextSchema,
  PublicationAnalyticsCollectionResultSchema,
  PublicationAnalyticsRangeSchema,
  PublicationPrivacyAnalyticsExportSchema,
  PublicationPrivacyAnalyticsReportSchema,
  type PublicationAnalyticsCollectionContext,
} from '@core/fuma/publication/analyticsContracts'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import type { PublicationPrivacyAnalyticsService } from './privacyAnalytics'
import { bindPublicationScope, type PublicationRepositoryScope } from './scope'

const ErrorSchema=Type.Object({error:Type.String({minLength:1})},{additionalProperties:false})
function json<T extends TSchema>(schema:T,value:unknown,status=200):Response{const parsed=safeParseValue(schema,value);if(!parsed.ok)throw new Error('Publication privacy analytics response failed validation.');return new Response(JSON.stringify(parsed.value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}})}
async function body<T extends TSchema>(request:Request,schema:T):Promise<Static<T>>{const value=await readValidatedBody(request,schema);if(value===null)throw new TypeError('Publication privacy analytics request is invalid.');return value}
function range(request:Request):Static<typeof PublicationAnalyticsRangeSchema>{const query=new URL(request.url).searchParams;const parsed=safeParseValue(PublicationAnalyticsRangeSchema,{from:query.get('from'),to:query.get('to')});if(!parsed.ok)throw new TypeError('Publication analytics range is invalid.');return parsed.value}
function failure(error:unknown):Response{const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';const status=code==='invalid-range'||code==='invalid-event'||error instanceof TypeError?400:code==='storage-conflict'?409:500;return json(ErrorSchema,{error:status===500?'Publication analytics unavailable.':error instanceof Error?error.message:'Publication analytics request failed.'},status)}

export function createPublicationPrivacyAnalyticsScopedRoutes(service:Pick<PublicationPrivacyAnalyticsService,'report'|'export'>):readonly FumaScopedRouteDeclaration[]{const route=(path:string,handler:(input:FumaScopedRouteHandlerInput)=>Promise<Response>):FumaScopedRouteDeclaration=>Object.freeze({method:'GET',path,permission:'publication.analytics.read',handler:async(input)=>{try{return await handler(input)}catch(error){return failure(error)}}}) as FumaScopedRouteDeclaration;const scope=(input:FumaScopedRouteHandlerInput)=>bindPublicationScope(input.repositoryScope,input.context.profile.id);return Object.freeze([
  route('/publication/privacy-analytics',async(input)=>json(PublicationPrivacyAnalyticsReportSchema,await service.report(scope(input),range(input.request)))),
  route('/publication/privacy-analytics/export',async(input)=>json(PublicationPrivacyAnalyticsExportSchema,await service.export(scope(input),range(input.request)))),
])}

/** Public hosts derive scope and privacy signals from trusted server policy; none are accepted in the event body. */
export class PublicationPrivacyAnalyticsPublicAdapter {
  readonly #service:Pick<PublicationPrivacyAnalyticsService,'collect'>
  constructor(service:Pick<PublicationPrivacyAnalyticsService,'collect'>){this.#service=service}
  async collect(scope:PublicationRepositoryScope,context:PublicationAnalyticsCollectionContext,request:Request):Promise<Response>{try{const trusted=safeParseValue(PublicationAnalyticsCollectionContextSchema,context);if(!trusted.ok)throw new TypeError('Trusted analytics collection context is invalid.');const input=await body(request,PublicationAnalyticsCollectRequestSchema);return json(PublicationAnalyticsCollectionResultSchema,await this.#service.collect(scope,input,trusted.value),202)}catch(error){return failure(error)}}
}
