import {
  PublicationAnalyticsRangeSchema,
  PublicationPrivacyAnalyticsExportSchema,
  PublicationPrivacyAnalyticsReportSchema,
  type PublicationAnalyticsRange,
  type PublicationPrivacyAnalyticsExport,
  type PublicationPrivacyAnalyticsReport,
} from '@core/fuma/publication/analyticsContracts'
import { apiRequest, type FetchLike } from '@core/http'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'

const TargetSchema=Type.Object({organizationId:Type.String({minLength:1,maxLength:255}),workspaceId:Type.String({minLength:1,maxLength:255}),siteId:Type.String({minLength:1,maxLength:255}),profileId:Type.String({minLength:1,maxLength:255})},{additionalProperties:false})
export type PublicationAnalyticsClientTarget=Readonly<import('@core/utils/typeboxHelpers').Static<typeof TargetSchema>>

function bindTarget(value:unknown):PublicationAnalyticsClientTarget{const parsed=safeParseValue(TargetSchema,value);if(!parsed.ok)throw new TypeError('Publication analytics client target is invalid.');return Object.freeze(structuredClone(parsed.value))}
function bindRange(value:unknown):PublicationAnalyticsRange{const parsed=safeParseValue(PublicationAnalyticsRangeSchema,value);if(!parsed.ok)throw new TypeError('Publication analytics range is invalid.');return Object.freeze(parsed.value)}
function basePath(target:PublicationAnalyticsClientTarget):string{return `/api/fuma/organizations/${encodeURIComponent(target.organizationId)}/workspaces/${encodeURIComponent(target.workspaceId)}/sites/${encodeURIComponent(target.siteId)}/publication/privacy-analytics`}

export class PublicationPrivacyAnalyticsHttpClient {
  readonly target:PublicationAnalyticsClientTarget
  readonly #fetch:FetchLike
  readonly #base:string
  constructor(target:PublicationAnalyticsClientTarget,fetchImpl:FetchLike=globalThis.fetch.bind(globalThis)){this.target=bindTarget(target);this.#fetch=fetchImpl;this.#base=basePath(this.target)}
  report(range:PublicationAnalyticsRange):Promise<PublicationPrivacyAnalyticsReport>{const value=bindRange(range);return apiRequest(this.#base,{method:'GET',query:value,schema:PublicationPrivacyAnalyticsReportSchema,fetchImpl:this.#fetch,fallbackMessage:'Publication analytics report failed'})}
  export(range:PublicationAnalyticsRange):Promise<PublicationPrivacyAnalyticsExport>{const value=bindRange(range);return apiRequest(`${this.#base}/export`,{method:'GET',query:value,schema:PublicationPrivacyAnalyticsExportSchema,fetchImpl:this.#fetch,fallbackMessage:'Publication analytics export failed'})}
}
