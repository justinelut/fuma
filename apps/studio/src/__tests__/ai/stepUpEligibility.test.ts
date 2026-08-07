/**
 * Task 19: let accounts with no password complete MCP step-up.
 *
 * THE DEADLOCK: a hosted identity's CMS user carries `unusablePasswordHash()` - an argon2id hash
 * of material discarded inside the function. Step-up verifies the submitted password against it,
 * so step-up can never succeed, so MCP connector minting (which calls requireStepUp) is
 * unreachable for EVERY hosted account, not only Google ones.
 * And each attempt runs recordStepUpPasswordFailure, which counts toward LOCKOUT - so trying
 * locks you out of something you could never have done.
 */
import { describe, expect, it } from 'bun:test'
import {
  FIRST_PASSWORD_SESSION_MAX_AGE_MS,
  decideFirstPassword,
  evaluateStepUp,
  reviewStorageGap,
  shouldCountAsPasswordFailure,
} from '../../../server/auth/stepUpEligibility'

const withPassword = { hasUsablePassword: true, stepUpAuthMode: 'user', stepUpActive: false }
const withoutPassword = { hasUsablePassword: false, stepUpAuthMode: 'user', stepUpActive: false }

describe('the deadlock exists in the code as described', () => {
  it('a hosted identity is created with a hash nothing can satisfy', async () => {
    const text = await Bun.file(new URL('../../../server/fuma/builder/builderIdentity.ts', import.meta.url)).text()
    expect(text).toContain('unusablePasswordHash')
    // The plaintext is generated and discarded inside the function, which is exactly why no
    // human input can ever satisfy the stored hash.
    expect(text).toMatch(/hashPassword\(randomBytes\(48\)/)
  })

  it('step-up verifies against that same hash', async () => {
    const text = await Bun.file(new URL('../../../server/handlers/cms/auth.ts', import.meta.url)).text()
    expect(text).toMatch(/verifyPassword\(password, user\.passwordHash\)/)
  })

  it('MCP connector minting is gated by step-up', async () => {
    // This is what makes the deadlock reach a feature rather than staying theoretical.
    const text = await Bun.file(new URL('../../../server/ai/mcp/handlers/connectors.ts', import.meta.url)).text()
    expect(text).toContain('requireStepUp')
  })
})

describe('evaluateStepUp', () => {
  it('reports needs-password when there is nothing to re-enter', () => {
    const readiness = evaluateStepUp(withoutPassword)
    expect(readiness.kind).toBe('needs-password')
    if (readiness.kind !== 'needs-password') throw new Error('unreachable')
    expect(readiness.remedy).toBe('set-first-password')
  })

  it('names the cause and the action rather than claiming a wrong password', () => {
    // "Incorrect password" would be a lie that invites another attempt, and every attempt moves
    // the account closer to a lockout it can never escape by trying.
    const readiness = evaluateStepUp(withoutPassword)
    if (readiness.kind !== 'needs-password') throw new Error('unreachable')
    expect(readiness.reason).toContain('no password set')
    expect(readiness.reason).not.toMatch(/incorrect|wrong/i)
  })

  it('asks an account that HAS a password to enter it', () => {
    const readiness = evaluateStepUp(withPassword)
    expect(readiness.kind).toBe('needs-step-up')
  })

  it('is ready when the session already carries a grant', () => {
    expect(evaluateStepUp({ ...withPassword, stepUpActive: true }).kind).toBe('ready')
  })

  it('respects a disabled mode BEFORE asking for a password', () => {
    // Otherwise an installation that switched step-up off would still tell a passwordless
    // account to set one for a gate that does not apply to it.
    const readiness = evaluateStepUp({ ...withoutPassword, stepUpAuthMode: 'disabled' })
    expect(readiness.kind).toBe('not-required')
  })

  it('a disabled mode with no password is still not-required', () => {
    expect(evaluateStepUp({ hasUsablePassword: false, stepUpAuthMode: 'disabled', stepUpActive: false }).kind)
      .toBe('not-required')
  })
})

describe('shouldCountAsPasswordFailure', () => {
  it('does NOT count an attempt against a passwordless account', () => {
    // Lockout exists to slow somebody guessing a real password. There is none to guess here, so
    // counting achieves nothing except denying the legitimate owner their own account.
    expect(shouldCountAsPasswordFailure(withoutPassword)).toBe(false)
  })

  it('still counts a genuinely wrong password', () => {
    // The protection must survive: this is the case lockout was built for.
    expect(shouldCountAsPasswordFailure(withPassword)).toBe(true)
  })
})

describe('decideFirstPassword', () => {
  const fresh = { hasUsablePassword: false, mfaEnabled: false, mfaVerified: false, sessionAgeMs: 60_000 }

  it('allows a passwordless account with a recent session', () => {
    expect(decideFirstPassword(fresh).ok).toBe(true)
  })

  it('REFUSES to set a first password when one already exists', () => {
    // Routing a change through this path would turn "I forgot it" into a way past the very check
    // that stops somebody with a borrowed session taking the account over.
    const decision = decideFirstPassword({ ...fresh, hasUsablePassword: true })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('unreachable')
    expect(decision.code).toBe('already-has-password')
    expect(decision.reason).toContain('existing password')
  })

  it('demands MFA when the account has it', () => {
    // MFA is the one factor such an account definitely holds beyond the session, so it is the
    // strongest thing available to require.
    const decision = decideFirstPassword({ ...fresh, mfaEnabled: true, mfaVerified: false })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('unreachable')
    expect(decision.code).toBe('mfa-required')
  })

  it('accepts a verified MFA code', () => {
    expect(decideFirstPassword({ ...fresh, mfaEnabled: true, mfaVerified: true }).ok).toBe(true)
  })

  it('REFUSES a stale session', () => {
    // A first password OUTLIVES the session, so a cookie lifted from a dormant tab must not be
    // enough to mint a durable credential.
    const decision = decideFirstPassword({ ...fresh, sessionAgeMs: FIRST_PASSWORD_SESSION_MAX_AGE_MS + 1 })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('unreachable')
    expect(decision.code).toBe('session-not-fresh')
  })

  it('accepts a session exactly at the boundary', () => {
    expect(decideFirstPassword({ ...fresh, sessionAgeMs: FIRST_PASSWORD_SESSION_MAX_AGE_MS }).ok).toBe(true)
  })

  it('checks the existing password BEFORE freshness', () => {
    // Order matters for the message: an account that already has a password should be told to
    // use it, not sent to sign in again for a path it should not be on.
    const decision = decideFirstPassword({
      ...fresh,
      hasUsablePassword: true,
      sessionAgeMs: FIRST_PASSWORD_SESSION_MAX_AGE_MS + 1,
    })
    if (decision.ok) throw new Error('unreachable')
    expect(decision.code).toBe('already-has-password')
  })

  it('MFA outranks freshness so the stronger factor is never skipped', () => {
    const decision = decideFirstPassword({
      ...fresh,
      mfaEnabled: true,
      mfaVerified: false,
      sessionAgeMs: FIRST_PASSWORD_SESSION_MAX_AGE_MS + 1,
    })
    if (decision.ok) throw new Error('unreachable')
    expect(decision.code).toBe('mfa-required')
  })

  it('the freshness window is short enough to matter and long enough to use', () => {
    expect(FIRST_PASSWORD_SESSION_MAX_AGE_MS).toBeGreaterThanOrEqual(5 * 60_000)
    expect(FIRST_PASSWORD_SESSION_MAX_AGE_MS).toBeLessThanOrEqual(60 * 60_000)
  })
})

describe('the storage gap is reported, not hidden', () => {
  it('states that passwordlessness is not yet expressible', () => {
    // Reported as data so it is reviewable and cannot be mistaken for work already done.
    const gap = reviewStorageGap()
    expect(gap.blocking).toBe(true)
    expect(gap.reason).toContain('password_updated_at')
  })

  it('explains why the obvious signal does not work', () => {
    // password_updated_at is null for self-host accounts WITH real passwords, so deriving from
    // it would tell a self-hosted owner they have no password.
    expect(reviewStorageGap().reason).toContain('self-host')
  })
})

describe('the fix is WIRED, not inert', () => {
  it('the step-up handler consults the hosted bridge before verifying a password', async () => {
    // The lesson from tasks 20 and 52: a correct decision that nothing calls is safe and useless.
    const text = await Bun.file(new URL('../../../server/handlers/cms/auth.ts', import.meta.url)).text()
    expect(text).toContain('hostedIdentityBridgeActive()')
    // It must run BEFORE the verify, or the failure is recorded before the honest answer.
    expect(text.indexOf('hostedIdentityBridgeActive()'))
      .toBeLessThan(text.indexOf('recordStepUpPasswordFailure(db, req, user, ip)'))
  })

  it('reports a distinct code rather than an authentication failure', async () => {
    // 401 would read as "wrong password"; this is a 409 because the account is in a state that
    // has to change before the request can succeed.
    const text = await Bun.file(new URL('../../../server/handlers/cms/auth.ts', import.meta.url)).text()
    expect(text).toContain("'password_not_set'")
    expect(text).toMatch(/status: 409/)
  })

  it('self-host behaviour is unchanged because the bridge is null by default', async () => {
    const text = await Bun.file(new URL('../../../server/auth/authz.ts', import.meta.url)).text()
    expect(text).toMatch(/return hostedBuilderIdentityResolver !== null/)
  })
})
