import { timingSafeEqual } from 'node:crypto'
import { Type,safeParseValue } from '@core/utils/typeboxHelpers'
import type{HostedResolvedSession}from'../../auth/hosted/auth'
import type{DbClient}from'../../db/client'
import{PLATFORM_ORGANIZATION_ID}from'../organizations/contracts'
import{PlatformConsoleRegistry,PlatformConsoleService,type InternalAuthority}from'../../../../../packages/fuma-governance-launch/src/operations'
import{PostgresPlatformConsoleReadSource}from'./postgres'
export const PLATFORM_CONSOLE_PATH='/api/fuma/internal/platform-console' as const
const Scalar=Type.Union([Type.String(),Type.Number(),Type.Boolean(),Type.Null()]);const Page=Type.Object({view:Type.String(),rows:Type.Array(Type.Record(Type.String(),Scalar),{maxItems:100}),nextCursor:Type.Union([Type.String(),Type.Null()]),total:Type.Integer({minimum:0})},{additionalProperties:false})
type AuthorityRow=Readonly<{role:string|null;banned:boolean|null;ban_expires:Date|string|null;staff_profile:boolean;platform_owner:boolean}>
function same(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&a.length>=32&&timingSafeEqual(a,b)}
function response(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'cache-control':'private, no-store','content-type':'application/json; charset=utf-8'}})}
export type PlatformConsoleBoundary=Readonly<{handles(request:Request):boolean;handle(request:Request):Promise<Response|null>}>
export function createPlatformConsoleBoundary(input:Readonly<{db:DbClient;resolveSession(headers:Headers):Promise<HostedResolvedSession|null>;protectedOwnerEmail:string;runtimeSecret:string;consoleHost:string;productHost?:string;now?:()=>Date}>):PlatformConsoleBoundary{
 const service=new PlatformConsoleService({source:new PostgresPlatformConsoleReadSource(input.db),registry:new PlatformConsoleRegistry(),now:input.now});const owner=input.protectedOwnerEmail.trim().toLowerCase(),now=input.now??(()=>new Date())
 async function authority(request:Request):Promise<InternalAuthority|null>{
  const url=new URL(request.url),host=(request.headers.get('host')??url.hostname).toLowerCase().replace(/:[0-9]+$/,''),forwarded=request.headers.get('x-forwarded-proto')?.split(',',1)[0]?.trim().toLowerCase();const direct=Boolean(input.productHost)&&host===input.productHost&&((forwarded??url.protocol.replace(':',''))==='https')
  if(!direct&&!same(input.runtimeSecret,request.headers.get('x-fuma-control-runtime-secret')??''))return null
  const session=await input.resolveSession(request.headers)
  if(!session||session.impersonatedBy!==null||session.email.trim().toLowerCase()!==owner)return null
  const result=await input.db<AuthorityRow>`select user_account.role,user_account.banned,user_account.ban_expires,exists(select 1 from auth_staff_profiles staff where staff.user_id=user_account.id) staff_profile,exists(select 1 from auth_members member where member.user_id=user_account.id and member.organization_id=${PLATFORM_ORGANIZATION_ID} and member.role='owner') platform_owner from auth_users user_account where user_account.id=${session.userId}`
  const row=result.rows[0]
  const banExpires=row?.ban_expires===null||row?.ban_expires===undefined?Infinity:Date.parse(row.ban_expires instanceof Date?row.ban_expires.toISOString():row.ban_expires)
  if(!row||row.banned===true&&banExpires>now().getTime()||!row.staff_profile||!row.platform_owner||!String(row.role??'').split(',').map(value=>value.trim()).includes('admin'))return null
  const age=now().getTime()-session.createdAt.getTime();const fresh=age>=0&&age<=5*60_000
  return Object.freeze({actorId:session.userId,host:input.consoleHost,authorities:new Set(fresh?['internal.console.read','internal.console.write','internal.commercial.offer.issue']:['internal.console.read']),stepUpAt:fresh?session.createdAt.toISOString():null,protectedOwner:true})
 }
 return Object.freeze({handles(request){return new URL(request.url).pathname===PLATFORM_CONSOLE_PATH},async handle(request){if(!this.handles(request))return null;if(request.method!=='GET')return response({error:'Method not allowed.'},405);const auth=await authority(request);if(!auth)return response({error:'Platform console authority denied.'},403);const url=new URL(request.url);const candidate:Record<string,unknown>={view:url.searchParams.get('view')??'clients',limit:Number(url.searchParams.get('limit')??'25')};const filter=url.searchParams.get('filter'),cursor=url.searchParams.get('cursor');if(filter)candidate.filter=filter;if(cursor)candidate.cursor=cursor;try{const page=await service.query(candidate,auth);if(!safeParseValue(Page,page).ok)throw new Error('invalid');return response({result:page})}catch{return response({error:'Platform console query failed safely.'},400)}}})
}
