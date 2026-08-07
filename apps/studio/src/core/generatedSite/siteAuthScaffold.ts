/**
 * Generated-site end-user auth: the flows and the route protection.
 *
 * THE REALM ALREADY EXISTS AND IS ALREADY SITE-SCOPED. server/fuma/memberIdentity/ carries register,
 * login, logout, reauthenticate, session rotation, idle and absolute expiry, revocation and consent
 * events, and migration 000042 keys every row on
 * (platform_id, organization_id, workspace_id, site_id, owner_key, owner_generation, profile_id, …).
 * FUMA-038 asserts a session token bound to one site FAILS for every other coordinate, and that a
 * staff cookie is refused at the member boundary and a member cookie at the staff boundary. So what
 * was missing is not the realm - it is that a generated site has no way to reach it.
 *
 * === THE CONSTRAINT THAT DECIDES THE WHOLE DESIGN, AND IT IS TASK 63's FINDING AGAIN ===
 *
 * A release is FILES in object storage. There is no Next server running the tenant's app per request.
 * So `middleware.ts` DOES NOT RUN, and a server component cannot read a session and redirect.
 *
 * That makes the obvious approach actively dangerous rather than merely unavailable: a server
 * component that checks the session and renders member-only content produces a STATIC FILE
 * CONTAINING THAT CONTENT, served to anybody who requests the path. It works perfectly in
 * `next dev` - the check runs, the redirect happens - and once published the protected page is
 * PUBLIC. Nothing errors, and the author has no reason to look.
 *
 * So protection is: the ROUTE is public and its file contains NO protected content; the content is
 * fetched at request time with the session, and the shell renders a sign-in prompt until it arrives.
 * That is the same static-shell-with-islands shape task 57 chose, for the same reason.
 */

/** Where the platform serves the member auth boundary. Same-origin on the tenant's own hostname. */
export const MEMBER_AUTH_BASE = '/_fuma/member-auth'

export type AuthPage = 'sign-in' | 'sign-up' | 'account'

/**
 * Why the auth endpoint must be same-origin with the site, stated because getting it wrong produces a
 * flow that works for the developer and fails for real visitors.
 *
 * The session is a cookie. If the site is served from the tenant's domain and the auth endpoint from
 * ours, the cookie is THIRD-PARTY - and every current browser either blocks it outright or partitions
 * it, so the visitor signs in, the request succeeds, and the next request is anonymous. The visitor
 * sees a sign-in that "does nothing", which reads as a broken product rather than as a cookie policy.
 * A custom hostname is already served through our infrastructure, so the boundary is reachable at the
 * SITE's own origin and the cookie is first-party. The path is therefore relative, never absolute.
 */
export const SAME_ORIGIN_REQUIREMENT = Object.freeze({
  rule: 'The member auth boundary is requested at a relative path so it is same-origin with the site.',
  why: 'A session cookie set from another origin is a third-party cookie, which browsers block or partition - the visitor signs in successfully and the next request is anonymous.',
  symptom: 'Sign-in appears to do nothing, which reads as the product being broken rather than as a cookie being dropped.',
})

/** The sign-in form. Composed from the shadcn Field primitives task 75 emits. */
export function signInPageSource(): string {
  return `'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useMember } from '@/lib/member-session'

/**
 * Sign in.
 *
 * A client component because a submission is a visitor interaction, and because the session it
 * establishes is read by the browser rather than at build time.
 */
export default function SignInPage() {
  const { signIn } = useMember()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setFailure(null)
    const result = await signIn(email, password)
    setSending(false)
    // ONE MESSAGE FOR A WRONG EMAIL AND A WRONG PASSWORD. Saying which was wrong turns the form into
    // a way to discover whether an address has an account here, which is somebody's private business.
    if (!result.ok) setFailure('That email and password do not match an account.')
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={failure !== null}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={failure !== null}
          />
        </Field>
        <FieldError id="sign-in-error">{failure}</FieldError>
        <Button type="submit" disabled={sending}>
          {sending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  )
}
`
}

/** The sign-up form. */
export function signUpPageSource(): string {
  return `'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useMember } from '@/lib/member-session'

export default function SignUpPage() {
  const { signUp } = useMember()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setFailure(null)
    const result = await signUp(email, password)
    setSending(false)
    // The server decides whether the address is already registered. It deliberately does not tell us
    // which of the two it was, for the same reason sign-in does not.
    if (!result.ok) setFailure(result.message)
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={failure !== null}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <FieldDescription id="password-hint">At least 12 characters.</FieldDescription>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={failure === null ? 'password-hint' : 'password-hint sign-up-error'}
            aria-invalid={failure !== null}
          />
        </Field>
        <FieldError id="sign-up-error">{failure}</FieldError>
        <Button type="submit" disabled={sending}>
          {sending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </main>
  )
}
`
}

/**
 * The session hook the pages and the guard read.
 *
 * State is 'unknown' until the first request answers, and that third state is the point: with only
 * signed-in and signed-out, the first render is signed-out, so a member-only region flashes its
 * sign-in prompt on every page load for somebody who IS signed in.
 */
export function memberSessionSource(): string {
  return `'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/** Relative, so the request is same-origin with the site and the session cookie is first-party. */
const MEMBER_AUTH_BASE = '${MEMBER_AUTH_BASE}'

export type MemberState = 'unknown' | 'signed-in' | 'signed-out'

export type Member = Readonly<{ memberIdentityId: string; email: string; displayName: string }>

type Result = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>

type MemberContextValue = Readonly<{
  state: MemberState
  member: Member | null
  signIn: (email: string, password: string) => Promise<Result>
  signUp: (email: string, password: string) => Promise<Result>
  signOut: () => Promise<void>
}>

const MemberContext = createContext<MemberContextValue | null>(null)

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(MEMBER_AUTH_BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The session is a cookie, so it has to be sent. Same-origin still needs this to be explicit.
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
}

export function MemberProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MemberState>('unknown')
  const [member, setMember] = useState<Member | null>(null)
  // Guards against a second resolve overwriting a newer answer when a sign-in lands mid-flight.
  const generation = useRef(0)

  const resolve = useCallback(async () => {
    const mine = ++generation.current
    try {
      const response = await fetch(MEMBER_AUTH_BASE + '/session', { credentials: 'same-origin' })
      if (mine !== generation.current) return
      if (!response.ok) {
        setState('signed-out')
        setMember(null)
        return
      }
      const payload = (await response.json()) as { member?: Member }
      if (mine !== generation.current) return
      setMember(payload.member ?? null)
      setState(payload.member ? 'signed-in' : 'signed-out')
    } catch {
      // A FAILED REQUEST IS NOT A SIGNED-OUT VISITOR, but it has to resolve to something renderable.
      // Signed-out is the safe direction: it shows a sign-in prompt rather than member-only content.
      if (mine !== generation.current) return
      setState('signed-out')
      setMember(null)
    }
  }, [])

  useEffect(() => { void resolve() }, [resolve])

  const value = useMemo<MemberContextValue>(() => ({
    state,
    member,
    signIn: async (email, password) => {
      const response = await post('/login', { email, password })
      if (!response.ok) return { ok: false, message: 'That email and password do not match an account.' }
      await resolve()
      return { ok: true }
    },
    signUp: async (email, password) => {
      const response = await post('/register', { email, password })
      if (!response.ok) return { ok: false, message: 'That account could not be created.' }
      await resolve()
      return { ok: true }
    },
    signOut: async () => {
      await post('/logout', {})
      // Re-resolve rather than assuming: the server decides whether the session is gone, and
      // assuming it would show a signed-out interface while the cookie still authenticates.
      await resolve()
    },
  }), [state, member, resolve])

  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>
}

export function useMember(): MemberContextValue {
  const value = useContext(MemberContext)
  // Throws rather than returning a signed-out default, because a default would render every
  // member-only region as signed-out and read as an auth problem instead of a missing provider.
  if (!value) throw new Error('useMember needs <MemberProvider> in app/layout.tsx.')
  return value
}
`
}

/**
 * The guard.
 *
 * Named `MemberOnly` rather than `ProtectedRoute` deliberately: it protects CONTENT, not a route. A
 * route in a static release cannot be protected, and a name promising otherwise is how somebody
 * concludes their page is private when its file is public.
 */
export function memberOnlySource(): string {
  return `'use client'

import { useMember } from '@/lib/member-session'

/**
 * Renders its children only for a signed-in member.
 *
 * WHAT THIS DOES NOT DO, and the distinction matters: it does not make the ROUTE private. The page's
 * file is public in a static release. It keeps member-only CONTENT out of that file by fetching it at
 * request time, so what ships publicly is the shell.
 *
 * The consequence for whoever uses it: anything genuinely private must be FETCHED here, not passed in
 * as a prop from a server component - a prop is baked into the published file and readable by anybody.
 */
export function MemberOnly({
  children,
  fallback,
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const { state } = useMember()

  // The third state earns its place: rendering the fallback while the session is still unknown makes
  // a sign-in prompt flash on every page load for somebody who is already signed in.
  if (state === 'unknown') {
    return <div aria-busy="true" aria-live="polite" className="min-h-24" />
  }
  if (state === 'signed-out') {
    return fallback ?? (
      <p className="text-sm text-muted-foreground">
        <a className="underline" href="/sign-in">Sign in</a> to see this.
      </p>
    )
  }
  return <>{children}</>
}
`
}

export type AuthProblem = Readonly<{ code: string; message: string }>

/**
 * Reviews an auth setup for the mistakes that pass in development and fail once published.
 *
 * Every one of these produces a site that looks correct to whoever built it.
 */
export function reviewAuthSetup(input: Readonly<{
  /** Source of any file that renders member-only content. */
  pageSources: readonly string[]
  /** The site's root layout. */
  layoutSource: string
  /** True when the release is static files rather than a running Next server. */
  staticRelease: boolean
}>): readonly AuthProblem[] {
  const problems: AuthProblem[] = []

  for (const source of input.pageSources) {
    if (input.staticRelease && /export\s+(?:async\s+)?function\s+middleware|from\s+['"]next\/server['"]/.test(source)) {
      problems.push({
        code: 'middleware-does-not-run',
        message: 'This release is static files, so middleware never runs. A route it was meant to protect is served to anybody who requests it, and the check passes in development.',
      })
    }
    // A server component awaiting a session then rendering content bakes that content into a public
    // file. This is the dangerous one, because it is also the shape most auth tutorials teach.
    if (input.staticRelease && /export\s+default\s+async\s+function/.test(source) && /session|member/i.test(source)) {
      problems.push({
        code: 'server-checked-content-is-public',
        message: 'A server component cannot gate content in a static release: whatever it renders is written into a public file. Fetch member-only content in the browser instead.',
      })
    }
    if (/https?:\/\/[^'"]*_fuma\/member-auth/.test(source)) {
      problems.push({
        code: 'cross-origin-auth-endpoint',
        message: 'The auth endpoint is absolute, so the session cookie is third-party and browsers drop it. Sign-in succeeds and the next request is anonymous. Use a relative path.',
      })
    }
  }

  if (!/MemberProvider/.test(input.layoutSource)) {
    problems.push({
      code: 'no-member-provider',
      message: 'Nothing provides the session, so useMember throws and every member-only region fails to render.',
    })
  }

  return Object.freeze(problems)
}

/**
 * Why generated-site auth stays on the isolated member realm rather than moving to Better Auth.
 *
 * Recorded as data because it contradicts the obvious reading of the task, so the reason has to
 * survive somewhere a future reader will find it.
 */
export const REALM_DECISION = Object.freeze({
  decision: 'Generated-site end-user auth uses the isolated member identity realm, not the platform\'s Better Auth instance.',
  scopeReason: 'A member session binds to all seven scope coordinates (platform, organization, workspace, site, owner key, owner generation, profile), so a token issued for one site is refused by every other. Better Auth\'s session model carries a user and a token; reproducing the binding on top of it would leave Better Auth providing less than the thing it replaced.',
  isolationReason: 'Staff and members are deliberately separate tables, so one email can hold a staff account and a member account with independent sessions and no shared roles. Putting members into auth_users makes a visitor and an administrator rows in one table, where every query that forgets a filter crosses that line.',
  cost: 'The tenant does not get Better Auth\'s social sign-in or its email flows for free. Those are additions to the member realm when they are wanted, which is a smaller change than migrating a realm that already works.',
})
