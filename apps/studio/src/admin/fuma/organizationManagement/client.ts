import{Type,type Static}from'@core/utils/typeboxHelpers';import{apiRequest,type FetchLike}from'@core/http'
const S={additionalProperties:false}as const,Id=Type.String({minLength:1,maxLength:255}),Workspace=Type.Object({id:Id,organizationId:Id,slug:Type.String(),name:Type.String(),status:Type.Union([Type.Literal('active'),Type.Literal('archived')]),isDefault:Type.Boolean(),createdAt:Type.String(),updatedAt:Type.String()},S)
const Projection=Type.Object({organization:Type.Object({id:Id,name:Type.String(),slug:Type.String()},S),actorRole:Type.String(),members:Type.Array(Type.Object({id:Id,userId:Id,name:Type.String(),email:Type.String(),role:Type.String(),createdAt:Type.String()},S)),invitations:Type.Array(Type.Object({id:Id,email:Type.String(),role:Type.Union([Type.String(),Type.Null()]),status:Type.String(),expiresAt:Type.String(),createdAt:Type.String()},S)),workspaces:Type.Array(Workspace)},S)
export type OrganizationManagementProjection=Static<typeof Projection>
export class OrganizationManagementClient{readonly#organizationId:string;readonly#fetch:FetchLike;constructor(organizationId:string,fetchImpl:FetchLike=globalThis.fetch.bind(globalThis)){this.#organizationId=organizationId;this.#fetch=fetchImpl}load(){return apiRequest(`/api/fuma/management/workspaces?organizationId=${encodeURIComponent(this.#organizationId)}`,{schema:Projection,fetchImpl:this.#fetch,fallbackMessage:'Organization management could not be loaded.'})}workspace(command:Record<string,unknown>){return apiRequest('/api/fuma/management/workspaces',{method:'POST',body:{...command,organizationId:this.#organizationId},schema:Type.Object({workspace:Workspace},S),fetchImpl:this.#fetch,fallbackMessage:'Workspace change failed.'})}async organization(path:string,body:Record<string,unknown>){const response=await this.#fetch(`/api/auth/organization/${path}`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({...body,organizationId:this.#organizationId})});const value=await response.json().catch(()=>null);if(!response.ok)throw new Error(value&&typeof value==='object'&&'error'in value?String(value.error):'Organization change failed.');return value}invite(email:string,role:'admin'|'member'){return this.organization('invite-member',{email,role})}updateRole(memberId:string,role:'admin'|'member'){return this.organization('update-member-role',{memberId,role})}remove(memberId:string){return this.organization('remove-member',{memberIdOrEmail:memberId})}cancelInvitation(invitationId:string){return this.organization('cancel-invitation',{invitationId})}updateOrganization(name:string,slug:string){return this.organization('update',{data:{name,slug}})}
  /**
   * Create a NEW organization.
   *
   * Deliberately does NOT go through `organization()`, which merges the CURRENT organizationId into
   * every body. Creation must not carry one: the request is for an organization that does not exist
   * yet, and sending the active id would either be rejected or read as a mutation of the wrong
   * organization.
   */
  async createOrganization(name:string,slug:string){const response=await this.#fetch('/api/auth/organization/create',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({name,slug})});const value=await response.json().catch(()=>null);if(!response.ok)throw new Error(value&&typeof value==='object'&&'error'in value?String(value.error):'The organization could not be created.');return value}
  /**
   * Whether a slug is still free.
   *
   * Checked BEFORE creating, because a collision discovered at submit time arrives as a generic
   * failure and reads as "something went wrong" rather than "that name is taken" - and the user has
   * already filled in the rest of the form by then.
   *
   * A failed check returns null rather than false: reporting "taken" because the check itself failed
   * would block a name that is actually available.
   */
  async slugAvailable(slug:string):Promise<boolean|null>{try{const response=await this.#fetch('/api/auth/organization/check-slug',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({slug})});if(!response.ok)return response.status===400?false:null;const value=await response.json().catch(()=>null);if(value&&typeof value==='object'&&'status'in value)return Boolean((value as{status:unknown}).status);return true}catch{return null}}}
