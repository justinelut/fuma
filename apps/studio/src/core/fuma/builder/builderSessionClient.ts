/**
 * Client for the hosted builder session exchange.
 *
 * The hosted product never reimplements site design. Opening the builder hands
 * the viewport to the Instatic application, which boots from the same CMS
 * current-user envelope it uses when self-hosted. This exchange is the only
 * hosted-specific step: it proves the staff session may design the requested
 * site and returns that envelope.
 */
import { apiRequest, type FetchLike } from '@core/http'
import { CmsCurrentUserSchema, type CmsCurrentUser } from '@core/persistence'
import { Type } from '@core/utils/typeboxHelpers'

export const BUILDER_SESSION_PATH = '/api/fuma/builder-session'

const BuilderSessionEnvelopeSchema = Type.Object({
  user: CmsCurrentUserSchema,
}, { additionalProperties: false })

export type BuilderSessionScope = Readonly<{
  organizationId: string
  workspaceId: string
  siteId: string
}>

export type BuilderSessionResult =
  | Readonly<{ kind: 'ready', user: CmsCurrentUser }>
  | Readonly<{ kind: 'forbidden' }>
  | Readonly<{ kind: 'unauthenticated' }>
  | Readonly<{ kind: 'error', message: string }>

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

export async function openBuilderSession(
  scope: BuilderSessionScope,
  fetchImpl?: FetchLike,
): Promise<BuilderSessionResult> {
  try {
    const envelope = await apiRequest(BUILDER_SESSION_PATH, {
      schema: BuilderSessionEnvelopeSchema,
      query: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        siteId: scope.siteId,
      },
      ...(fetchImpl ? { fetchImpl } : {}),
    })
    return Object.freeze({ kind: 'ready' as const, user: envelope.user })
  } catch (error) {
    const status = statusOf(error)
    if (status === 403) return Object.freeze({ kind: 'forbidden' as const })
    if (status === 401) return Object.freeze({ kind: 'unauthenticated' as const })
    return Object.freeze({
      kind: 'error' as const,
      message: error instanceof Error ? error.message : 'Could not open the builder',
    })
  }
}
