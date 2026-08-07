import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@admin/fuma/ui/button'
import {
  BookingsHttpClient,
  type BookingCatalogWire,
  type BookingExceptionWire,
  type BookingLocationWire,
  type BookingResourceWire,
  type BookingServiceWire,
  type BookingSlotWire,
  type BookingWire,
  type BookingWorkingHourWire,
} from './client'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const EMPTY_CATALOG: BookingCatalogWire = Object.freeze({ services: [], locations: [], resources: [], workingHours: [], exceptions: [] })
type Surface = 'schedule' | 'services' | 'resources' | 'hours' | 'exceptions'

function today(): string { return new Date().toISOString().slice(0, 10) }
function twoYearsFromNow(): string { return new Date(Date.now() + 730 * 86_400_000).toISOString().slice(0, 10) }
function id(prefix: string): string { return `${prefix}-${crypto.randomUUID()}` }
function timeValue(minute: number): string { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` }
function minuteValue(value: string): number { const [hour = '0', minute = '0'] = value.split(':'); return Number(hour) * 60 + Number(minute) }
function money(minor: number): string { return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(minor / 100) }
function updateById<T, K extends keyof T>(values: readonly T[], key: K, value: T): readonly T[] {
  return [...values.filter((item) => item[key] !== value[key]), value]
}

function Panel({ title, description, children, className = '' }: { title: string; description: string; children: ReactNode; className?: string }) {
  return <section className={`grid min-w-0 gap-3 p-6 rounded-md border border-border bg-card [&>header]:grid [&>header]:gap-1 [&_h2]:m-0 [&_header_p]:m-0 [&_header_p]:text-muted-foreground [&_small]:text-muted-foreground [&>p]:text-muted-foreground [&_label]:grid [&_label]:gap-1 [&_label]:text-sm [&_label]:font-semibold ${className}`}><header><h2>{title}</h2><p>{description}</p></header>{children}</section>
}
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} role={error ? 'alert' : 'status'}>{children}</p>
}

function newService(): BookingServiceWire {
  return { serviceId: id('svc'), slug: '', name: '', description: '', category: 'other', durationMinutes: 60, bufferAfterMinutes: 0, capacityPerSlot: 1, slotIntervalMinutes: 30, minimumNoticeMinutes: 60, maximumAdvanceDays: 90, cancellationWindowMinutes: 120, priceMinor: 0, currency: 'KES', requiresPrepayment: false, state: 'active' }
}
function newLocation(): BookingLocationWire {
  return { locationId: id('loc'), name: '', timeZone: 'Africa/Nairobi', addressLine: '', town: '', country: 'KE', mapUrl: null, state: 'active' }
}
function newResource(catalog: BookingCatalogWire): BookingResourceWire {
  return { resourceId: id('res'), name: '', kind: 'staff', locationId: catalog.locations[0]?.locationId ?? '', serviceIds: [], concurrency: 1, state: 'active' }
}

function ServicesSurface({ catalog, canWrite, save }: { catalog: BookingCatalogWire; canWrite: boolean; save: (value: BookingServiceWire) => Promise<void> }) {
  const [draft, setDraft] = useState<BookingServiceWire>(() => catalog.services[0] ?? newService())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const select = (service: BookingServiceWire) => { setDraft(service); setMessage('') }
  const patch = <K extends keyof BookingServiceWire>(key: K, value: BookingServiceWire[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const submit = async () => { setBusy(true); setMessage(''); try { await save(draft); setMessage('Service saved.'); } catch (error) { setMessage(getErrorMessage(error, 'Service save failed.')); } finally { setBusy(false) } }
  return <div className="grid items-start gap-6 lg:grid-cols-[minmax(17rem,1fr)_minmax(22rem,1.6fr)]">
    <Panel title="Services" description="What customers can book, including duration, notice, capacity, and KES price.">
      <div className="grid gap-1 [&_button>span:first-child]:grid [&_button>span:first-child]:min-w-0 [&_button>span:first-child]:justify-items-start [&_button>span:first-child]:gap-0.5 [&_button>span:first-child]:text-left [&_small]:font-normal">{catalog.services.map((service) => <Button key={service.serviceId} variant="ghost" className="w-full justify-between text-left aria-pressed:bg-accent aria-pressed:text-foreground" aria-pressed={draft.serviceId === service.serviceId} onClick={() => select(service)}><span><strong>{service.name}</strong><small>{service.durationMinutes} min · {money(service.priceMinor)}</small></span><span className="text-sm text-muted-foreground">{service.state}</span></Button>)}</div>
      {!catalog.services.length ? <Notice>No services yet. Create the first bookable service.</Notice> : null}
      <Button variant="secondary" size="sm" disabled={!canWrite} onClick={() => setDraft(newService())}>New service</Button>
    </Panel>
    <Panel title={draft.name || 'New service'} description="Pausing keeps history intact; retiring removes the service from booking flows.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Name<input disabled={!canWrite} value={draft.name} onChange={(event) => patch('name', event.target.value)} /></label>
        <label>Slug<input disabled={!canWrite} value={draft.slug} pattern="[a-z0-9-]+" onChange={(event) => patch('slug', event.target.value)} /></label>
        <label className="sm:col-span-2">Description<textarea disabled={!canWrite} value={draft.description} onChange={(event) => patch('description', event.target.value)} /></label>
        <label>Category<select disabled={!canWrite} value={draft.category} onChange={(event) => patch('category', event.target.value as BookingServiceWire['category'])}>{['salon','consulting','training','photography','venue','tour','hospitality','event','other'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>State<select disabled={!canWrite} value={draft.state} onChange={(event) => patch('state', event.target.value as BookingServiceWire['state'])}><option>active</option><option>paused</option><option>retired</option></select></label>
        <label>Duration (minutes)<input type="number" min={5} max={1440} disabled={!canWrite} value={draft.durationMinutes} onChange={(event) => patch('durationMinutes', Number(event.target.value))} /></label>
        <label>Buffer after (minutes)<input type="number" min={0} max={480} disabled={!canWrite} value={draft.bufferAfterMinutes} onChange={(event) => patch('bufferAfterMinutes', Number(event.target.value))} /></label>
        <label>Slot interval (minutes)<input type="number" min={5} max={240} disabled={!canWrite} value={draft.slotIntervalMinutes} onChange={(event) => patch('slotIntervalMinutes', Number(event.target.value))} /></label>
        <label>Capacity per slot<input type="number" min={1} max={1000} disabled={!canWrite} value={draft.capacityPerSlot} onChange={(event) => patch('capacityPerSlot', Number(event.target.value))} /></label>
        <label>Minimum notice (minutes)<input type="number" min={0} max={43200} disabled={!canWrite} value={draft.minimumNoticeMinutes} onChange={(event) => patch('minimumNoticeMinutes', Number(event.target.value))} /></label>
        <label>Maximum advance (days)<input type="number" min={1} max={730} disabled={!canWrite} value={draft.maximumAdvanceDays} onChange={(event) => patch('maximumAdvanceDays', Number(event.target.value))} /></label>
        <label>Cancellation window (minutes)<input type="number" min={0} max={43200} disabled={!canWrite} value={draft.cancellationWindowMinutes} onChange={(event) => patch('cancellationWindowMinutes', Number(event.target.value))} /></label>
        <label>Price (KES)<input type="number" min={0} step="0.01" disabled={!canWrite} value={draft.priceMinor / 100} onChange={(event) => patch('priceMinor', Math.round(Number(event.target.value) * 100))} /></label>
        <label className="flex items-center gap-2 font-medium [&_input]:min-h-0 [&_input]:w-auto"><input type="checkbox" disabled={!canWrite} checked={draft.requiresPrepayment} onChange={(event) => patch('requiresPrepayment', event.target.checked)} />Requires prepayment</label>
      </div>
      <Button disabled={!canWrite || busy || !draft.name.trim() || !draft.slug.trim()} onClick={() => void submit()}>{busy ? 'Saving service' : 'Save service'}</Button>
      {message ? <Notice error={message.includes('failed')}>{message}</Notice> : null}
    </Panel>
  </div>
}

function ResourcesSurface({ catalog, canWrite, save, saveLocation }: { catalog: BookingCatalogWire; canWrite: boolean; save: (value: BookingResourceWire) => Promise<void>; saveLocation: (value: BookingLocationWire) => Promise<void> }) {
  const [draft, setDraft] = useState<BookingResourceWire>(() => catalog.resources[0] ?? newResource(catalog))
  const [locationDraft, setLocationDraft] = useState<BookingLocationWire>(() => newLocation())
  const [message, setMessage] = useState('')
  const patch = <K extends keyof BookingResourceWire>(key: K, value: BookingResourceWire[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const submit = async () => { setMessage(''); try { await save(draft); setMessage('Resource saved.'); } catch (error) { setMessage(getErrorMessage(error, 'Resource save failed.')) } }
  const submitLocation = async () => { setMessage(''); try { await saveLocation(locationDraft); setDraft((current) => ({ ...current, locationId: locationDraft.locationId })); setLocationDraft(newLocation()); setMessage('Location saved and selected.'); } catch (error) { setMessage(getErrorMessage(error, 'Location save failed.')) } }
  return <div className="grid items-start gap-6 lg:grid-cols-[minmax(17rem,1fr)_minmax(22rem,1.6fr)]">
    <Panel title="Resources" description="People, rooms, equipment, or vehicles that fulfil a service.">
      <div className="grid gap-1 [&_button>span:first-child]:grid [&_button>span:first-child]:min-w-0 [&_button>span:first-child]:justify-items-start [&_button>span:first-child]:gap-0.5 [&_button>span:first-child]:text-left [&_small]:font-normal">{catalog.resources.map((resource) => <Button key={resource.resourceId} variant="ghost" className="w-full justify-between text-left aria-pressed:bg-accent aria-pressed:text-foreground" aria-pressed={draft.resourceId === resource.resourceId} onClick={() => setDraft(resource)}><span><strong>{resource.name}</strong><small>{resource.kind} · capacity {resource.concurrency}</small></span><span className="text-sm text-muted-foreground">{resource.state}</span></Button>)}</div>
      {!catalog.locations.length ? <Notice error>Add a booking location before creating resources.</Notice> : null}
      <Button variant="secondary" size="sm" disabled={!canWrite || !catalog.locations.length} onClick={() => setDraft(newResource(catalog))}>New resource</Button>
    </Panel>
    <Panel title={draft.name || 'New resource'} description="Service assignment and location are committed together so a partial resource cannot appear.">
      <details className="grid gap-3 p-3 rounded-md border border-border [&_summary]:cursor-pointer [&_summary]:font-bold [&_summary:focus-visible]:outline [&_summary:focus-visible]:outline-2" open={!catalog.locations.length}>
        <summary>Add a booking location</summary>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>Location name<input disabled={!canWrite} value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} /></label>
          <label>Time zone<input disabled={!canWrite} value={locationDraft.timeZone} onChange={(event) => setLocationDraft({ ...locationDraft, timeZone: event.target.value })} /></label>
          <label>Address<input disabled={!canWrite} value={locationDraft.addressLine} onChange={(event) => setLocationDraft({ ...locationDraft, addressLine: event.target.value })} /></label>
          <label>Town<input disabled={!canWrite} value={locationDraft.town} onChange={(event) => setLocationDraft({ ...locationDraft, town: event.target.value })} /></label>
          <label>Country code<input disabled={!canWrite} maxLength={2} value={locationDraft.country} onChange={(event) => setLocationDraft({ ...locationDraft, country: event.target.value.toUpperCase() })} /></label>
          <label>HTTPS map URL<input type="url" disabled={!canWrite} value={locationDraft.mapUrl ?? ''} onChange={(event) => setLocationDraft({ ...locationDraft, mapUrl: event.target.value || null })} /></label>
        </div>
        <Button variant="secondary" size="sm" disabled={!canWrite || !locationDraft.name.trim() || !locationDraft.timeZone || !locationDraft.town} onClick={() => void submitLocation()}>Save location</Button>
      </details>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Name<input disabled={!canWrite} value={draft.name} onChange={(event) => patch('name', event.target.value)} /></label>
        <label>Kind<select disabled={!canWrite} value={draft.kind} onChange={(event) => patch('kind', event.target.value as BookingResourceWire['kind'])}><option>staff</option><option>room</option><option>equipment</option><option>vehicle</option></select></label>
        <label>Location<select disabled={!canWrite} value={draft.locationId} onChange={(event) => patch('locationId', event.target.value)}><option value="">Choose a location</option>{catalog.locations.filter((location) => location.state === 'active').map((location) => <option key={location.locationId} value={location.locationId}>{location.name} · {location.timeZone}</option>)}</select></label>
        <label>Concurrent bookings<input type="number" min={1} max={100} disabled={!canWrite} value={draft.concurrency} onChange={(event) => patch('concurrency', Number(event.target.value))} /></label>
        <label>State<select disabled={!canWrite} value={draft.state} onChange={(event) => patch('state', event.target.value as BookingResourceWire['state'])}><option>active</option><option>suspended</option><option>retired</option></select></label>
      </div>
      <fieldset disabled={!canWrite} className="m-0 grid gap-2 p-3 sm:grid-cols-2 rounded-md border border-border [&_legend]:px-1 [&_legend]:font-semibold"><legend>Services this resource can fulfil</legend>{catalog.services.filter((service) => service.state !== 'retired').map((service) => <label key={service.serviceId} className="flex items-center gap-2 font-medium [&_input]:min-h-0 [&_input]:w-auto"><input type="checkbox" checked={draft.serviceIds.includes(service.serviceId)} onChange={(event) => patch('serviceIds', event.target.checked ? [...draft.serviceIds, service.serviceId] : draft.serviceIds.filter((value) => value !== service.serviceId))} />{service.name}</label>)}</fieldset>
      <Button disabled={!canWrite || !draft.name.trim() || !draft.locationId || !draft.serviceIds.length} onClick={() => void submit()}>Save resource</Button>
      {message ? <Notice error={message.includes('failed')}>{message}</Notice> : null}
    </Panel>
  </div>
}

function HoursSurface({ catalog, canWrite, save }: { catalog: BookingCatalogWire; canWrite: boolean; save: (resourceId: string, values: readonly Omit<BookingWorkingHourWire, 'resourceId'>[]) => Promise<void> }) {
  const [resourceId, setResourceId] = useState(catalog.resources[0]?.resourceId ?? '')
  const source = useMemo(() => catalog.workingHours.filter((hour) => hour.resourceId === resourceId), [catalog.workingHours, resourceId])
  const [draft, setDraft] = useState<readonly Omit<BookingWorkingHourWire, 'resourceId'>[]>(source)
  const [message, setMessage] = useState('')
  useEffect(() => { queueMicrotask(() => setDraft(source)) }, [source])
  const add = (weekday: number) => setDraft((current) => [...current, { weekday, startMinute: 540, endMinute: 1020 }])
  const change = (index: number, key: 'startMinute' | 'endMinute', value: number) => setDraft((current) => current.map((hour, currentIndex) => currentIndex === index ? { ...hour, [key]: value } : hour))
  const remove = (index: number) => setDraft((current) => current.filter((_, currentIndex) => currentIndex !== index))
  const submit = async () => { setMessage(''); try { await save(resourceId, draft); setMessage('Weekly hours saved.'); } catch (error) { setMessage(getErrorMessage(error, 'Working hours save failed.')) } }
  return <Panel title="Weekly hours" description="Each resource can have more than one non-overlapping window per day.">
    <label className="grid gap-1 text-sm font-semibold">Resource<select value={resourceId} onChange={(event) => { setResourceId(event.target.value); setMessage('') }}>{catalog.resources.map((resource) => <option key={resource.resourceId} value={resource.resourceId}>{resource.name}</option>)}</select></label>
    <div className="grid gap-2">{WEEKDAYS.map((label, weekday) => { const rows = draft.map((hour, index) => ({ hour, index })).filter(({ hour }) => hour.weekday === weekday); return <section key={label} className="grid gap-1 border-b border-border py-2 [&_h3]:m-0 [&_p]:m-0 [&_p]:text-muted-foreground"><div className="flex items-center justify-between gap-2"><h3>{label}</h3><Button variant="ghost" size="xs" disabled={!canWrite || !resourceId} onClick={() => add(weekday)}>Add window</Button></div>{rows.length ? rows.map(({ hour, index }) => <div className="flex flex-wrap items-end gap-2 [&_label]:min-w-32 [&_label]:flex-1 [&_label_span]:text-xs [&_label_span]:text-muted-foreground" key={`${weekday}-${index}`}><label><span>Opens</span><input type="time" disabled={!canWrite} value={timeValue(hour.startMinute)} onChange={(event) => change(index, 'startMinute', minuteValue(event.target.value))} /></label><span aria-hidden="true">—</span><label><span>Closes</span><input type="time" disabled={!canWrite} value={timeValue(hour.endMinute)} onChange={(event) => change(index, 'endMinute', minuteValue(event.target.value))} /></label><Button variant="ghost" size="xs" disabled={!canWrite} aria-label={`Remove ${label} window`} onClick={() => remove(index)}>Remove</Button></div>) : <p>Closed</p>}</section> })}</div>
    <Button disabled={!canWrite || !resourceId} onClick={() => void submit()}>Save weekly hours</Button>
    {message ? <Notice error={message.includes('failed')}>{message}</Notice> : null}
  </Panel>
}

function ExceptionsSurface({ catalog, canWrite, save, remove }: { catalog: BookingCatalogWire; canWrite: boolean; save: (value: BookingExceptionWire) => Promise<void>; remove: (id: string) => Promise<void> }) {
  const [draft, setDraft] = useState<BookingExceptionWire>({ exceptionId: id('exc'), resourceId: catalog.resources[0]?.resourceId ?? '', date: today(), kind: 'closed', startMinute: null, endMinute: null, note: '' })
  const [message, setMessage] = useState('')
  const submit = async () => { setMessage(''); try { await save(draft); setMessage('Exception saved.'); setDraft({ ...draft, exceptionId: id('exc') }); } catch (error) { setMessage(getErrorMessage(error, 'Exception save failed.')) } }
  const deleteOne = async (exceptionId: string) => { setMessage(''); try { await remove(exceptionId); setMessage('Exception removed.'); } catch (error) { setMessage(getErrorMessage(error, 'Exception removal failed.')) } }
  return <div className="grid items-start gap-6 lg:grid-cols-[minmax(17rem,1fr)_minmax(22rem,1.6fr)]">
    <Panel title="Dated exceptions" description="Close a day completely or replace normal hours with a special window.">
      <ul className="[&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-2 [&_li]:border-b [&_li]:border-border [&_li]:p-2 [&_li>div]:grid [&_li>div]:gap-0.5 [&_span]:text-muted-foreground [&_small]:text-muted-foreground">{catalog.exceptions.map((exception) => <li key={exception.exceptionId}><div><strong>{exception.date}</strong><span>{catalog.resources.find((resource) => resource.resourceId === exception.resourceId)?.name ?? 'Unknown resource'} · {exception.kind === 'closed' ? 'Closed' : `${timeValue(exception.startMinute ?? 0)}–${timeValue(exception.endMinute ?? 0)}`}</span>{exception.note ? <small>{exception.note}</small> : null}</div><Button variant="ghost" size="xs" disabled={!canWrite} onClick={() => void deleteOne(exception.exceptionId)}>Remove</Button></li>)}</ul>
      {!catalog.exceptions.length ? <Notice>No exceptions in the loaded two-year window.</Notice> : null}
    </Panel>
    <Panel title="Add exception" description="Special windows replace that date’s weekly hours for the selected resource.">
      <label>Resource<select disabled={!canWrite} value={draft.resourceId} onChange={(event) => setDraft({ ...draft, resourceId: event.target.value })}>{catalog.resources.map((resource) => <option key={resource.resourceId} value={resource.resourceId}>{resource.name}</option>)}</select></label>
      <label>Date<input type="date" disabled={!canWrite} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
      <label>Exception type<select disabled={!canWrite} value={draft.kind} onChange={(event) => { const kind = event.target.value as BookingExceptionWire['kind']; setDraft({ ...draft, kind, startMinute: kind === 'closed' ? null : 540, endMinute: kind === 'closed' ? null : 1020 }) }}><option value="closed">Closed all day</option><option value="window">Special opening window</option></select></label>
      {draft.kind === 'window' ? <div className="flex flex-wrap items-end gap-2 [&_label]:min-w-32 [&_label]:flex-1 [&_label_span]:text-xs [&_label_span]:text-muted-foreground"><label>Opens<input type="time" disabled={!canWrite} value={timeValue(draft.startMinute ?? 540)} onChange={(event) => setDraft({ ...draft, startMinute: minuteValue(event.target.value) })} /></label><span>—</span><label>Closes<input type="time" disabled={!canWrite} value={timeValue(draft.endMinute ?? 1020)} onChange={(event) => setDraft({ ...draft, endMinute: minuteValue(event.target.value) })} /></label></div> : null}
      <label>Note<input disabled={!canWrite} maxLength={240} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
      <Button disabled={!canWrite || !draft.resourceId || !draft.date} onClick={() => void submit()}>Save exception</Button>
      {message ? <Notice error={message.includes('failed')}>{message}</Notice> : null}
    </Panel>
  </div>
}

function ScheduleSurface({ catalog, client, canWrite }: { catalog: BookingCatalogWire; client: BookingsHttpClient; canWrite: boolean }) {
  const activeServices = catalog.services.filter((service) => service.state !== 'retired')
  const [serviceId, setServiceId] = useState(activeServices[0]?.serviceId ?? '')
  const [date, setDate] = useState(today())
  const [bookings, setBookings] = useState<readonly BookingWire[]>([])
  const [slots, setSlots] = useState<readonly BookingSlotWire[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [moves, setMoves] = useState<Readonly<Record<string, string>>>({})
  const load = useCallback(async () => { if (!serviceId) return; setLoading(true); setMessage(''); try { const [nextBookings, nextSlots] = await Promise.all([client.day(serviceId, date), client.availability({ serviceId, fromDate: date, toDate: date, partySize: 1, resourceId: null })]); setBookings(nextBookings); setSlots(nextSlots); } catch (error) { setMessage(getErrorMessage(error, 'Schedule load failed.')) } finally { setLoading(false) } }, [client, date, serviceId])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])
  const replace = (value: BookingWire) => setBookings((current) => updateById(current, 'bookingId', value).toSorted((a, b) => a.startAt.localeCompare(b.startAt)))
  const cancel = async (booking: BookingWire) => { const reason = globalThis.prompt?.('Cancellation reason')?.trim(); if (!reason) return; try { replace(await client.cancel(booking.bookingId, reason)); setMessage('Booking cancelled.'); } catch (error) { setMessage(getErrorMessage(error, 'Cancellation failed.')) } }
  const settle = async (booking: BookingWire, outcome: 'completed' | 'no-show') => { try { replace(await client.settle(booking.bookingId, outcome)); setMessage(`Booking marked ${outcome}.`); } catch (error) { setMessage(getErrorMessage(error, 'Settlement failed.')) } }
  const reschedule = async (booking: BookingWire) => { const local = moves[booking.bookingId]; if (!local) return; try { replace(await client.reschedule(booking.bookingId, new Date(local).toISOString(), booking.resourceId)); setMessage('Booking rescheduled.'); } catch (error) { setMessage(getErrorMessage(error, 'Reschedule failed.')) } }
  return <div className="grid items-start gap-6 lg:grid-cols-[minmax(28rem,2fr)_minmax(15rem,1fr)]">
    <Panel title="Day schedule" description="One operational view of confirmed, moved, cancelled, and settled appointments." className="order-1">
      <div className="flex flex-wrap items-end gap-2 [&_label]:min-w-40 [&_label]:flex-1"><label>Service<select value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="">Choose a service</option>{activeServices.map((service) => <option key={service.serviceId} value={service.serviceId}>{service.name}</option>)}</select></label><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><Button variant="secondary" size="sm" disabled={loading || !serviceId} onClick={() => void load()}>{loading ? 'Loading' : 'Refresh'}</Button></div>
      <ol className="relative [&_article]:grid [&_article]:gap-2 [&_article]:p-3 [&_article]:rounded-md [&_article]:border [&_article]:border-border [&_article_header]:flex [&_article_header]:flex-col [&_article_header]:items-start [&_article_header]:justify-between [&_article_header]:gap-2 [&_article_header>div]:grid [&_article_header>div]:gap-0.5 [&_article_p]:m-0 [&_article_p]:text-muted-foreground [&_article_header_span]:text-muted-foreground">{bookings.map((booking) => { const resource = catalog.resources.find((entry) => entry.resourceId === booking.resourceId); return <li key={booking.bookingId}><time dateTime={booking.startAt}>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: booking.timeZone }).format(new Date(booking.startAt))}</time><article><header><div><strong>{booking.customer.name}</strong><span>{booking.reference} · {resource?.name ?? booking.resourceId}</span></div><span className="text-sm text-muted-foreground" data-status={booking.status}>{booking.status}</span></header><p>{booking.customer.email}{booking.customer.phone ? ` · ${booking.customer.phone}` : ''}</p><div className="flex flex-wrap items-end gap-2 [&_label]:min-w-52 [&_label]:flex-1"><label>New time<input type="datetime-local" disabled={!canWrite || ['cancelled','completed'].includes(booking.status)} value={moves[booking.bookingId] ?? ''} onChange={(event) => setMoves((current) => ({ ...current, [booking.bookingId]: event.target.value }))} /></label><Button variant="secondary" size="xs" disabled={!canWrite || !moves[booking.bookingId]} onClick={() => void reschedule(booking)}>Reschedule</Button><Button variant="ghost" size="xs" disabled={!canWrite || ['cancelled','completed'].includes(booking.status)} onClick={() => void cancel(booking)}>Cancel</Button><Button variant="ghost" size="xs" disabled={!canWrite || booking.status === 'cancelled'} onClick={() => void settle(booking, 'completed')}>Complete</Button><Button variant="ghost" size="xs" disabled={!canWrite || booking.status === 'cancelled'} onClick={() => void settle(booking, 'no-show')}>No-show</Button></div></article></li> })}</ol>
      {!loading && !bookings.length ? <Notice>No bookings for this service and date.</Notice> : null}
      {message ? <Notice error={message.includes('failed')}>{message}</Notice> : null}
    </Panel>
    <Panel title="Open slots" description="Live availability accounts for hours, exceptions, bookings, and unexpired holds.">
      <div className="grid gap-1 sm:grid-cols-2 [&_time]:font-mono [&_time]:text-lg [&_time]:font-bold [&_span]:truncate [&_small]:truncate [&_small]:text-muted-foreground">{slots.slice(0, 24).map((slot) => <div key={`${slot.resourceId}-${slot.startAt}`}><time dateTime={slot.startAt}>{slot.localStart}</time><span>{catalog.resources.find((resource) => resource.resourceId === slot.resourceId)?.name ?? slot.resourceId}</span><small>{slot.remainingCapacity} remaining</small></div>)}</div>
      {!slots.length ? <Notice>No open slots on this date.</Notice> : null}
    </Panel>
  </div>
}

export function BookingsWorkspace({ client, canWrite, catalog: seed }: { client: BookingsHttpClient; canWrite: boolean; catalog?: BookingCatalogWire }) {
  const [surface, setSurface] = useState<Surface>('schedule')
  const [catalog, setCatalog] = useState<BookingCatalogWire>(seed ?? EMPTY_CATALOG)
  const [loading, setLoading] = useState(seed === undefined)
  const [loadError, setLoadError] = useState('')
  const reload = useCallback(async () => { setLoading(true); setLoadError(''); try { setCatalog(await client.catalog(today(), twoYearsFromNow())) } catch (error) { setLoadError(getErrorMessage(error, 'Booking setup failed to load.')) } finally { setLoading(false) } }, [client])
  useEffect(() => { if (seed === undefined) queueMicrotask(() => { void reload() }) }, [reload, seed])
  const saveLocation = async (value: BookingLocationWire) => { const saved = await client.saveLocation(value); setCatalog((current) => ({ ...current, locations: updateById(current.locations, 'locationId', saved).toSorted((a, b) => a.name.localeCompare(b.name)) })) }
  const saveService = async (value: BookingServiceWire) => { const saved = await client.saveService(value); setCatalog((current) => ({ ...current, services: updateById(current.services, 'serviceId', saved).toSorted((a, b) => a.name.localeCompare(b.name)) })) }
  const saveResource = async (value: BookingResourceWire) => { const saved = await client.saveResource(value); setCatalog((current) => ({ ...current, resources: updateById(current.resources, 'resourceId', saved).toSorted((a, b) => a.name.localeCompare(b.name)) })) }
  const saveHours = async (resourceId: string, values: readonly Omit<BookingWorkingHourWire, 'resourceId'>[]) => { const saved = await client.replaceWorkingHours(resourceId, values); setCatalog((current) => ({ ...current, workingHours: [...current.workingHours.filter((hour) => hour.resourceId !== resourceId), ...saved] })) }
  const saveException = async (value: BookingExceptionWire) => { const saved = await client.saveException(value); setCatalog((current) => ({ ...current, exceptions: updateById(current.exceptions, 'exceptionId', saved).toSorted((a, b) => a.date.localeCompare(b.date)) })) }
  const removeException = async (exceptionId: string) => { await client.deleteException(exceptionId); setCatalog((current) => ({ ...current, exceptions: current.exceptions.filter((entry) => entry.exceptionId !== exceptionId) })) }
  return <section className="grid min-w-0 gap-6" aria-label="Bookings workspace">
    <header className="flex flex-col items-start justify-between gap-6 p-6 sm:flex-row sm:items-end rounded-md border border-border [&>div:first-child]:grid [&>div:first-child]:max-w-3xl [&>div:first-child]:gap-1 [&_p]:m-0 [&_p]:text-xs [&_p]:font-bold [&_p]:uppercase [&_p]:tracking-widest [&_p]:text-muted-foreground [&_h1]:m-0 [&_h1]:text-3xl [&_h1]:tracking-tight [&_h1]:text-foreground [&>div:first-child>span]:leading-relaxed [&>div:first-child>span]:text-muted-foreground"><div><p>Bookings</p><h1>Run the day, shape the calendar.</h1><span>Services and resources define capacity. Hours and exceptions decide when that capacity opens.</span></div><div className="grid flex-none basis-22 justify-items-center p-3 rounded-md border border-border [&_strong]:text-4xl [&_strong]:leading-none [&_strong]:tabular-nums [&_span]:text-xs [&_span]:uppercase" aria-label="Today"><strong>{new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(new Date())}</strong><span>{new Intl.DateTimeFormat(undefined, { month: 'short', weekday: 'short' }).format(new Date())}</span></div></header>
    <div className="flex gap-1 overflow-x-auto border-b border-border pb-1 [&_button]:min-h-11 [&_button]:border-0 [&_button]:border-b-2 [&_button]:border-transparent [&_button]:bg-transparent [&_button]:px-3 [&_button]:text-muted-foreground [&_button:hover]:text-foreground [&_button[aria-selected=true]]:border-b-primary [&_button[aria-selected=true]]:text-foreground [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:-outline-offset-2" role="tablist" aria-label="Booking administration">{([['schedule','Schedule'],['services','Services'],['resources','Resources'],['hours','Weekly hours'],['exceptions','Exceptions']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={surface === value} onClick={() => setSurface(value)}>{label}</button>)}</div>
    {!canWrite ? <Notice>Read only. Site settings write permission is required to change booking setup or outcomes.</Notice> : null}
    {loading ? <Notice>Loading booking setup…</Notice> : loadError ? <><Notice error>{loadError}</Notice><Button variant="secondary" size="sm" onClick={() => void reload()}>Try again</Button></> : surface === 'services' ? <ServicesSurface catalog={catalog} canWrite={canWrite} save={saveService} /> : surface === 'resources' ? <ResourcesSurface catalog={catalog} canWrite={canWrite} save={saveResource} saveLocation={saveLocation} /> : surface === 'hours' ? <HoursSurface catalog={catalog} canWrite={canWrite} save={saveHours} /> : surface === 'exceptions' ? <ExceptionsSurface catalog={catalog} canWrite={canWrite} save={saveException} remove={removeException} /> : <ScheduleSurface catalog={catalog} client={client} canWrite={canWrite} />}
  </section>
}
