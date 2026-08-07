/**
 * Whether an account can complete step-up, and what to do when it cannot.
 *
 * THE DEADLOCK, established by reading the code rather than inferred.
 *
 * A hosted identity's CMS user is created by builderIdentity.ts with
 * `unusablePasswordHash()` - an argon2id hash of random material that is DISCARDED inside the
 * function. That is deliberate and correct for its own purpose: nothing can ever satisfy it, and
 * a real hash keeps `Bun.password.verify` on its normal comparison path where a sentinel string
 * would make it throw.
 *
 * But step-up (`POST` /step-up in handlers/cms/auth.ts) verifies the submitted password against
 * exactly that hash. So step-up CANNOT SUCCEED FOR ANY HOSTED ACCOUNT - not only Google ones,
 * which is wider than the defect was reported as. And MCP connector minting calls
 * `requireStepUp` (mcp/handlers/connectors.ts:79), so minting a connector token is unreachable
 * for every hosted customer.
 *
 * IT IS WORSE THAN UNREACHABLE. A failed attempt runs `recordStepUpPasswordFailure`, which
 * counts toward account lockout. So somebody trying a few times to do the thing the interface
 * offers gets LOCKED OUT of their account for failing at something that could never have
 * succeeded. A dead end that punishes persistence is the worst shape this defect could take.
 *
 * So the remedy has two halves, and both are required:
 *   1. an account with no usable password must be TOLD SO, and its attempts must not be counted
 *      as wrong passwords - a wrong-password message sends somebody to try harder; and
 *   2. it must be able to SET a first password, because that is what step-up verifies.
 */

export type StepUpReadiness =
  | Readonly<{ kind: 'ready' }>
  | Readonly<{ kind: 'needs-password', reason: string, remedy: 'set-first-password' }>
  | Readonly<{ kind: 'needs-step-up', reason: string, remedy: 'enter-password' }>
  | Readonly<{ kind: 'not-required', reason: string }>

export interface StepUpSubject {
  /**
   * Whether a password exists that a human could actually enter.
   *
   * REQUIRED as an explicit fact rather than derived here, because the derivation is exactly
   * what the storage cannot currently express: `unusablePasswordHash()` is a syntactically
   * valid argon2id hash of discarded random material, so it is INDISTINGUISHABLE from a real
   * one by inspection. `passwordUpdatedAt === null` does not separate them either - the
   * self-host `createUser` path also leaves it null, so using it would tell a self-hosted owner
   * with a perfectly good password that they have none.
   *
   * The caller that knows is the one that created the row. Making that fact durable is the
   * storage change this decision depends on; see reviewStorageGap() below.
   */
  readonly hasUsablePassword: boolean
  /** 'disabled' means this installation does not ask for step-up at all. */
  readonly stepUpAuthMode: string
  /** Whether the current session already carries an unexpired step-up grant. */
  readonly stepUpActive: boolean
}

export function evaluateStepUp(subject: StepUpSubject): StepUpReadiness {
  // Honoured FIRST so an installation that switched step-up off is never told to set a password
  // for a gate it does not apply. Mirrors requireStepUp's own ordering.
  if (subject.stepUpAuthMode === 'disabled') {
    return Object.freeze({ kind: 'not-required' as const, reason: 'Step-up is disabled for this account.' })
  }
  if (subject.stepUpActive) {
    return Object.freeze({ kind: 'ready' as const })
  }
  if (!subject.hasUsablePassword) {
    // The message names the CAUSE and the ACTION. "Incorrect password" would be a lie that
    // invites another attempt, and every attempt moves the account closer to lockout.
    return Object.freeze({
      kind: 'needs-password' as const,
      reason: 'This account signed in through an identity provider and has no password set, so there is nothing to re-enter. Set a password to confirm sensitive actions.',
      remedy: 'set-first-password' as const,
    })
  }
  return Object.freeze({
    kind: 'needs-step-up' as const,
    reason: 'Confirm your password to continue.',
    remedy: 'enter-password' as const,
  })
}

/**
 * Whether a failed step-up attempt should count toward lockout.
 *
 * FALSE for an account with no usable password: counting it locks somebody out for failing a
 * challenge that could never be met. Lockout exists to slow an attacker guessing a real
 * password, and there is no password here to guess, so counting achieves nothing except denying
 * the legitimate owner.
 */
export function shouldCountAsPasswordFailure(subject: StepUpSubject): boolean {
  return subject.hasUsablePassword
}

export type FirstPasswordDecision =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false, code: 'already-has-password' | 'mfa-required' | 'session-not-fresh', reason: string }>

export interface FirstPasswordRequest {
  readonly hasUsablePassword: boolean
  /** Whether the account has MFA enrolled. */
  readonly mfaEnabled: boolean
  /** Whether a valid MFA code accompanied the request. */
  readonly mfaVerified: boolean
  /**
   * Whether the session was established recently enough to stand in for re-authentication.
   * A first password is a DURABLE credential, so the session that sets it has to be one the
   * account holder plausibly still has in front of them.
   */
  readonly sessionAgeMs: number
}

/**
 * How fresh a session must be to set a first password.
 *
 * Setting a first password mints a credential that OUTLIVES THE SESSION, so a stolen
 * long-lived cookie must not be enough. Requiring recency means an attacker needs a session
 * they only just obtained, which is a materially higher bar than one lifted from a dormant tab.
 * Fifteen minutes because it has to be long enough to complete the flow after a real sign-in
 * and short enough that a cookie found later is useless.
 */
export const FIRST_PASSWORD_SESSION_MAX_AGE_MS = 15 * 60_000

export function decideFirstPassword(request: FirstPasswordRequest): FirstPasswordDecision {
  if (request.hasUsablePassword) {
    // CHANGING a password must still present the old one. Routing a change through the
    // first-password path would turn "I forgot it" into a way past the check that exists to
    // stop somebody with a borrowed session from taking the account over.
    return Object.freeze({
      ok: false as const,
      code: 'already-has-password' as const,
      reason: 'This account already has a password. Change it with the existing password instead.',
    })
  }
  if (request.mfaEnabled && !request.mfaVerified) {
    // MFA is the ONE factor such an account definitely holds beyond the session, so it is the
    // strongest thing available to demand and it must not be skippable.
    return Object.freeze({
      ok: false as const,
      code: 'mfa-required' as const,
      reason: 'Enter your authenticator code to set a password.',
    })
  }
  if (request.sessionAgeMs > FIRST_PASSWORD_SESSION_MAX_AGE_MS) {
    return Object.freeze({
      ok: false as const,
      code: 'session-not-fresh' as const,
      reason: 'Sign in again, then set your password. A password outlives this session, so it is only set from a recent sign-in.',
    })
  }
  return Object.freeze({ ok: true as const })
}

/**
 * The storage change this depends on, stated rather than guessed at.
 *
 * Returned as data so the gap is reviewable and cannot be mistaken for something already done.
 */
export function reviewStorageGap(): Readonly<{ blocking: boolean, reason: string }> {
  return Object.freeze({
    blocking: true,
    reason: 'The users table cannot express "no usable password": unusablePasswordHash() stores a valid argon2id hash of discarded random material, and password_updated_at is null for self-host accounts with real passwords too. Until a column records it, hasUsablePassword must be supplied by the caller that created the row.',
  })
}
