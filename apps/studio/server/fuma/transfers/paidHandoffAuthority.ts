import {
  FUMA_STAFF_FRESH_SESSION_SECONDS,
  type HostedResolvedSession,
} from '../../auth/hosted/auth'
import type { FumaScopedRouteHandlerInput } from '../context'
import type { PaidHandoffCommandAuthority } from './paidHandoffApplication'

export type PaidHandoffHostedSessionResolver = (
  headers: Headers,
) => Promise<HostedResolvedSession | null>

export class PaidHandoffFreshSessionError extends Error {
  readonly code = 'fresh-session-required'

  constructor() {
    super('A fresh direct Better Auth staff session is required for this paid handoff action.')
    this.name = 'PaidHandoffFreshSessionError'
  }
}

/**
 * Re-resolves canonical Better Auth authority for every paid-handoff mutation.
 * The route context remains the exact tenant/permission authority; this guard
 * only proves that its effective actor still owns one fresh, direct session.
 */
export function createFreshPaidHandoffCommandAuthority(input: Readonly<{
  resolveSession: PaidHandoffHostedSessionResolver
  commands: PaidHandoffCommandAuthority
  now?: () => Date
}>): PaidHandoffCommandAuthority {
  const now = input.now ?? (() => new Date())

  async function assertFresh(request: FumaScopedRouteHandlerInput): Promise<void> {
    const instant = now()
    const session = await input.resolveSession(request.request.headers)
    const actor = request.context.actor
    const ageMs = session ? instant.getTime() - session.createdAt.getTime() : Number.NaN
    if (!Number.isFinite(instant.getTime())
      || actor.kind !== 'staff'
      || actor.impersonator !== null
      || !session
      || session.impersonatedBy !== null
      || session.userId !== actor.userId
      || session.sessionId !== actor.sessionId
      || !Number.isFinite(ageMs)
      || ageMs < 0
      || ageMs >= FUMA_STAFF_FRESH_SESSION_SECONDS * 1_000) {
      throw new PaidHandoffFreshSessionError()
    }
  }

  const authority: PaidHandoffCommandAuthority = {
    async proposal(request, readiness, selections) {
      await assertFresh(request)
      return await input.commands.proposal(request, readiness, selections)
    },
    async confirmation(request, readiness, command) {
      await assertFresh(request)
      return await input.commands.confirmation(request, readiness, command)
    },
    async start(request, readiness, command) {
      await assertFresh(request)
      return await input.commands.start(request, readiness, command)
    },
    async recovery(request, readiness, command) {
      await assertFresh(request)
      return await input.commands.recovery(request, readiness, command)
    },
    async assertAdmin(request, action) {
      await assertFresh(request)
      await input.commands.assertAdmin(request, action)
    },
  }
  return Object.freeze(authority)
}
