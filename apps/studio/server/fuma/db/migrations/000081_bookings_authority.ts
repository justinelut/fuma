import type { HostedMigration } from '../migrationPolicy'

/**
 * FUMA-093 bookings and appointments authority.
 *
 * Additive only. Capacity safety is enforced in the schema itself:
 *  - `fuma_booking_holds_v1.fence` plus a partial unique index means one live
 *    hold per resource/start, so a replayed request cannot double-reserve.
 *  - `fuma_bookings_v1.request_key` is unique per site, making confirmation
 *    idempotent at the storage layer rather than only in application code.
 *  - Booking events are append-only through a trigger, matching the pattern
 *    used by the public handoff and support authorities.
 */
export const bookingsAuthorityMigration: HostedMigration = Object.freeze({
  id: '000081_bookings_authority',
  description: 'Add bookings and appointments scheduling authority with fenced holds',
  sql: String.raw`
create table fuma_booking_locations_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  location_id text not null,
  name text not null check(length(name) between 1 and 160),
  time_zone text not null check(time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){1,2}$'),
  address_line text not null default '', town text not null default '',
  country char(2) not null check(country ~ '^[A-Z]{2}$'),
  map_url text null check(map_url is null or map_url like 'https://%'),
  state text not null check(state in ('active','retired')),
  created_at timestamptz not null, updated_at timestamptz not null,
  primary key (organization_id, workspace_id, site_id, location_id)
);

create table fuma_booking_services_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  service_id text not null,
  slug text not null check(slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  name text not null check(length(name) between 1 and 160),
  description text not null default '',
  category text not null check(category in ('salon','consulting','training','photography','venue','tour','hospitality','event','other')),
  duration_minutes integer not null check(duration_minutes between 5 and 1440),
  buffer_after_minutes integer not null default 0 check(buffer_after_minutes between 0 and 480),
  capacity_per_slot integer not null check(capacity_per_slot between 1 and 1000),
  slot_interval_minutes integer not null check(slot_interval_minutes between 5 and 240),
  minimum_notice_minutes integer not null default 0 check(minimum_notice_minutes between 0 and 43200),
  maximum_advance_days integer not null check(maximum_advance_days between 1 and 730),
  cancellation_window_minutes integer not null default 0 check(cancellation_window_minutes between 0 and 43200),
  price_minor integer not null check(price_minor between 0 and 99999999),
  currency char(3) not null check(currency='KES'),
  requires_prepayment boolean not null default false,
  state text not null check(state in ('active','paused','retired')),
  created_at timestamptz not null, updated_at timestamptz not null,
  primary key (organization_id, workspace_id, site_id, service_id),
  unique (organization_id, workspace_id, site_id, slug)
);

create table fuma_booking_resources_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  resource_id text not null,
  name text not null check(length(name) between 1 and 160),
  kind text not null check(kind in ('staff','room','equipment','vehicle')),
  location_id text not null,
  concurrency integer not null check(concurrency between 1 and 100),
  state text not null check(state in ('active','suspended','retired')),
  created_at timestamptz not null, updated_at timestamptz not null,
  primary key (organization_id, workspace_id, site_id, resource_id),
  foreign key (organization_id, workspace_id, site_id, location_id)
    references fuma_booking_locations_v1(organization_id, workspace_id, site_id, location_id) on delete restrict
);

create table fuma_booking_resource_services_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  resource_id text not null, service_id text not null,
  primary key (organization_id, workspace_id, site_id, resource_id, service_id),
  foreign key (organization_id, workspace_id, site_id, resource_id)
    references fuma_booking_resources_v1(organization_id, workspace_id, site_id, resource_id) on delete cascade,
  foreign key (organization_id, workspace_id, site_id, service_id)
    references fuma_booking_services_v1(organization_id, workspace_id, site_id, service_id) on delete cascade
);

create table fuma_booking_working_hours_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  resource_id text not null,
  weekday smallint not null check(weekday between 0 and 6),
  start_minute integer not null check(start_minute between 0 and 1440),
  end_minute integer not null check(end_minute between 0 and 1440),
  check(end_minute > start_minute),
  primary key (organization_id, workspace_id, site_id, resource_id, weekday, start_minute),
  foreign key (organization_id, workspace_id, site_id, resource_id)
    references fuma_booking_resources_v1(organization_id, workspace_id, site_id, resource_id) on delete cascade
);

create table fuma_booking_exceptions_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  resource_id text not null,
  exception_id text not null,
  exception_date date not null,
  kind text not null check(kind in ('closed','window')),
  start_minute integer null check(start_minute is null or start_minute between 0 and 1440),
  end_minute integer null check(end_minute is null or end_minute between 0 and 1440),
  note text not null default '',
  check(kind='closed' or (start_minute is not null and end_minute is not null and end_minute > start_minute)),
  primary key (organization_id, workspace_id, site_id, exception_id),
  foreign key (organization_id, workspace_id, site_id, resource_id)
    references fuma_booking_resources_v1(organization_id, workspace_id, site_id, resource_id) on delete cascade
);
-- One rule per resource/date/kind/window start; a closed day is a single row.
create unique index fuma_booking_exception_rule_v1
  on fuma_booking_exceptions_v1(
    organization_id, workspace_id, site_id, resource_id, exception_date, kind, coalesce(start_minute, -1)
  );
create index fuma_booking_exception_date_v1
  on fuma_booking_exceptions_v1(organization_id, workspace_id, site_id, exception_date);

create table fuma_booking_holds_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  hold_id text not null,
  service_id text not null, resource_id text not null,
  start_at timestamptz not null, end_at timestamptz not null, expires_at timestamptz not null,
  fence integer not null check(fence >= 1),
  state text not null check(state in ('held','redeemed','released','expired')),
  created_at timestamptz not null,
  check(end_at > start_at),
  primary key (organization_id, workspace_id, site_id, hold_id),
  foreign key (organization_id, workspace_id, site_id, resource_id)
    references fuma_booking_resources_v1(organization_id, workspace_id, site_id, resource_id) on delete cascade
);
-- One live hold per resource and start instant: the storage-level anti-double-reserve guard.
create unique index fuma_booking_hold_live_v1
  on fuma_booking_holds_v1(organization_id, workspace_id, site_id, resource_id, start_at)
  where state='held';
create index fuma_booking_hold_expiry_v1
  on fuma_booking_holds_v1(expires_at) where state='held';

create table fuma_bookings_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  booking_id text not null,
  reference text not null check(reference ~ '^[A-Z0-9-]{6,24}$'),
  service_id text not null, resource_id text not null, location_id text not null,
  start_at timestamptz not null, end_at timestamptz not null,
  time_zone text not null,
  status text not null check(status in ('confirmed','rescheduled','cancelled','completed','no-show')),
  customer_name text not null check(length(customer_name) between 1 and 160),
  customer_email text not null check(customer_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  customer_phone text null,
  customer_notes text not null default '',
  intake_json jsonb not null default '[]'::jsonb check(jsonb_typeof(intake_json)='array'),
  party_size integer not null check(party_size between 1 and 1000),
  price_minor integer not null check(price_minor between 0 and 99999999),
  currency char(3) not null check(currency='KES'),
  payment_reference text null,
  request_key text not null check(request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  created_at timestamptz not null, updated_at timestamptz not null, cancelled_at timestamptz null,
  check(end_at > start_at),
  check((status='cancelled') = (cancelled_at is not null)),
  primary key (organization_id, workspace_id, site_id, booking_id),
  -- Duplicate confirmation retries resolve to the same booking.
  unique (organization_id, workspace_id, site_id, request_key),
  unique (organization_id, workspace_id, site_id, reference),
  foreign key (organization_id, workspace_id, site_id, resource_id)
    references fuma_booking_resources_v1(organization_id, workspace_id, site_id, resource_id) on delete restrict
);
create index fuma_booking_resource_window_v1
  on fuma_bookings_v1(organization_id, workspace_id, site_id, resource_id, start_at)
  where status <> 'cancelled';

create table fuma_booking_reminders_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  reminder_id text not null,
  booking_id text not null,
  send_at timestamptz not null,
  channel text not null check(channel='email'),
  state text not null check(state in ('pending','sent','cancelled')),
  primary key (organization_id, workspace_id, site_id, reminder_id),
  foreign key (organization_id, workspace_id, site_id, booking_id)
    references fuma_bookings_v1(organization_id, workspace_id, site_id, booking_id) on delete cascade
);
create index fuma_booking_reminder_due_v1
  on fuma_booking_reminders_v1(send_at) where state='pending';

create table fuma_booking_events_v1 (
  organization_id text not null, workspace_id text not null, site_id text not null,
  event_id text not null,
  booking_id text null, hold_id text null,
  kind text not null check(kind in ('held','hold-released','hold-expired','booked','rescheduled','cancelled','completed','no-show','reminder-sent')),
  occurred_at timestamptz not null,
  detail text not null default '',
  check(booking_id is not null or hold_id is not null),
  primary key (organization_id, workspace_id, site_id, event_id)
);
create index fuma_booking_event_time_v1
  on fuma_booking_events_v1(organization_id, workspace_id, site_id, occurred_at, event_id);
create function fuma_booking_events_immutable_v1() returns trigger language plpgsql as $booking_events_immutable$
begin raise exception 'booking events are append-only' using errcode='55000'; end;
$booking_events_immutable$;
create trigger fuma_booking_events_immutable_v1
  before update or delete on fuma_booking_events_v1
  for each row execute function fuma_booking_events_immutable_v1();
`,
})
