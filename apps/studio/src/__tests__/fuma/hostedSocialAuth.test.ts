import { describe, expect, it } from 'bun:test'
import {
  FUMA_STAFF_SESSION_COOKIE,
  HOSTED_SOCIAL_PROVIDER_IDS,
  createHostedAuthOptions,
  enabledHostedSocialProviders,
  type HostedAuthInput,
} from '../../../server/auth/hosted/auth'
import { AUTH_MODEL_NAMES } from '../../../server/auth/hosted/schemaManifest'

/**
 * Fuma's shared sign-in spans hosts through the FUMA-WEB-013 auth-code exchange,
 * never through a parent-domain cookie. These tests hold both halves of that
 * contract: social providers may be added, but the `__Host-` session cookie and
 * exact-origin trust boundary must not loosen.
 */

const database = {} as never
const staffProfiles = { create: async () => {} } as never

function input(overrides: Partial<HostedAuthInput> = {}): HostedAuthInput {
  return {
    baseURL: 'https://auth.trimly.co.ke',
    secret: 'x'.repeat(48),
    secureCookies: true,
    ...overrides,
  }
}

type AccountOptions = Readonly<{
  modelName?: string
  accountLinking?: Readonly<{
    enabled?: boolean
    trustedProviders?: readonly string[]
    allowDifferentEmails?: boolean
  }>
}>

describe('hosted social provider selection', () => {
  it('exposes nothing when no providers are configured', () => {
    expect(enabledHostedSocialProviders(undefined)).toEqual([])
    expect(enabledHostedSocialProviders({})).toEqual([])
  })

  it('omits a provider whose credentials are missing or blank', () => {
    expect(enabledHostedSocialProviders({ google: { clientId: 'id', clientSecret: '' } })).toEqual([])
    expect(enabledHostedSocialProviders({ google: { clientId: '   ', clientSecret: 'secret' } })).toEqual([])
    expect(enabledHostedSocialProviders({ google: { clientId: 'id', clientSecret: '   ' } })).toEqual([])
  })

  it('returns configured providers in a stable order', () => {
    expect(enabledHostedSocialProviders({
      github: { clientId: 'gh', clientSecret: 'ghs' },
      google: { clientId: 'go', clientSecret: 'gos' },
    })).toEqual(['google', 'github'])
  })

  it('only ever advertises known provider ids', () => {
    expect([...HOSTED_SOCIAL_PROVIDER_IDS]).toEqual(['google', 'github'])
  })
})

describe('hosted auth options with social sign-in', () => {
  it('adds no social configuration when unconfigured', () => {
    const options = createHostedAuthOptions(database, input(), staffProfiles)
    expect(options.socialProviders).toBeUndefined()
    const account = options.account as AccountOptions
    expect(account.modelName).toBe(AUTH_MODEL_NAMES.account)
    expect(account.accountLinking).toBeUndefined()
  })

  it('keeps email and password available alongside social sign-in', () => {
    const options = createHostedAuthOptions(database, input({
      socialProviders: { google: { clientId: 'id', clientSecret: 'secret' } },
    }), staffProfiles)
    expect(options.emailAndPassword?.enabled).toBe(true)
    expect(Object.keys(options.socialProviders ?? {})).toEqual(['google'])
  })

  it('pins every callback to the exact auth origin', () => {
    const options = createHostedAuthOptions(database, input({
      socialProviders: {
        google: { clientId: 'a', clientSecret: 'b' },
        github: { clientId: 'c', clientSecret: 'd' },
      },
    }), staffProfiles)
    const providers = options.socialProviders as Record<string, { redirectURI: string }>
    expect(providers.google?.redirectURI).toBe('https://auth.trimly.co.ke/api/auth/callback/google')
    expect(providers.github?.redirectURI).toBe('https://auth.trimly.co.ke/api/auth/callback/github')
    for (const provider of Object.values(providers)) {
      expect(provider.redirectURI.startsWith('https://auth.trimly.co.ke/')).toBe(true)
      expect(provider.redirectURI).not.toContain('*')
    }
  })

  it('links accounts only for configured providers and matching verified emails', () => {
    const options = createHostedAuthOptions(database, input({
      socialProviders: { google: { clientId: 'a', clientSecret: 'b' } },
    }), staffProfiles)
    const account = options.account as AccountOptions
    expect(account.modelName).toBe(AUTH_MODEL_NAMES.account)
    expect(account.accountLinking?.enabled).toBe(true)
    expect(account.accountLinking?.trustedProviders).toEqual(['google'])
    // A social identity must not claim a different address than the Fuma account.
    expect(account.accountLinking?.allowDifferentEmails).toBe(false)
  })

  it('never widens the session cookie to a parent domain', () => {
    const options = createHostedAuthOptions(database, input({
      socialProviders: { google: { clientId: 'a', clientSecret: 'b' } },
    }), staffProfiles)
    const advanced = options.advanced as Readonly<{
      useSecureCookies?: boolean
      defaultCookieAttributes?: Record<string, unknown>
      cookies?: { session_token?: { name?: string; attributes?: Record<string, unknown> } }
    }>
    expect(advanced.cookies?.session_token?.name).toBe(FUMA_STAFF_SESSION_COOKIE)
    expect(FUMA_STAFF_SESSION_COOKIE.startsWith('__Host-')).toBe(true)
    // `__Host-` is only valid without Domain; assert no layer sets one.
    expect(advanced.defaultCookieAttributes).not.toHaveProperty('domain')
    expect(advanced.cookies?.session_token?.attributes).not.toHaveProperty('domain')
    expect(advanced.cookies?.session_token?.attributes?.path).toBe('/')
    expect(advanced.cookies?.session_token?.attributes?.httpOnly).toBe(true)
    expect(advanced.cookies?.session_token?.attributes?.sameSite).toBe('lax')
    expect(advanced.cookies?.session_token?.attributes?.secure).toBe(true)
  })

  it('trusts only the exact auth origin', () => {
    const options = createHostedAuthOptions(database, input({
      socialProviders: { google: { clientId: 'a', clientSecret: 'b' } },
    }), staffProfiles)
    expect(options.trustedOrigins).toEqual(['https://auth.trimly.co.ke'])
  })

  it('keeps MFA and organization plugins active with social sign-in', () => {
    const options = createHostedAuthOptions(database, input({
      socialProviders: { google: { clientId: 'a', clientSecret: 'b' } },
    }), staffProfiles)
    const ids = (options.plugins ?? []).map((plugin) => (plugin as { id?: string }).id)
    expect(ids).toContain('two-factor')
    expect(ids).toContain('organization')
  })
})
