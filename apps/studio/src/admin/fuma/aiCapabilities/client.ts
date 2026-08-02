import { apiRequest, type FetchLike } from '@core/http'
import { Type } from '@core/utils/typeboxHelpers'
import { PlatformCapabilityDashboardWireSchema, RevokeGrantWireSchema, SiteCapabilityDashboardWireSchema } from './contracts'

export type CapabilityDashboardTarget=Readonly<{organizationId:string;workspaceId:string;siteId:string}>
const envelope=<T extends Parameters<typeof Type.Object>[0]>(properties:T)=>Type.Object({result:Type.Object(properties,{additionalProperties:false})},{additionalProperties:false})
const SiteEnvelope=Type.Object({result:SiteCapabilityDashboardWireSchema},{additionalProperties:false})
const PlatformEnvelope=Type.Object({result:PlatformCapabilityDashboardWireSchema},{additionalProperties:false})
const RevokeEnvelope=Type.Object({result:RevokeGrantWireSchema},{additionalProperties:false})
function base(target:CapabilityDashboardTarget){return `/api/fuma/organizations/${encodeURIComponent(target.organizationId)}/workspaces/${encodeURIComponent(target.workspaceId)}/sites/${encodeURIComponent(target.siteId)}`}
export class CapabilityDashboardHttpClient{
  readonly #base:string; readonly #fetch:FetchLike
  constructor(target:CapabilityDashboardTarget,fetchImpl:FetchLike=globalThis.fetch.bind(globalThis)){this.#base=base(target);this.#fetch=fetchImpl}
  async site(cursor:string|null=null){const q=new URLSearchParams({limit:'20'});if(cursor)q.set('cursor',cursor);return (await apiRequest(`${this.#base}/ai/backend-capabilities?${q}`,{schema:SiteEnvelope,credentials:'same-origin',fetchImpl:this.#fetch,fallbackMessage:'Capability dashboard could not be loaded.'})).result}
  async platform(cursor:string|null=null){const q=new URLSearchParams({limit:'20'});if(cursor)q.set('cursor',cursor);return (await apiRequest(`${this.#base}/internal/ai-capabilities?${q}`,{schema:PlatformEnvelope,credentials:'same-origin',fetchImpl:this.#fetch,fallbackMessage:'Protected capability inventory could not be loaded.'})).result}
  async revoke(input:Readonly<{capabilityId:string;capabilityVersion:string;channel:'mcp';grantId:string}>){return (await apiRequest(`${this.#base}/ai/backend-capabilities/revocations`,{method:'POST',body:input,schema:RevokeEnvelope,credentials:'same-origin',fetchImpl:this.#fetch,fallbackMessage:'Capability grant could not be revoked.'})).result}
}
void envelope
