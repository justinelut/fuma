import { describe, expect, it } from 'bun:test'
import type { FumaScopedRouteHandlerInput } from '../../context'
import { createBookingScopedRouteDeclarations } from '../routes'
import type { BookingScope } from '../service'

const scope: BookingScope = { organizationId: 'org-a', workspaceId: 'workspace-a', siteId: 'site-a' }
const service = { serviceId:'svc-1',slug:'consulting',name:'Consulting',description:'',category:'consulting',durationMinutes:60,bufferAfterMinutes:0,capacityPerSlot:1,slotIntervalMinutes:30,minimumNoticeMinutes:0,maximumAdvanceDays:90,cancellationWindowMinutes:60,priceMinor:500000,currency:'KES',requiresPrepayment:false,state:'active' } as const
const location = { locationId:'loc-1',name:'Nairobi',timeZone:'Africa/Nairobi',addressLine:'',town:'Nairobi',country:'KE',mapUrl:null,state:'active' } as const
const resource = { resourceId:'res-1',name:'Asha',kind:'staff',locationId:'loc-1',serviceIds:['svc-1'],concurrency:1,state:'active' } as const
const booking = { bookingId:'bk-1',reference:'FUMA-001',serviceId:'svc-1',resourceId:'res-1',locationId:'loc-1',startAt:'2026-08-05T06:00:00.000Z',endAt:'2026-08-05T07:00:00.000Z',timeZone:'Africa/Nairobi',status:'confirmed',customer:{name:'Ada',email:'ada@example.test',phone:null,notes:''},intake:[],partySize:1,priceMinor:500000,currency:'KES',paymentReference:null,createdAt:'2026-08-04T06:00:00.000Z',updatedAt:'2026-08-04T06:00:00.000Z',cancelledAt:null,requestKey:'request-0001' } as const

function input(method: string, suffix: string, body?: unknown, params: Record<string,string> = {}): FumaScopedRouteHandlerInput {
  return {
    request: new Request(`https://studio.test${suffix}`, { method, headers: body === undefined ? undefined : { 'content-type':'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    repositoryScope: { platformId:'platform',...scope,ownerKey:'owner-a',generation:3,state:'active',transferFence:null },
    context: { actor:{kind:'staff',userId:'staff-a',sessionId:'session-a',impersonator:null},source:{kind:'staff-session',correlationId:'request-a',userId:'staff-a',sessionId:'session-a',impersonatedBy:null},requestId:'request-a',scope:{platform:{id:'platform',status:'active'},organization:{id:'org-a',platformId:'platform',status:'active'},workspace:{id:'workspace-a',platformId:'platform',organizationId:'org-a',status:'active'},site:{id:'site-a',platformId:'platform',organizationId:'org-a',workspaceId:'workspace-a',profileId:'website',status:'active'}},profile:{id:'website',status:'active'},capabilities:['website.bookings'],permissions:{subjectId:'staff-a',allow:['site.home.read','site.settings.write'],deny:[]},resolvedAt:'2026-08-04T06:00:00.000Z' },
    params: Object.freeze(params),
  } as unknown as FumaScopedRouteHandlerInput
}

function harness() {
  const calls: { name:string; scope?:BookingScope; value?:unknown }[] = []
  const repository = {
    async listServices(value:BookingScope){calls.push({name:'listServices',scope:value});return [service]},
    async listLocations(value:BookingScope){calls.push({name:'listLocations',scope:value});return [location]},
    async listAllResources(value:BookingScope){calls.push({name:'listAllResources',scope:value});return [resource]},
    async listWorkingHours(value:BookingScope){calls.push({name:'listWorkingHours',scope:value});return [{resourceId:'res-1',weekday:3,startMinute:540,endMinute:1020}]},
    async listAdminExceptions(value:BookingScope){calls.push({name:'listAdminExceptions',scope:value});return []},
    async saveLocation(value:BookingScope, next:unknown){calls.push({name:'saveLocation',scope:value,value:next});return next},
    async saveService(value:BookingScope, next:unknown){calls.push({name:'saveService',scope:value,value:next});return next},
    async saveResource(value:BookingScope, next:unknown){calls.push({name:'saveResource',scope:value,value:next});return next},
    async replaceWorkingHours(value:BookingScope,resourceId:string,hours:unknown){calls.push({name:'replaceWorkingHours',scope:value,value:{resourceId,hours}});return (hours as Record<string,unknown>[]).map(hour=>({resourceId,...hour}))},
    async saveException(value:BookingScope,next:unknown){calls.push({name:'saveException',scope:value,value:next});return next},
    async deleteException(value:BookingScope,next:string){calls.push({name:'deleteException',scope:value,value:next});return true},
    async getBooking(){return booking},
  }
  const lifecycle = {
    async availability(value:BookingScope,query:unknown){calls.push({name:'availability',scope:value,value:query});return []},
    async hold(value:BookingScope,command:unknown){calls.push({name:'hold',scope:value,value:command});return {holdId:'hd-1',serviceId:'svc-1',resourceId:'res-1',startAt:booking.startAt,endAt:booking.endAt,expiresAt:'2026-08-04T06:10:00.000Z',fence:1,state:'held'}},
    async releaseHold(value:BookingScope,holdId:string,fence:number){calls.push({name:'releaseHold',scope:value,value:{holdId,fence}})},
    async book(value:BookingScope,command:unknown){calls.push({name:'book',scope:value,value:command});return booking},
    async schedule(value:BookingScope,command:unknown){calls.push({name:'schedule',scope:value,value:command});return [booking]},
    async cancel(value:BookingScope,bookingId:string,reason:string){calls.push({name:'cancel',scope:value,value:{bookingId,reason}});return {...booking,status:'cancelled',cancelledAt:'2026-08-04T06:00:00.000Z'}},
    async reschedule(value:BookingScope,command:unknown){calls.push({name:'reschedule',scope:value,value:command});return {...booking,status:'rescheduled'}},
    async settle(value:BookingScope,bookingId:string,outcome:string){calls.push({name:'settle',scope:value,value:{bookingId,outcome}});return {...booking,status:outcome}},
  }
  const routes = createBookingScopedRouteDeclarations({ repository, lifecycle } as never)
  const route = (method:string,path:string) => routes.find(entry=>entry.method===method&&entry.path===path)!
  return {calls,routes,route}
}

describe('booking scoped routes',()=>{
  it('declares the complete strict management and lifecycle surface without route collisions',()=>{
    const {routes}=harness()
    expect(routes.map(({method,path,permission})=>({method,path,permission}))).toEqual([
      {method:'GET',path:'/bookings/catalog',permission:'site.home.read'},
      {method:'POST',path:'/bookings/locations',permission:'site.settings.write'},
      {method:'POST',path:'/bookings/services',permission:'site.settings.write'},
      {method:'POST',path:'/bookings/resources',permission:'site.settings.write'},
      {method:'PUT',path:'/bookings/resources/:resourceId/hours',permission:'site.settings.write'},
      {method:'POST',path:'/bookings/exceptions',permission:'site.settings.write'},
      {method:'DELETE',path:'/bookings/exceptions/:exceptionId',permission:'site.settings.write'},
      {method:'GET',path:'/bookings/availability',permission:'site.home.read'},
      {method:'POST',path:'/bookings/holds',permission:'site.settings.write'},
      {method:'POST',path:'/bookings/holds/release',permission:'site.settings.write'},
      {method:'POST',path:'/bookings/records',permission:'site.settings.write'},
      {method:'GET',path:'/bookings/records/:bookingId',permission:'site.home.read'},
      {method:'GET',path:'/bookings/day',permission:'site.home.read'},
      {method:'POST',path:'/bookings/records/:bookingId/cancel',permission:'site.settings.write'},
      {method:'POST',path:'/bookings/records/:bookingId/reschedule',permission:'site.settings.write'},
      {method:'POST',path:'/bookings/records/:bookingId/settle',permission:'site.settings.write'},
    ])
  })

  it('loads one exact-scope catalog and never accepts scope in a service body',async()=>{
    const {calls,route}=harness()
    const response=await route('GET','/bookings/catalog').handler(input('GET','/bookings/catalog?fromDate=2026-08-01&toDate=2026-08-31'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({services:[service],resources:[resource]})
    expect(calls.every(call=>!call.scope||JSON.stringify(call.scope)===JSON.stringify(scope))).toBe(true)

    const rejected=await route('POST','/bookings/services').handler(input('POST','/bookings/services',{...service,siteId:'other'}))
    expect(rejected.status).toBe(400)
    expect(calls.some(call=>call.name==='saveService')).toBe(false)
  })

  it('replaces validated weekly hours and delegates booking outcomes to the lifecycle authority',async()=>{
    const {calls,route}=harness()
    const hours=await route('PUT','/bookings/resources/:resourceId/hours').handler(input('PUT','/bookings/resources/res-1/hours',{hours:[{weekday:1,startMinute:540,endMinute:1020}]},{resourceId:'res-1'}))
    expect(hours.status).toBe(200)
    expect(calls.find(call=>call.name==='replaceWorkingHours')?.value).toEqual({resourceId:'res-1',hours:[{weekday:1,startMinute:540,endMinute:1020}]})

    const settled=await route('POST','/bookings/records/:bookingId/settle').handler(input('POST','/bookings/records/bk-1/settle',{outcome:'completed'},{bookingId:'bk-1'}))
    expect(settled.status).toBe(200)
    expect(calls.find(call=>call.name==='settle')).toEqual({name:'settle',scope,value:{bookingId:'bk-1',outcome:'completed'}})
  })

  it('rejects overlapping hours before any transactional repository write',async()=>{
    const {calls,route}=harness()
    const response=await route('PUT','/bookings/resources/:resourceId/hours').handler(input('PUT','/bookings/resources/res-1/hours',{hours:[{weekday:1,startMinute:540,endMinute:720},{weekday:1,startMinute:600,endMinute:780}]},{resourceId:'res-1'}))
    expect(response.status).toBe(400)
    expect(calls.some(call=>call.name==='replaceWorkingHours')).toBe(false)
  })
})
