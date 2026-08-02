/**
 * Starter collection blueprints.
 *
 * These are *content-only* definitions instantiated through the provisioning
 * capability. They exist so a business, agency, blog, events or hospitality site
 * can be modelled immediately without shipping a separate engine per vertical.
 *
 * What deliberately is NOT here:
 *  - no reservation, ticketing, inventory or checkout logic. Capacity and
 *    availability belong to the FUMA-093 bookings authority, which these
 *    blueprints compose rather than reimplement;
 *  - no hard-coded pages or profiles. A blueprint only describes fields; the
 *    editor and AI compose presentation from them;
 *  - no payment fields beyond KES presentation, because taking money stays with
 *    the existing reviewed payment authority.
 */
import type { ProvisionCollectionInput } from './contracts'

export type CollectionBlueprint = Readonly<{
  /** Stable key used by onboarding and AI to request a blueprint by name. */
  key: string
  /** Site families this blueprint suits, for onboarding suggestions. */
  families: readonly ('business' | 'agency' | 'blog' | 'events' | 'hospitality')[]
  summary: string
  definition: ProvisionCollectionInput
}>

function blueprint(
  key: string,
  families: CollectionBlueprint['families'],
  summary: string,
  definition: ProvisionCollectionInput,
): CollectionBlueprint {
  return Object.freeze({ key, families, summary, definition: Object.freeze(definition) })
}

const KES = { format: 'currency', currency: 'KES' } as const

export const COLLECTION_BLUEPRINTS: readonly CollectionBlueprint[] = Object.freeze([
  blueprint('services', ['business', 'agency'], 'What the business sells, with optional KES from-price.', {
    slug: 'services',
    name: 'Services',
    singularLabel: 'Service',
    pluralLabel: 'Services',
    shape: 'content',
    primaryFieldId: 'title',
    fields: [
      { id: 'title', label: 'Title', type: 'text', required: true },
      { id: 'summary', label: 'Summary', type: 'longText' },
      { id: 'body', label: 'Details', type: 'richText', format: 'markdown' },
      { id: 'fromPrice', label: 'From price', type: 'number', ...KES },
      { id: 'icon', label: 'Icon or image', type: 'media', mediaKind: 'image' },
      { id: 'featured', label: 'Featured', type: 'boolean' },
    ],
  }),

  blueprint('team', ['business', 'agency'], 'People, roles and short bios.', {
    slug: 'team',
    name: 'Team',
    singularLabel: 'Team member',
    pluralLabel: 'Team',
    shape: 'records',
    primaryFieldId: 'name',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'role', label: 'Role', type: 'text', required: true },
      { id: 'bio', label: 'Bio', type: 'longText' },
      { id: 'photo', label: 'Photo', type: 'media', mediaKind: 'image' },
      { id: 'email', label: 'Email', type: 'email' },
      { id: 'order', label: 'Display order', type: 'number' },
    ],
  }),

  blueprint('case-studies', ['agency'], 'Client work with outcome and linked service.', {
    slug: 'case-studies',
    name: 'Case studies',
    singularLabel: 'Case study',
    pluralLabel: 'Case studies',
    shape: 'content',
    primaryFieldId: 'title',
    fields: [
      { id: 'title', label: 'Title', type: 'text', required: true },
      { id: 'client', label: 'Client', type: 'text' },
      { id: 'challenge', label: 'Challenge', type: 'longText' },
      { id: 'outcome', label: 'Outcome', type: 'richText', format: 'markdown' },
      { id: 'coverImage', label: 'Cover image', type: 'media', mediaKind: 'image' },
      { id: 'service', label: 'Related service', type: 'relation', targetCollectionSlug: 'services' },
      { id: 'publishedOn', label: 'Published on', type: 'date' },
    ],
  }),

  blueprint('testimonials', ['business', 'agency', 'hospitality'], 'Short attributed quotes.', {
    slug: 'testimonials',
    name: 'Testimonials',
    singularLabel: 'Testimonial',
    pluralLabel: 'Testimonials',
    shape: 'records',
    primaryFieldId: 'author',
    fields: [
      { id: 'author', label: 'Author', type: 'text', required: true },
      { id: 'organisation', label: 'Organisation', type: 'text' },
      { id: 'quote', label: 'Quote', type: 'longText', required: true },
      { id: 'rating', label: 'Rating out of five', type: 'number' },
      { id: 'photo', label: 'Photo', type: 'media', mediaKind: 'image' },
    ],
  }),

  blueprint('faqs', ['business', 'agency', 'hospitality', 'events'], 'Question and answer pairs.', {
    slug: 'faqs',
    name: 'FAQs',
    singularLabel: 'FAQ',
    pluralLabel: 'FAQs',
    shape: 'records',
    primaryFieldId: 'question',
    fields: [
      { id: 'question', label: 'Question', type: 'text', required: true },
      { id: 'answer', label: 'Answer', type: 'richText', format: 'markdown', required: true },
      { id: 'topic', label: 'Topic', type: 'text' },
      { id: 'order', label: 'Display order', type: 'number' },
    ],
  }),

  blueprint('locations', ['business', 'hospitality', 'events'], 'Physical places with Kenyan town and map link.', {
    slug: 'locations',
    name: 'Locations',
    singularLabel: 'Location',
    pluralLabel: 'Locations',
    shape: 'records',
    primaryFieldId: 'name',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'addressLine', label: 'Address', type: 'text' },
      { id: 'town', label: 'Town or city', type: 'text' },
      { id: 'phone', label: 'Phone', type: 'text' },
      { id: 'mapUrl', label: 'Map link', type: 'url' },
      { id: 'openingHours', label: 'Opening hours', type: 'longText' },
      { id: 'photo', label: 'Photo', type: 'media', mediaKind: 'image' },
    ],
  }),

  blueprint('pricing-tiers', ['business', 'agency'], 'Plan presentation in KES. Presentation only; no checkout.', {
    slug: 'pricing-tiers',
    name: 'Pricing tiers',
    singularLabel: 'Pricing tier',
    pluralLabel: 'Pricing tiers',
    shape: 'records',
    primaryFieldId: 'name',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'priceMonthly', label: 'Monthly price', type: 'number', ...KES },
      { id: 'priceAnnual', label: 'Annual price', type: 'number', ...KES },
      { id: 'summary', label: 'Summary', type: 'longText' },
      { id: 'includes', label: 'What is included', type: 'longText' },
      { id: 'highlighted', label: 'Highlighted', type: 'boolean' },
      { id: 'order', label: 'Display order', type: 'number' },
    ],
  }),

  // Events as content. Capacity, RSVP and waitlist compose the bookings
  // authority; nothing here tracks seats, so it cannot oversell.
  blueprint('events', ['events'], 'Event listings with explicit time zone. Capacity comes from bookings.', {
    slug: 'events',
    name: 'Events',
    singularLabel: 'Event',
    pluralLabel: 'Events',
    shape: 'content',
    primaryFieldId: 'title',
    fields: [
      { id: 'title', label: 'Title', type: 'text', required: true },
      { id: 'summary', label: 'Summary', type: 'longText' },
      { id: 'details', label: 'Details', type: 'richText', format: 'markdown' },
      { id: 'startsAt', label: 'Starts at', type: 'dateTime', required: true },
      { id: 'endsAt', label: 'Ends at', type: 'dateTime' },
      { id: 'timeZone', label: 'Time zone', type: 'text', description: 'IANA zone, for example Africa/Nairobi' },
      { id: 'venue', label: 'Venue', type: 'relation', targetCollectionSlug: 'locations' },
      { id: 'coverImage', label: 'Cover image', type: 'media', mediaKind: 'image' },
      { id: 'registrationUrl', label: 'Registration link', type: 'url' },
      { id: 'status', label: 'Status', type: 'select', options: [
        { value: 'scheduled', label: 'Scheduled' },
        { value: 'postponed', label: 'Postponed' },
        { value: 'cancelled', label: 'Cancelled' },
      ] },
    ],
  }),

  blueprint('speakers', ['events'], 'Speakers or hosts, linkable from events.', {
    slug: 'speakers',
    name: 'Speakers',
    singularLabel: 'Speaker',
    pluralLabel: 'Speakers',
    shape: 'records',
    primaryFieldId: 'name',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'title', label: 'Title', type: 'text' },
      { id: 'bio', label: 'Bio', type: 'longText' },
      { id: 'photo', label: 'Photo', type: 'media', mediaKind: 'image' },
      { id: 'event', label: 'Event', type: 'relation', targetCollectionSlug: 'events', allowMultiple: true },
    ],
  }),

  // Hospitality as content. Live availability composes bookings.
  blueprint('rooms', ['hospitality'], 'Room or unit types with nightly KES rate presentation.', {
    slug: 'rooms',
    name: 'Rooms',
    singularLabel: 'Room type',
    pluralLabel: 'Rooms',
    shape: 'content',
    primaryFieldId: 'title',
    fields: [
      { id: 'title', label: 'Name', type: 'text', required: true },
      { id: 'summary', label: 'Summary', type: 'longText' },
      { id: 'description', label: 'Description', type: 'richText', format: 'markdown' },
      { id: 'sleeps', label: 'Sleeps', type: 'number' },
      { id: 'nightlyRate', label: 'Nightly rate', type: 'number', ...KES },
      { id: 'amenities', label: 'Amenities', type: 'multiSelect', options: [
        { value: 'wifi', label: 'Wi-Fi' },
        { value: 'breakfast', label: 'Breakfast' },
        { value: 'ensuite', label: 'En-suite' },
        { value: 'balcony', label: 'Balcony' },
        { value: 'air-conditioning', label: 'Air conditioning' },
        { value: 'workspace', label: 'Workspace' },
      ] },
      { id: 'gallery', label: 'Gallery', type: 'media', mediaKind: 'image', allowMultiple: true },
      { id: 'property', label: 'Property', type: 'relation', targetCollectionSlug: 'locations' },
    ],
  }),

  blueprint('tours', ['hospitality'], 'Tours, experiences and packages with itinerary text.', {
    slug: 'tours',
    name: 'Tours',
    singularLabel: 'Tour',
    pluralLabel: 'Tours',
    shape: 'content',
    primaryFieldId: 'title',
    fields: [
      { id: 'title', label: 'Title', type: 'text', required: true },
      { id: 'summary', label: 'Summary', type: 'longText' },
      { id: 'itinerary', label: 'Itinerary', type: 'richText', format: 'markdown' },
      { id: 'durationDays', label: 'Duration in days', type: 'number' },
      { id: 'fromPrice', label: 'From price per person', type: 'number', ...KES },
      { id: 'startingPoint', label: 'Starting point', type: 'relation', targetCollectionSlug: 'locations' },
      { id: 'gallery', label: 'Gallery', type: 'media', mediaKind: 'image', allowMultiple: true },
      { id: 'season', label: 'Best season', type: 'select', options: [
        { value: 'year-round', label: 'Year round' },
        { value: 'dry', label: 'Dry season' },
        { value: 'wet', label: 'Wet season' },
        { value: 'migration', label: 'Migration' },
      ] },
    ],
  }),

  blueprint('menu-items', ['hospitality'], 'Restaurant or cafe menu items in KES.', {
    slug: 'menu-items',
    name: 'Menu items',
    singularLabel: 'Menu item',
    pluralLabel: 'Menu items',
    shape: 'records',
    primaryFieldId: 'name',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'description', label: 'Description', type: 'longText' },
      { id: 'price', label: 'Price', type: 'number', ...KES },
      { id: 'course', label: 'Course', type: 'select', options: [
        { value: 'starter', label: 'Starter' },
        { value: 'main', label: 'Main' },
        { value: 'side', label: 'Side' },
        { value: 'dessert', label: 'Dessert' },
        { value: 'drink', label: 'Drink' },
      ] },
      { id: 'vegetarian', label: 'Vegetarian', type: 'boolean' },
      { id: 'photo', label: 'Photo', type: 'media', mediaKind: 'image' },
    ],
  }),
])

/** Blueprints suited to a site family, in a stable order. */
export function blueprintsForFamily(family: CollectionBlueprint['families'][number]): readonly CollectionBlueprint[] {
  return Object.freeze(COLLECTION_BLUEPRINTS.filter((entry) => entry.families.includes(family)))
}

export function blueprintByKey(key: string): CollectionBlueprint | null {
  return COLLECTION_BLUEPRINTS.find((entry) => entry.key === key) ?? null
}

/**
 * Dependency-ordered blueprint keys, so relation targets are always provisioned
 * before the collections that reference them.
 */
export function blueprintProvisionOrder(keys: readonly string[]): readonly string[] {
  const wanted = new Set(keys)
  const ordered: string[] = []
  const visit = (key: string): void => {
    if (!wanted.has(key) || ordered.includes(key)) return
    const entry = blueprintByKey(key)
    if (!entry) return
    for (const field of entry.definition.fields) {
      if (field.type !== 'relation') continue
      const target = COLLECTION_BLUEPRINTS.find((candidate) => candidate.definition.slug === field.targetCollectionSlug)
      if (target && wanted.has(target.key) && target.key !== key) visit(target.key)
    }
    if (!ordered.includes(key)) ordered.push(key)
  }
  for (const key of keys) visit(key)
  return Object.freeze(ordered)
}
