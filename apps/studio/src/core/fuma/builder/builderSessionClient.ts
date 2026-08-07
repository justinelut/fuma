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
import { setActiveBuilderScope } from './builderScope'
import { setActivePageAllowance } from './pageAllowance'

export const BUILDER_SESSION_PATH = '/api/fuma/builder-session'

const BuilderSessionEnvelopeSchema = Type.Object({
  user: CmsCurrentUserSchema,
  /**
   * Origin the published site is served from. The builder opens its live-site
   * link against this rather than the current origin, which in the hosted
   * product is the admin host and would open the dashboard instead.
   */
  publicOrigin: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  /**
   * The plan's page allowance, so the builder can refuse a page the plan does not include.
   *
   * OPTIONAL because a self-hosted install has no plan: a required field would make this envelope
   * fail validation for every self-hosted builder, and an absent allowance is already read as an
   * unknown limit rather than as zero.
   */
  pageAllowance: Type.Optional(Type.Object({
    limit: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    planName: Type.Union([Type.String(), Type.Null()]),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

export type BuilderSessionScope = Readonly<{
  organizationId: string
  workspaceId: string
  siteId: string
}>

export type BuilderSessionResult =
  | Readonly<{ kind: 'ready', user: CmsCurrentUser, publicOrigin: string | null }>
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
    // Record the scope for the rest of the session. Every CMS request the builder makes from here
    // carries it, so the server reads and writes THIS site's document rather than the one shared
    // legacy document. Set only on success: recording a scope the server just refused would make
    // subsequent requests claim an authorisation this exchange did not establish.
    setActiveBuilderScope(Object.freeze({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      siteId: scope.siteId,
    }))
    // Populated here rather than left inert: task 68 wired the page limit at all three creation
    // paths and nothing ever set the carrier, so the free tier's one-page rule could never fire in
    // production. Absent means unknown, which ALLOWS the page - refusing because we could not resolve
    // a plan would break the product for paying customers during an entitlements outage.
    setActivePageAllowance(envelope.pageAllowance === undefined
      ? null
      : Object.freeze({
        limit: envelope.pageAllowance.limit,
        planName: envelope.pageAllowance.planName,
      }))
    return Object.freeze({
      kind: 'ready' as const,
      user: envelope.user,
      publicOrigin: envelope.publicOrigin ?? null,
    })
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
