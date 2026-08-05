import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BookingsWorkspace } from '@admin/fuma/bookings/BookingsWorkspace'
import type {
  BookingCatalogWire,
  BookingExceptionWire,
  BookingLocationWire,
  BookingResourceWire,
  BookingServiceWire,
  BookingWorkingHourWire,
  BookingsHttpClient,
} from '@admin/fuma/bookings/client'
import { BOOKING_ADMIN_CAPABILITY_ID, BOOKING_ADMIN_ROUTE_ID, bookingsAdminRegistry } from '@admin/fuma/bookings/registry'

const catalog: BookingCatalogWire = {
  services: [{ serviceId:'svc-1',slug:'consulting',name:'Consulting',description:'Strategy session',category:'consulting',durationMinutes:60,bufferAfterMinutes:0,capacityPerSlot:1,slotIntervalMinutes:30,minimumNoticeMinutes:60,maximumAdvanceDays:90,cancellationWindowMinutes:120,priceMinor:500000,currency:'KES',requiresPrepayment:false,state:'active' }],
  locations: [{ locationId:'loc-1',name:'Nairobi studio',timeZone:'Africa/Nairobi',addressLine:'',town:'Nairobi',country:'KE',mapUrl:null,state:'active' }],
  resources: [{ resourceId:'res-1',name:'Asha',kind:'staff',locationId:'loc-1',serviceIds:['svc-1'],concurrency:1,state:'active' }],
  workingHours: [{ resourceId:'res-1',weekday:1,startMinute:540,endMinute:1020 }],
  exceptions: [],
}

function client() {
  return {
    day: mock(async()=>[]),
    availability: mock(async()=>[]),
    saveLocation: mock(async(value:BookingLocationWire)=>value),
    saveService: mock(async(value:BookingServiceWire)=>value),
    saveResource: mock(async(value:BookingResourceWire)=>value),
    replaceWorkingHours: mock(async(resourceId:string,values:readonly Omit<BookingWorkingHourWire,'resourceId'>[])=>values.map((value)=>({resourceId,...value}))),
    saveException: mock(async(value:BookingExceptionWire)=>value),
    deleteException: mock(async()=>({accepted:true as const})),
  } as unknown as BookingsHttpClient
}

afterEach(cleanup)

describe('BookingsWorkspace',()=>{
  it('contributes one Website-profile navigation entry and scoped admin route',()=>{
    const website=bookingsAdminRegistry.compose('website',{grant:[],revoke:[]})
    const publication=bookingsAdminRegistry.compose('publication',{grant:[],revoke:[]})
    expect(website.capabilities.some(({id})=>id===BOOKING_ADMIN_CAPABILITY_ID)).toBe(true)
    expect(website.navigation).toContainEqual(expect.objectContaining({id:'nav.bookings',path:'/admin/bookings'}))
    expect(website.routes).toContainEqual(expect.objectContaining({id:BOOKING_ADMIN_ROUTE_ID,path:'/admin/bookings'}))
    expect(publication.capabilities.some(({id})=>id===BOOKING_ADMIN_CAPABILITY_ID)).toBe(false)
  })

  it('opens on an accessible day schedule with setup tabs and live availability language',async()=>{
    const scopedClient=client()
    render(<BookingsWorkspace client={scopedClient} canWrite catalog={catalog}/>)
    await waitFor(()=>expect(scopedClient.day).toHaveBeenCalled())
    expect(screen.getByRole('heading',{name:'Run the day, shape the calendar.'})).toBeTruthy()
    expect(screen.getByRole('tab',{name:'Schedule'}).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading',{name:'Day schedule'})).toBeTruthy()
    expect(screen.getByRole('heading',{name:'Open slots'})).toBeTruthy()
    expect(screen.getByText(/accounts for hours, exceptions, bookings, and unexpired holds/)).toBeTruthy()
  })

  it('enforces read-only setup and exposes the reason',async()=>{
    const scopedClient=client()
    render(<BookingsWorkspace client={scopedClient} canWrite={false} catalog={catalog}/>)
    await waitFor(()=>expect(scopedClient.day).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('tab',{name:'Services'}))
    expect(screen.getByText(/Site settings write permission is required/)).toBeTruthy()
    expect(screen.getByRole('button',{name:'Save service'}).hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Name').hasAttribute('disabled')).toBe(true)
  })

  it('edits and saves a service through the scoped client',async()=>{
    const scopedClient=client()
    render(<BookingsWorkspace client={scopedClient} canWrite catalog={catalog}/>)
    fireEvent.click(screen.getByRole('tab',{name:'Services'}))
    fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Advisory'}})
    fireEvent.click(screen.getByRole('button',{name:'Save service'}))
    await waitFor(()=>expect(scopedClient.saveService).toHaveBeenCalledTimes(1))
    expect(scopedClient.saveService).toHaveBeenCalledWith(expect.objectContaining({serviceId:'svc-1',name:'Advisory'}))
    expect(await screen.findByText('Service saved.')).toBeTruthy()
  })

  it('represents multiple weekly windows without flattening the schedule',async()=>{
    const scopedClient=client()
    render(<BookingsWorkspace client={scopedClient} canWrite catalog={catalog}/>)
    fireEvent.click(screen.getByRole('tab',{name:'Weekly hours'}))
    fireEvent.click(screen.getAllByRole('button',{name:'Add window'})[1]!)
    expect(screen.getAllByLabelText('Opens')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button',{name:'Save weekly hours'}))
    await waitFor(()=>expect(scopedClient.replaceWorkingHours).toHaveBeenCalledTimes(1))
  })
})
