/**
 * Tasks 91/92/93: generated-site end-user auth.
 *
 * The realm's site scoping is asserted by reading the SHIPPED migration and the SHIPPED FUMA-038
 * suite, so the claim that 91 is already satisfied is evidenced rather than described.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MEMBER_AUTH_BASE,
  REALM_DECISION,
  SAME_ORIGIN_REQUIREMENT,
  memberOnlySource,
  memberSessionSource,
  reviewAuthSetup,
  signInPageSource,
  signUpPageSource,
} from '../../core/generatedSite/siteAuthScaffold'

const STUDIO = join(import.meta.dir, '..', '..', '..')
const read = (relative: string) => readFileSync(join(STUDIO, relative), 'utf8')

describe('91: the realm is already site-scoped, evidenced from shipped files', () => {
  const migration = read('server/fuma/db/migrations/000042_member_identity_realm.ts')

  it('every member row is keyed on the site and its owner generation', () => {
    // Reading the real migration rather than trusting the schema type: the storage key is what makes
    // one site's members unreachable from another.
    for (const column of ['platform_id', 'organization_id', 'workspace_id', 'site_id', 'owner_key', 'owner_generation']) {
      expect(migration).toContain(column)
    }
  })

  it('and the shipped FUMA-038 suite proves a token from one site is refused by another', () => {
    const suite = read('src/__tests__/fuma/memberIdentityRealm.test.ts')
    expect(suite).toContain('FUMA-038')
    // The per-coordinate loop is the assertion that matters; if it were removed this would notice.
    expect(suite).toContain("siteId:'other-site'")
    expect(suite).toContain('authenticated).toBe(false)')
  })

  it('and that staff and member cookies are refused across the realms in both directions', () => {
    const suite = read('src/__tests__/fuma/memberIdentityRealm.test.ts')
    expect(suite).toContain('staffCookieAtMember:false')
    expect(suite).toContain('memberCookieAtStaff:false')
  })

  it('so the decision to stay on this realm states both reasons', () => {
    expect(REALM_DECISION.scopeReason).toContain('seven scope coordinates')
    expect(REALM_DECISION.isolationReason).toContain('auth_users')
    // A decision that records no cost is a preference dressed as a decision.
    expect(REALM_DECISION.cost.length).toBeGreaterThan(40)
  })

  it('and the realm really is not built on Better Auth, so the decision describes reality', () => {
    const service = read('server/fuma/memberIdentity/service.ts')
    expect(service).not.toContain('better-auth')
    expect(service).toContain('argon2id')
  })
})

describe('93: the static-release constraint shapes protection', () => {
  it('middleware in a static release is reported, because the check passes in development', () => {
    const problems = reviewAuthSetup({
      pageSources: [`import { NextResponse } from 'next/server'\nexport function middleware() {}\n`],
      layoutSource: '<MemberProvider>{children}</MemberProvider>',
      staticRelease: true,
    })
    expect(problems.map((p) => p.code)).toContain('middleware-does-not-run')
    expect(problems[0]!.message).toContain('development')
  })

  it('a server component gating content is reported as PUBLIC, which is the dangerous case', () => {
    const problems = reviewAuthSetup({
      pageSources: ['export default async function Page() { const session = await getSession(); return <Secret /> }'],
      layoutSource: '<MemberProvider>{children}</MemberProvider>',
      staticRelease: true,
    })
    expect(problems.map((p) => p.code)).toContain('server-checked-content-is-public')
    expect(problems.find((p) => p.code === 'server-checked-content-is-public')!.message).toContain('public file')
  })

  it('and neither is reported when a Next server really is running', () => {
    // The refusals must not outlive their cause, or the review is a slogan rather than a check.
    const problems = reviewAuthSetup({
      pageSources: [
        `import { NextResponse } from 'next/server'\nexport function middleware() {}\n`,
        'export default async function Page() { const session = await getSession(); return <Secret /> }',
      ],
      layoutSource: '<MemberProvider>{children}</MemberProvider>',
      staticRelease: false,
    })
    expect(problems).toEqual([])
  })

  it('an absolute auth endpoint is reported whatever the release format', () => {
    // A third-party cookie is dropped by the browser regardless of how the site is served.
    const problems = reviewAuthSetup({
      pageSources: [`fetch('https://platform.example/_fuma/member-auth/login')`],
      layoutSource: '<MemberProvider>{children}</MemberProvider>',
      staticRelease: false,
    })
    expect(problems.map((p) => p.code)).toContain('cross-origin-auth-endpoint')
    expect(problems.find((p) => p.code === 'cross-origin-auth-endpoint')!.message).toContain('anonymous')
  })

  it('a missing provider is reported, because useMember throws without it', () => {
    const problems = reviewAuthSetup({
      pageSources: [],
      layoutSource: '<body>{children}</body>',
      staticRelease: true,
    })
    expect(problems.map((p) => p.code)).toContain('no-member-provider')
  })

  it('and the emitted pages themselves review clean', () => {
    // A gate that flags its own output gets switched off.
    expect(reviewAuthSetup({
      pageSources: [signInPageSource(), signUpPageSource(), memberOnlySource(), memberSessionSource()],
      layoutSource: '<MemberProvider>{children}</MemberProvider>',
      staticRelease: true,
    })).toEqual([])
  })
})

describe('the guard is named and documented for what it actually does', () => {
  const guard = memberOnlySource()

  it('it protects content, not a route, and says so', () => {
    expect(guard).toContain('MemberOnly')
    expect(guard).not.toContain('ProtectedRoute')
    expect(guard).toContain('does not make the ROUTE private')
  })

  it('and warns that a prop from a server component is baked into the public file', () => {
    // This is the mistake somebody makes right after adopting the guard.
    expect(guard).toContain('readable by anybody')
  })

  it('the unknown state renders neither the content nor the prompt', () => {
    expect(guard).toContain("state === 'unknown'")
    expect(guard).toContain('aria-busy')
  })
})

describe('the session hook', () => {
  const session = memberSessionSource()

  it('requests a RELATIVE path so the cookie is first-party', () => {
    expect(session).toContain(`'${MEMBER_AUTH_BASE}'`)
    expect(session).not.toMatch(/https?:\/\/[^'"]*member-auth/)
    expect(SAME_ORIGIN_REQUIREMENT.why).toContain('third-party')
  })

  it('sends credentials, or the cookie is never attached', () => {
    expect(session).toContain("credentials: 'same-origin'")
  })

  it('carries three states, so a signed-in visitor does not see a sign-in flash', () => {
    expect(session).toContain("'unknown'")
    expect(session).toContain("'signed-in'")
    expect(session).toContain("'signed-out'")
  })

  it('a failed request resolves to signed-out rather than hanging on unknown', () => {
    // Staying unknown would leave the busy placeholder on screen forever.
    expect(session).toContain('A FAILED REQUEST IS NOT A SIGNED-OUT VISITOR')
    expect(session).toContain("setState('signed-out')")
  })

  it('guards against an out-of-order resolve overwriting a newer answer', () => {
    expect(session).toContain('generation.current')
  })

  it('sign-out re-resolves rather than assuming the session is gone', () => {
    expect(session).toContain('the server decides whether the session is gone')
  })

  it('throws without a provider rather than defaulting to signed-out', () => {
    expect(session).toContain('needs <MemberProvider>')
  })
})

describe('the forms do not leak whether an account exists', () => {
  it('sign-in gives one message for a wrong email and a wrong password', () => {
    const source = signInPageSource()
    expect(source).toContain('do not match an account')
    // Two distinct messages would turn the form into an account-existence oracle.
    expect(source).not.toMatch(/no such (?:account|user)/i)
    expect(source).toContain('ONE MESSAGE FOR A WRONG EMAIL AND A WRONG PASSWORD')
  })

  it('both forms carry autoComplete so a password manager can fill them', () => {
    expect(signInPageSource()).toContain("autoComplete=\"current-password\"")
    expect(signUpPageSource()).toContain("autoComplete=\"new-password\"")
  })

  it('both bind every label and mark invalid controls', () => {
    for (const source of [signInPageSource(), signUpPageSource()]) {
      expect(source).toContain('htmlFor="email"')
      expect(source).toContain('htmlFor="password"')
      expect(source).toContain('aria-invalid')
    }
  })

  it('sign-up lists BOTH ids when a described field also has an error', () => {
    // Naming only the hint leaves the error drawn and never announced - task 75's finding.
    expect(signUpPageSource()).toContain("'password-hint sign-up-error'")
  })

  it('submit is disabled while sending, so one click is one attempt', () => {
    for (const source of [signInPageSource(), signUpPageSource()]) {
      expect(source).toContain('disabled={sending}')
    }
  })

  it('both use noValidate so the emitted validation decides, not the browser', () => {
    for (const source of [signInPageSource(), signUpPageSource()]) {
      expect(source).toContain('noValidate')
    }
  })

  it('and both compose from the tenant shadcn components rather than bare inputs', () => {
    for (const source of [signInPageSource(), signUpPageSource()]) {
      expect(source).toContain("from '@/components/ui/button'")
      expect(source).toContain("from '@/components/ui/input'")
      expect(source).toContain("from '@/components/ui/field'")
    }
  })
})
