import {
  NewsletterAudienceEstimateCommandSchema,
  NewsletterAudienceEstimateSchema,
  NewsletterComposerDraftSchema,
  NewsletterComposerPreviewSchema,
  NewsletterDetailResponseSchema,
  NewsletterDraftAutosaveCommandSchema,
  NewsletterIdCommandSchema,
  NewsletterListResponseSchema,
  NewsletterProfileCommandSchema,
  NewsletterSendReadinessSchema,
} from '@core/fuma/publication/newsletterComposerContracts'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import { bindPublicationScope, PublicationScopeError } from './scope'
import { NewsletterComposerError, type NewsletterComposerService } from './newsletterComposer'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const DetailPathSchema = Type.Object({ newsletterId: IdSchema }, { additionalProperties: false })
const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false })

type NewsletterPermission = 'publication.newsletters.read' | 'publication.newsletters.write' | 'publication.newsletters.send'
export type NewsletterComposerRoutePorts = Readonly<{ service: NewsletterComposerService }>

export function createNewsletterComposerScopedRouteDeclarations(ports: NewsletterComposerRoutePorts): readonly FumaScopedRouteDeclaration[] {
  return Object.freeze([
    route('GET', '/publication/newsletter-composer', 'publication.newsletters.read', async (input) => (
      json(NewsletterListResponseSchema, { newsletters: await ports.service.list(scoped(input)) })
    )),
    route('GET', '/publication/newsletter-composer/:newsletterId', 'publication.newsletters.read', async (input) => {
      const path = parameters(DetailPathSchema, input.params)
      return json(NewsletterDetailResponseSchema, await ports.service.detail(scoped(input), path.newsletterId))
    }),
    route('POST', '/publication/newsletter-composer/profile', 'publication.newsletters.write', async (input) => (
      json(NewsletterDetailResponseSchema.properties.newsletter, await ports.service.saveProfile(scoped(input), actorId(input), await body(input, NewsletterProfileCommandSchema)), 201)
    )),
    route('POST', '/publication/newsletter-composer/autosave', 'publication.newsletters.write', async (input) => (
      json(NewsletterComposerDraftSchema, await ports.service.autosave(scoped(input), actorId(input), await body(input, NewsletterDraftAutosaveCommandSchema)))
    )),
    route('POST', '/publication/newsletter-composer/audience-estimate', 'publication.newsletters.read', async (input) => {
      const command = await body(input, NewsletterAudienceEstimateCommandSchema)
      return json(NewsletterAudienceEstimateSchema, await ports.service.estimate(scoped(input), command.newsletterId, command.audience))
    }),
    route('POST', '/publication/newsletter-composer/preview', 'publication.newsletters.read', async (input) => {
      const command = await body(input, NewsletterIdCommandSchema)
      return json(NewsletterComposerPreviewSchema, await ports.service.preview(scoped(input), command.newsletterId))
    }),
    route('POST', '/publication/newsletter-composer/send-readiness', 'publication.newsletters.send', async (input) => {
      const command = await body(input, NewsletterIdCommandSchema)
      return json(NewsletterSendReadinessSchema, await ports.service.sendReadiness(scoped(input), command.newsletterId))
    }),
  ])
}

function route(method: FumaScopedRouteDeclaration['method'], path: string, permission: NewsletterPermission, handler: (input: FumaScopedRouteHandlerInput) => Promise<Response>): FumaScopedRouteDeclaration {
  return Object.freeze({ method, path, permission, handler: async (input) => {
    try { return await handler(input) } catch (error) { return failure(error) }
  } })
}
function scoped(input: FumaScopedRouteHandlerInput) { return bindPublicationScope(input.repositoryScope, input.context.profile.id) }
function actorId(input: FumaScopedRouteHandlerInput): string { return input.context.actor.kind === 'staff' ? input.context.actor.userId : input.context.actor.jobId }
async function body<T extends TSchema>(input: FumaScopedRouteHandlerInput, schema: T): Promise<Static<T>> { const result = await readValidatedBody(input.request, schema); if (result === null) throw new TypeError('Request body is invalid.'); return result }
function parameters<T extends TSchema>(schema: T, value: unknown): Static<T> { const parsed = safeParseValue(schema, value); if (!parsed.ok) throw new TypeError('Request path is invalid.'); return parsed.value }
function json<T extends TSchema>(schema: T, value: unknown, status = 200): Response { const parsed = safeParseValue(schema, value); if (!parsed.ok) throw new Error('Newsletter composer route response failed validation.'); return new Response(JSON.stringify(parsed.value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }) }
function failure(error: unknown): Response {
  const code = error instanceof NewsletterComposerError ? error.code : error instanceof PublicationScopeError ? error.code : ''
  const status = code === 'not-found' || code === 'scope-denied' || code === 'invalid-link' ? 404 : code === 'conflict' ? 409 : code === 'sender-unverified' || code === 'audience-incomplete' ? 422 : 400
  return json(ErrorSchema, { error: status === 404 ? 'Resource not found.' : error instanceof Error ? error.message : 'Newsletter composer request failed.' }, status)
}
