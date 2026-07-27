import { Type, type Static } from '@sinclair/typebox'
import { parseStrict, GhostImportManifestSchema, type GhostImportManifest } from './contracts'

export type StructuredGhostDigestPort = (value: string | Uint8Array) => Promise<string>

const GhostRowSchema = Type.Record(Type.String(), Type.Unknown())
const GhostExportSchema = Type.Object({
  meta: Type.Object({ version: Type.String({ pattern: '^5\\.[0-9]+(?:\\.[0-9]+)?$' }) }, { additionalProperties: false }),
  data: Type.Object({
    posts: Type.Array(GhostRowSchema),
    users: Type.Array(GhostRowSchema),
    tags: Type.Array(GhostRowSchema),
    posts_authors: Type.Array(GhostRowSchema),
    posts_tags: Type.Array(GhostRowSchema),
    settings: Type.Array(GhostRowSchema),
    members: Type.Optional(Type.Array(GhostRowSchema)),
    newsletters: Type.Optional(Type.Array(GhostRowSchema)),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

export type GhostExportV5 = Static<typeof GhostExportSchema>
export type GhostObjectKind = 'post' | 'page' | 'author' | 'tag' | 'setting' | 'member' | 'newsletter'
export type GhostMappedObject = Readonly<{
  kind: GhostObjectKind
  sourceId: string
  destinationId: string
  contentHashSha256: string
  value: Readonly<Record<string, unknown>>
  requiresReauthentication: boolean
}>
export type GhostMediaObject = Readonly<{ sourceUrl: string; destinationKey: string; sourceHashSha256: string }>
export type StructuredGhostImportPlan = Readonly<{
  manifest: GhostImportManifest
  manifestHashSha256: string
  objects: readonly GhostMappedObject[]
  media: readonly GhostMediaObject[]
}>

const GhostAdminApiSnapshotSchema = Type.Object({
  meta: Type.Object({ version: Type.String({ pattern: '^5\\.[0-9]+(?:\\.[0-9]+)?$' }) }, { additionalProperties: false }),
  posts: Type.Array(GhostRowSchema),
  pages: Type.Array(GhostRowSchema),
  authors: Type.Array(GhostRowSchema),
  tags: Type.Array(GhostRowSchema),
  settings: Type.Array(GhostRowSchema),
  members: Type.Optional(Type.Array(GhostRowSchema)),
  newsletters: Type.Optional(Type.Array(GhostRowSchema)),
}, { additionalProperties: false })

/** Normalize paginated Admin API results after the caller has collected every page. Credentials stay in the transport and are never accepted here. */
export function ghostAdminApiSnapshotToExport(rawSnapshot: unknown): GhostExportV5 {
  const snapshot = parseStrict(GhostAdminApiSnapshotSchema, rawSnapshot, 'ghost.admin-api.snapshot')
  const postsAuthors: Readonly<Record<string, unknown>>[] = []
  const postsTags: Readonly<Record<string, unknown>>[] = []
  const normalizePost = (raw: Readonly<Record<string, unknown>>, kind: 'post' | 'page'): Readonly<Record<string, unknown>> => {
    const { authors, tags, ...post } = raw
    const postId = requiredId(post, `adminApi.${kind}`)
    if (!Array.isArray(authors) || !Array.isArray(tags)) throw new GhostImportBoundaryError('relation-invalid', `Admin API ${kind} ${postId} must include expanded authors and tags.`)
    for (const author of authors) {
      if (author === null || typeof author !== 'object') throw new GhostImportBoundaryError('relation-invalid', `Admin API ${kind} ${postId} has an invalid author.`)
      postsAuthors.push(Object.freeze({ post_id: postId, author_id: requiredId(author as Readonly<Record<string, unknown>>, `adminApi.${kind}.author`) }))
    }
    for (const tag of tags) {
      if (tag === null || typeof tag !== 'object') throw new GhostImportBoundaryError('relation-invalid', `Admin API ${kind} ${postId} has an invalid tag.`)
      postsTags.push(Object.freeze({ post_id: postId, tag_id: requiredId(tag as Readonly<Record<string, unknown>>, `adminApi.${kind}.tag`) }))
    }
    return Object.freeze({ ...post, type: kind })
  }
  return {
    meta: snapshot.meta,
    data: {
      posts: [...snapshot.posts.map((post) => normalizePost(post, 'post')), ...snapshot.pages.map((page) => normalizePost(page, 'page'))],
      users: snapshot.authors,
      tags: snapshot.tags,
      posts_authors: postsAuthors,
      posts_tags: postsTags,
      settings: snapshot.settings,
      ...(snapshot.members === undefined ? {} : { members: snapshot.members }),
      ...(snapshot.newsletters === undefined ? {} : { newsletters: snapshot.newsletters }),
    },
  }
}
export type GhostImportReceiptV2 = Readonly<{
  importId: string
  manifestHashSha256: string
  insertedIds: readonly string[]
  mediaObjectKeys: readonly string[]
  state: 'applied' | 'rolled-back'
}>

export interface GhostImportExecutionPort {
  findReceipt(manifestHashSha256: string): Promise<GhostImportReceiptV2 | null>
  begin(plan: StructuredGhostImportPlan): Promise<void>
  objectState(importId: string, kind: GhostObjectKind, sourceId: string): Promise<'pending' | 'applied'>
  applyObject(importId: string, object: GhostMappedObject): Promise<void>
  mediaState(importId: string, destinationKey: string): Promise<'pending' | 'applied'>
  fetchMedia(sourceUrl: string): Promise<Uint8Array>
  applyMedia(importId: string, media: GhostMediaObject, bytes: Uint8Array): Promise<void>
  saveCursor(importId: string, cursor: string): Promise<void>
  complete(receipt: GhostImportReceiptV2): Promise<GhostImportReceiptV2>
  rollbackObject(importId: string, object: GhostMappedObject): Promise<void>
  rollbackMedia(importId: string, media: GhostMediaObject): Promise<void>
  completeRollback(receipt: GhostImportReceiptV2): Promise<GhostImportReceiptV2>
}

export class GhostImportBoundaryError extends Error {
  constructor(readonly code: 'invalid-source' | 'secret-detected' | 'relation-invalid' | 'csv-invalid' | 'receipt-invalid', message: string) {
    super(message)
    this.name = 'GhostImportBoundaryError'
  }
}

const FORBIDDEN_KEY = /^(?:password|password_hash|session|sessions|token|access_token|refresh_token|secret|api_key|private_key|client_secret)$/i
const SENSITIVE_SETTING_KEY = /(?:password|secret|private|api[_-]?key|token|mailgun|sendgrid|smtp|aws[_-]?ses)/i
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

function sanitize(value: unknown, path = '$', depth = 0): unknown {
  if (depth > 20) throw new GhostImportBoundaryError('invalid-source', `Source nesting exceeds the safe limit at ${path}.`)
  if (typeof value === 'string') {
    if (value.length > 1_000_000) throw new GhostImportBoundaryError('invalid-source', `Source string exceeds the safe limit at ${path}.`)
    return value
  }
  if (Array.isArray(value)) return value.map((nested, index) => sanitize(nested, `${path}[${index}]`, depth + 1))
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (FORBIDDEN_KEY.test(key)) throw new GhostImportBoundaryError('secret-detected', `Forbidden source field at ${path}.${key}.`)
      result[key] = sanitize((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1)
    }
    return result
  }
  return value
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function requiredId(row: Readonly<Record<string, unknown>>, path: string): string {
  if (typeof row.id !== 'string' || !row.id.trim()) throw new GhostImportBoundaryError('relation-invalid', `${path}.id is required.`)
  return row.id
}

function optionalString(row: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = row[key]
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new GhostImportBoundaryError('invalid-source', `${key} must be a string or null.`)
  return value
}

function dateValue(row: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = optionalString(row, key)
  if (value !== null && !ISO_TIMESTAMP.test(value)) throw new GhostImportBoundaryError('invalid-source', `${key} must be an ISO UTC timestamp.`)
  return value
}

function postValue(row: Readonly<Record<string, unknown>>, kind: 'post' | 'page'): Readonly<Record<string, unknown>> {
  const sourceStatus = optionalString(row, 'status') ?? 'draft'
  if (!['draft', 'published', 'scheduled', 'sent'].includes(sourceStatus)) throw new GhostImportBoundaryError('invalid-source', `Unsupported Ghost status ${sourceStatus}.`)
  const visibility = optionalString(row, 'visibility') ?? 'public'
  if (!['public', 'members', 'paid', 'tiers'].includes(visibility)) throw new GhostImportBoundaryError('invalid-source', `Unsupported Ghost visibility ${visibility}.`)
  return Object.freeze({
    kind,
    title: optionalString(row, 'title') ?? '',
    slug: optionalString(row, 'slug') ?? requiredId(row, kind),
    html: optionalString(row, 'html'),
    lexical: optionalString(row, 'lexical'),
    mobiledoc: optionalString(row, 'mobiledoc'),
    excerpt: optionalString(row, 'custom_excerpt'),
    status: sourceStatus === 'sent' ? 'published' : sourceStatus,
    publishedAt: dateValue(row, 'published_at'),
    createdAt: dateValue(row, 'created_at'),
    updatedAt: dateValue(row, 'updated_at'),
    seo: Object.freeze({ title: optionalString(row, 'meta_title'), description: optionalString(row, 'meta_description') }),
    social: Object.freeze({ ogTitle: optionalString(row, 'og_title'), ogDescription: optionalString(row, 'og_description'), ogImage: optionalString(row, 'og_image'), twitterTitle: optionalString(row, 'twitter_title'), twitterDescription: optionalString(row, 'twitter_description'), twitterImage: optionalString(row, 'twitter_image') }),
    canonicalUrl: optionalString(row, 'canonical_url'),
    visibility,
    featureImage: optionalString(row, 'feature_image'),
    featured: row.featured === true || row.featured === 1,
  })
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index]
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { cell += '"'; index++ }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += char
  }
  if (quoted) throw new GhostImportBoundaryError('csv-invalid', 'Member CSV has an unterminated quoted field.')
  if (cell.length > 0 || row.length > 0) { row.push(cell.replace(/\r$/, '')); rows.push(row) }
  return rows.filter((fields) => fields.some((field) => field.length > 0))
}

export function parseGhostMemberCsv(csv: string): readonly Readonly<Record<string, unknown>>[] {
  if (new TextEncoder().encode(csv).byteLength > 25 * 1024 * 1024) throw new GhostImportBoundaryError('csv-invalid', 'Member CSV exceeds 25 MiB.')
  const [header, ...records] = parseCsvRows(csv)
  if (!header) throw new GhostImportBoundaryError('csv-invalid', 'Member CSV is empty.')
  const headers = header.map((field) => field.trim().toLowerCase())
  if (new Set(headers).size !== headers.length || !headers.includes('email')) throw new GhostImportBoundaryError('csv-invalid', 'Member CSV requires unique headers including email.')
  const emails = new Set<string>()
  return Object.freeze(records.map((fields, index) => {
    if (fields.length !== headers.length) throw new GhostImportBoundaryError('csv-invalid', `Member CSV row ${index + 2} has the wrong column count.`)
    const raw = Object.fromEntries(headers.map((key, column) => [key, fields[column]?.trim() ?? '']))
    const email = raw.email!.toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || emails.has(email)) throw new GhostImportBoundaryError('csv-invalid', `Member CSV row ${index + 2} has an invalid or duplicate email.`)
    emails.add(email)
    const createdAt = raw.created_at || null
    if (createdAt !== null && !ISO_TIMESTAMP.test(createdAt)) throw new GhostImportBoundaryError('csv-invalid', `Member CSV row ${index + 2} has an invalid created_at timestamp.`)
    return Object.freeze({ id: `member:${email}`, email, name: raw.name || null, note: raw.note || null, labels: raw.labels ? raw.labels.split(',').map((label) => label.trim()).filter(Boolean) : [], subscribed: !['false', '0', 'no'].includes((raw.subscribed_to_emails || 'true').toLowerCase()), created_at: createdAt })
  }))
}

function mediaUrls(posts: readonly Readonly<Record<string, unknown>>[]): string[] {
  const urls = new Set<string>()
  for (const post of posts) {
    for (const key of ['feature_image', 'og_image', 'twitter_image']) {
      const value = post[key]
      if (typeof value === 'string' && /^https?:\/\//.test(value)) urls.add(value)
    }
    if (typeof post.html === 'string') for (const [url] of post.html.matchAll(/https?:\/\/[^"'\s)<>]+/g)) urls.add(url)
  }
  return [...urls].sort()
}

export async function planStructuredGhostImport(rawSource: unknown, input: { importId: string; dryRun: boolean; digest: StructuredGhostDigestPort; memberCsv?: string }): Promise<StructuredGhostImportPlan> {
  let source: GhostExportV5
  try { source = parseStrict(GhostExportSchema, rawSource, 'ghost.export.v5') } catch (error) { throw new GhostImportBoundaryError('invalid-source', error instanceof Error ? error.message : 'Invalid Ghost export.') }
  const sanitized = sanitize(source) as GhostExportV5
  const members = input.memberCsv === undefined ? (sanitized.data.members ?? []) : parseGhostMemberCsv(input.memberCsv)
  const rows = { ...sanitized.data, members }
  const postIds = new Set(rows.posts.map((row, index) => requiredId(row, `posts[${index}]`)))
  const authorIds = new Set(rows.users.map((row, index) => requiredId(row, `users[${index}]`)))
  const tagIds = new Set(rows.tags.map((row, index) => requiredId(row, `tags[${index}]`)))
  if (postIds.size !== rows.posts.length || authorIds.size !== rows.users.length || tagIds.size !== rows.tags.length) throw new GhostImportBoundaryError('relation-invalid', 'Ghost object IDs must be unique.')
  for (const relation of rows.posts_authors) if (typeof relation.post_id !== 'string' || typeof relation.author_id !== 'string' || !postIds.has(relation.post_id) || !authorIds.has(relation.author_id)) throw new GhostImportBoundaryError('relation-invalid', 'Ghost post/author relation is invalid.')
  for (const relation of rows.posts_tags) if (typeof relation.post_id !== 'string' || typeof relation.tag_id !== 'string' || !postIds.has(relation.post_id) || !tagIds.has(relation.tag_id)) throw new GhostImportBoundaryError('relation-invalid', 'Ghost post/tag relation is invalid.')

  const objectInputs: { kind: GhostObjectKind; sourceId: string; value: Readonly<Record<string, unknown>>; reauth: boolean }[] = []
  for (const row of rows.posts) { const sourceId = requiredId(row, 'post'); const kind = row.type === 'page' ? 'page' : 'post'; objectInputs.push({ kind, sourceId, value: { ...postValue(row, kind), authorIds: rows.posts_authors.filter((relation) => relation.post_id === sourceId).map((relation) => relation.author_id), tagIds: rows.posts_tags.filter((relation) => relation.post_id === sourceId).map((relation) => relation.tag_id) }, reauth: false }) }
  for (const row of rows.users) objectInputs.push({ kind: 'author', sourceId: requiredId(row, 'author'), value: { name: optionalString(row, 'name'), slug: optionalString(row, 'slug'), email: optionalString(row, 'email'), bio: optionalString(row, 'bio'), profileImage: optionalString(row, 'profile_image') }, reauth: true })
  for (const row of rows.tags) objectInputs.push({ kind: 'tag', sourceId: requiredId(row, 'tag'), value: { name: optionalString(row, 'name'), slug: optionalString(row, 'slug'), description: optionalString(row, 'description'), visibility: optionalString(row, 'visibility') ?? 'public', metaTitle: optionalString(row, 'meta_title'), metaDescription: optionalString(row, 'meta_description') }, reauth: false })
  for (const row of rows.settings) { const key = optionalString(row, 'key'); if (!key) throw new GhostImportBoundaryError('invalid-source', 'Ghost setting key is required.'); if (SENSITIVE_SETTING_KEY.test(key)) continue; objectInputs.push({ kind: 'setting', sourceId: key, value: { key, value: row.value ?? null }, reauth: false }) }
  for (const row of members) objectInputs.push({ kind: 'member', sourceId: requiredId(row, 'member'), value: row, reauth: true })
  for (const row of rows.newsletters ?? []) objectInputs.push({ kind: 'newsletter', sourceId: requiredId(row, 'newsletter'), value: { name: optionalString(row, 'name'), description: optionalString(row, 'description'), status: optionalString(row, 'status') ?? 'active', senderName: optionalString(row, 'sender_name'), senderEmail: optionalString(row, 'sender_email'), subscribeOnSignup: row.subscribe_on_signup === true }, reauth: false })
  objectInputs.sort((left, right) => `${left.kind}:${left.sourceId}`.localeCompare(`${right.kind}:${right.sourceId}`))
  const objects: GhostMappedObject[] = []
  for (const object of objectInputs) objects.push(Object.freeze({ kind: object.kind, sourceId: object.sourceId, destinationId: `ghost:${object.kind}:${object.sourceId}`, contentHashSha256: await input.digest(stableJson(object.value)), value: Object.freeze(object.value), requiresReauthentication: object.reauth }))
  const media: GhostMediaObject[] = []
  for (const sourceUrl of mediaUrls(rows.posts)) media.push(Object.freeze({ sourceUrl, destinationKey: `imports/${input.importId}/media/${await input.digest(sourceUrl)}`, sourceHashSha256: await input.digest(sourceUrl) }))
  const relations = rows.posts_authors.concat(rows.posts_tags)
  const canonical = { posts: rows.posts, users: rows.users, tags: rows.tags, relations, settings: rows.settings, members, newsletters: rows.newsletters ?? [] }
  const manifest = parseStrict(GhostImportManifestSchema, { importId: input.importId, sourceVersion: sanitized.meta.version, sourceHashSha256: await input.digest(stableJson(canonical)), counts: { posts: objects.filter(({ kind }) => kind === 'post').length, pages: objects.filter(({ kind }) => kind === 'page').length, authors: rows.users.length, tags: rows.tags.length, settings: objects.filter(({ kind }) => kind === 'setting').length, members: members.length, newsletters: (rows.newsletters ?? []).length, relations: relations.length, media: media.length }, relationHashSha256: await input.digest(stableJson(relations)), mediaHashSha256: await input.digest(stableJson(media.map(({ sourceUrl }) => sourceUrl))), dryRun: input.dryRun, resumableCursor: objects.length || media.length ? 'object:0' : null, excludedKinds: ['passwords', 'sessions', 'provider-secrets'] }, 'ghost.import.manifest')
  return Object.freeze({ manifest, manifestHashSha256: await input.digest(stableJson(manifest)), objects: Object.freeze(objects), media: Object.freeze(media) })
}

export async function executeStructuredGhostImport(plan: StructuredGhostImportPlan, port: GhostImportExecutionPort): Promise<GhostImportReceiptV2> {
  const existing = await port.findReceipt(plan.manifestHashSha256)
  if (existing?.state === 'applied') return existing
  if (plan.manifest.dryRun) throw new GhostImportBoundaryError('invalid-source', 'A dry-run plan cannot mutate import state.')
  await port.begin(plan)
  const insertedIds: string[] = []
  const mediaObjectKeys: string[] = []
  for (let index = 0; index < plan.objects.length; index++) {
    const object = plan.objects[index]!
    if (await port.objectState(plan.manifest.importId, object.kind, object.sourceId) !== 'applied') await port.applyObject(plan.manifest.importId, object)
    insertedIds.push(object.destinationId)
    await port.saveCursor(plan.manifest.importId, `object:${index + 1}`)
  }
  for (let index = 0; index < plan.media.length; index++) {
    const media = plan.media[index]!
    if (await port.mediaState(plan.manifest.importId, media.destinationKey) !== 'applied') await port.applyMedia(plan.manifest.importId, media, await port.fetchMedia(media.sourceUrl))
    mediaObjectKeys.push(media.destinationKey)
    await port.saveCursor(plan.manifest.importId, `media:${index + 1}`)
  }
  return port.complete(Object.freeze({ importId: plan.manifest.importId, manifestHashSha256: plan.manifestHashSha256, insertedIds: Object.freeze(insertedIds), mediaObjectKeys: Object.freeze(mediaObjectKeys), state: 'applied' }))
}

export async function rollbackStructuredGhostImport(plan: StructuredGhostImportPlan, receipt: GhostImportReceiptV2, port: GhostImportExecutionPort): Promise<GhostImportReceiptV2> {
  if (receipt.manifestHashSha256 !== plan.manifestHashSha256) throw new GhostImportBoundaryError('receipt-invalid', 'Rollback manifest identity changed.')
  if (receipt.state === 'rolled-back') return receipt
  for (const media of [...plan.media].reverse()) await port.rollbackMedia(receipt.importId, media)
  for (const object of [...plan.objects].reverse()) await port.rollbackObject(receipt.importId, object)
  return port.completeRollback(Object.freeze({ ...receipt, state: 'rolled-back' }))
}

export async function compareStructuredGhostSourceParity(jsonSource: unknown, adminApiSource: unknown, input: { digest: StructuredGhostDigestPort; memberCsv?: string }): Promise<Readonly<{ jsonHashSha256: string; adminApiHashSha256: string; countsMatch: true }>> {
  const memberInput = input.memberCsv === undefined ? {} : { memberCsv: input.memberCsv }
  const json = await planStructuredGhostImport(jsonSource, { importId: 'parity-json', dryRun: true, digest: input.digest, ...memberInput })
  const api = await planStructuredGhostImport(adminApiSource, { importId: 'parity-api', dryRun: true, digest: input.digest, ...memberInput })
  if (stableJson(json.manifest.counts) !== stableJson(api.manifest.counts) || json.manifest.sourceHashSha256 !== api.manifest.sourceHashSha256 || json.manifest.relationHashSha256 !== api.manifest.relationHashSha256 || json.manifest.mediaHashSha256 !== api.manifest.mediaHashSha256) throw new GhostImportBoundaryError('invalid-source', 'Ghost JSON and Admin API sources do not describe the same canonical import.')
  return Object.freeze({ jsonHashSha256: json.manifest.sourceHashSha256, adminApiHashSha256: api.manifest.sourceHashSha256, countsMatch: true })
}
