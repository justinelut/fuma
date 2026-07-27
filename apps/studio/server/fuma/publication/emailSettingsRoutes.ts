import {
  EmailSettingsChangeCommandSchema,
  EmailSettingsVersionSchema,
  EmailVariableCatalogSchema,
  EmailVariableModeSchema,
  ResolvedEmailSettingsV2Schema,
} from '@core/fuma/publication/emailSettingsContracts'
import { Type, safeParseValue, type Static, type TSchema } from '@core/utils/typeboxHelpers'
import { readValidatedBody } from '../../http'
import type { FumaScopedRouteDeclaration, FumaScopedRouteHandlerInput } from '../context'
import { bindPublicationScope } from './scope'
import { EmailSettingsError, HierarchicalEmailSettingsService, emailVariableCatalog } from './emailSettings'

const IdSchema = Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' })
const NewsletterPathSchema = Type.Object({ newsletterId: IdSchema }, { additionalProperties: false })
const ModePathSchema = Type.Object({ mode: EmailVariableModeSchema }, { additionalProperties: false })
const ErrorSchema = Type.Object({ error: Type.String({ minLength: 1, maxLength: 160 }) }, { additionalProperties: false })

export type EmailSettingsRoutePorts = Readonly<{ service: HierarchicalEmailSettingsService }>

export function createEmailSettingsScopedRouteDeclarations(ports: EmailSettingsRoutePorts): readonly FumaScopedRouteDeclaration[] {
  return Object.freeze([
    route('POST', '/publication/email-settings/versions', 'site.settings.write', async (input) => {
      const command = await body(input, EmailSettingsChangeCommandSchema)
      return json(EmailSettingsVersionSchema, await ports.service.change(scoped(input), actorId(input), command), 201)
    }),
    route('GET', '/publication/email-settings/resolved/:newsletterId', 'site.settings.read', async (input) => {
      const path = parameters(NewsletterPathSchema, input.params)
      return json(ResolvedEmailSettingsV2Schema, await ports.service.resolve(scoped(input), path.newsletterId))
    }),
    route('GET', '/publication/email-settings/resolved', 'site.settings.read', async (input) => (
      json(ResolvedEmailSettingsV2Schema, await ports.service.resolve(scoped(input), null))
    )),
    route('GET', '/publication/email-settings/variables/:mode', 'site.settings.read', async (input) => {
      const path = parameters(ModePathSchema, input.params)
      return json(EmailVariableCatalogSchema, emailVariableCatalog(path.mode))
    }),
  ])
}

function route(
  method: FumaScopedRouteDeclaration['method'],
  path: string,
  permission: 'site.settings.read' | 'site.settings.write',
  handler: (input: FumaScopedRouteHandlerInput) => Promise<Response>,
): FumaScopedRouteDeclaration {
  return Object.freeze({ method, path, permission, handler: async (input) => {
    try { return await handler(input) } catch (error) { return failure(error) }
  } })
}
function scoped(input: FumaScopedRouteHandlerInput) {
  return bindPublicationScope(input.repositoryScope, input.context.profile.id)
}
function actorId(input: FumaScopedRouteHandlerInput): string {
  return input.context.actor.kind === 'staff' ? input.context.actor.userId : input.context.actor.jobId
}
async function body<T extends TSchema>(input: FumaScopedRouteHandlerInput, schema: T): Promise<Static<T>> {
  const result = await readValidatedBody(input.request, schema)
  if (result === null) throw new TypeError('Request body is invalid.')
  return result
}
function parameters<T extends TSchema>(schema: T, value: unknown): Static<T> {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new TypeError('Request path is invalid.')
  return parsed.value
}
function json<T extends TSchema>(schema: T, value: unknown, status = 200): Response {
  const parsed = safeParseValue(schema, value)
  if (!parsed.ok) throw new Error('Email settings route response failed validation.')
  return new Response(JSON.stringify(parsed.value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}
function failure(error: unknown): Response {
  const code = error instanceof EmailSettingsError ? error.code : ''
  const status = code === 'scope-denied' ? 404 : code === 'conflict' ? 409 : 400
  const message = status === 404
    ? 'Resource not found.'
    : code === 'secret-variable' || code === 'unknown-variable'
      ? 'Email variable request denied.'
      : error instanceof Error ? error.message : 'Email settings request failed.'
  return json(ErrorSchema, { error: message }, status)
}
