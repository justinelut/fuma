import {
  DynamicPublicationAudienceSchema,
  DynamicPublicationLoopPageSchema,
  DynamicPublicationLoopQuerySchema,
  DynamicPublicationTemplateSchema,
  canonicalDynamicPublicationPath,
  parseDynamicPublicationContract,
  type DynamicPublicationTarget,
} from '@core/fuma/publication/dynamicPublication'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import { bindPublicationScope, type PublicationRepositoryScope } from './scope'
import { DynamicPublicationError, type DynamicPublicationService } from './dynamicPublicationService'

const TemplateListSchema = Type.Object({ templates: Type.Array(DynamicPublicationTemplateSchema, { maxItems: 10_000 }) }, { additionalProperties: false })
const TemplateSaveSchema = Type.Object({
  template: DynamicPublicationTemplateSchema,
  expectedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
}, { additionalProperties: false })
const PreviewSchema = Type.Object({
  template: DynamicPublicationTemplateSchema,
  page: DynamicPublicationLoopPageSchema,
  html: Type.String({ minLength: 1, maxLength: 2_000_000 }),
}, { additionalProperties: false })
const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const PreviewQuerySchema = Type.Object({
  kind: DynamicPublicationLoopQuerySchema.properties.target.properties.kind,
  targetId: Type.String({ minLength: 1, maxLength: 255 }),
  page: Type.Integer({ minimum: 1, maximum: 10_000 }),
  pageSize: Type.Integer({ minimum: 1, maximum: 50 }),
  asOf: DynamicPublicationLoopQuerySchema.properties.asOf,
}, { additionalProperties: false })

export function createDynamicPublicationScopedRouteDeclarations(service: DynamicPublicationService): readonly FumaScopedRouteDeclaration[] {
  const route = (
    method: FumaScopedRouteDeclaration['method'],
    path: string,
    permission: string,
    handler: (input: FumaScopedRouteHandlerInput) => Promise<Response>,
  ): FumaScopedRouteDeclaration => Object.freeze({ method, path, permission, handler: async (input) => {
    try { return await handler(input) } catch (error) { return scopedFailure(error) }
  } }) as FumaScopedRouteDeclaration
  return Object.freeze([
    route('GET', '/publication/dynamic-templates', 'website.design.read', async (input) => json(TemplateListSchema, {
      templates: await service.listTemplates(scoped(input)),
    })),
    route('POST', '/publication/dynamic-templates', 'website.design.write', async (input) => {
      const command = await strictBody(input.request, TemplateSaveSchema)
      return json(DynamicPublicationTemplateSchema, await service.saveTemplate(scoped(input), command.template, command.expectedVersion))
    }),
    route('GET', '/publication/dynamic-preview', 'website.design.read', async (input) => {
      const query = previewQuery(input.request)
      return json(PreviewSchema, await service.render(scoped(input), {
        target: { kind: query.kind, targetId: query.targetId },
        page: query.page,
        pageSize: query.pageSize,
        audience: { member: true, paid: true, segmentIds: [] },
        asOf: query.asOf,
      }))
    }),
  ])
}

export interface DynamicPublicationHostAuthority {
  scopeForHost(host: string): Promise<PublicationRepositoryScope | null>
}
export interface DynamicPublicationAudienceAuthority {
  audienceForRequest(request: Request, scope: PublicationRepositoryScope): Promise<Static<typeof DynamicPublicationAudienceSchema>>
}
export type DynamicPublicationPublicBoundaryOptions = Readonly<{
  service: DynamicPublicationService
  hosts: DynamicPublicationHostAuthority
  audience: DynamicPublicationAudienceAuthority
  now?: () => Date
  pageSize?: number
}>

export class DynamicPublicationPublicBoundary {
  readonly #options: DynamicPublicationPublicBoundaryOptions
  constructor(options: DynamicPublicationPublicBoundaryOptions) {
    if (options.pageSize !== undefined && (!Number.isSafeInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 50)) {
      throw new RangeError('Dynamic Publication public page size must be between 1 and 50.')
    }
    this.#options = options
  }
  handles(request: Request): boolean { return parseDynamicPublicationPath(new URL(request.url).pathname) !== null }
  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url)
    const target = parseDynamicPublicationPath(url.pathname)
    if (!target) return null
    if (request.method !== 'GET' && request.method !== 'HEAD') return publicResponse(405, 'Method not allowed.')
    const scope = await this.#options.hosts.scopeForHost(url.host.toLowerCase())
    if (!scope) return publicResponse(404, 'Not found.')
    const pageValue = url.searchParams.get('page') ?? '1'
    if (!/^\d+$/.test(pageValue)) return publicResponse(404, 'Not found.')
    const page = Number(pageValue)
    if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) return publicResponse(404, 'Not found.')
    const canonical = canonicalDynamicPublicationPath(target, page)
    const noncanonicalQuery = [...url.searchParams.keys()].some((key) => key !== 'page') || (page === 1 && url.searchParams.has('page'))
    if (url.pathname !== canonical.split('?')[0] || noncanonicalQuery) {
      return new Response(null, { status: 308, headers: { location: canonical, 'cache-control': 'no-store' } })
    }
    try {
      const audience = parseDynamicPublicationContract('public audience', DynamicPublicationAudienceSchema, await this.#options.audience.audienceForRequest(request, scope))
      const rendered = await this.#options.service.render(scope, {
        target,
        page,
        pageSize: this.#options.pageSize ?? 20,
        audience,
        asOf: (this.#options.now ?? (() => new Date()))().toISOString(),
      })
      const canonicalUrl = new URL(rendered.page.canonicalPath, url.origin).toString()
      return new Response(request.method === 'HEAD' ? null : `<!doctype html><html><head><link rel="canonical" href="${escapeAttribute(canonicalUrl)}"></head><body>${rendered.html}</body></html>`, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': audience.member || audience.paid || audience.segmentIds.length ? 'private, no-store' : 'public, max-age=60',
          link: `<${canonicalUrl}>; rel="canonical"`,
        },
      })
    } catch (error) {
      if (error instanceof DynamicPublicationError && (error.code === 'not-found' || error.code === 'page-out-of-range')) return publicResponse(404, 'Not found.')
      throw error
    }
  }
}

export function parseDynamicPublicationPath(pathname: string): DynamicPublicationTarget | null {
  const segments = pathname.split('/').filter(Boolean)
  try {
    if (segments.length === 2 && ['posts', 'pages', 'authors', 'tags', 'collections'].includes(segments[0]!)) {
      const kinds = { posts: 'post', pages: 'page', authors: 'author', tags: 'tag', collections: 'collection' } as const
      return parseDynamicPublicationContract('public route target', DynamicPublicationLoopQuerySchema.properties.target, {
        kind: kinds[segments[0] as keyof typeof kinds], targetId: decodeURIComponent(segments[1]!),
      })
    }
    if (segments[0] === 'archive' && (segments.length === 2 || segments.length === 3)) {
      const id = segments.slice(1).map(decodeURIComponent).join('-')
      if (!/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(id)) return null
      return parseDynamicPublicationContract('public date target', DynamicPublicationLoopQuerySchema.properties.target, { kind: 'date', targetId: id })
    }
  } catch { return null }
  return null
}

function scoped(input: FumaScopedRouteHandlerInput): PublicationRepositoryScope { return bindPublicationScope(input.repositoryScope, input.context.profile.id) }
async function strictBody<T extends TSchema>(request: Request, schema: T): Promise<Static<T>> {
  const value = await readValidatedBody(request, schema)
  if (value === null) throw new TypeError('Dynamic Publication request body is invalid.')
  return value
}
function previewQuery(request: Request): Static<typeof PreviewQuerySchema> {
  const values = new URL(request.url).searchParams
  const parsed = safeParseValue(PreviewQuerySchema, {
    kind: values.get('kind'), targetId: values.get('targetId'), page: Number(values.get('page') ?? 1),
    pageSize: Number(values.get('pageSize') ?? 20), asOf: values.get('asOf') ?? new Date().toISOString(),
  })
  if (!parsed.ok) throw new TypeError('Dynamic Publication preview query is invalid.')
  return parsed.value
}
function json<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Dynamic Publication route response failed validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}
function scopedFailure(error: unknown): Response {
  const status = error instanceof DynamicPublicationError && error.code === 'not-found' ? 404 : error instanceof DynamicPublicationError && error.code === 'conflict' ? 409 : 400
  return json(ErrorSchema, { error: status === 404 ? 'Resource not found.' : error instanceof Error ? error.message : 'Dynamic Publication request failed.' }, status)
}
function publicResponse(status: number, message: string): Response { return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }) }
function escapeAttribute(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') }
