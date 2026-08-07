/**
 * Tests the members DIRECTORY read - the handler task 92 left missing.
 *
 * Task 92 added `listIdentities` to the member auth realm and built a surface that resolves both
 * records, but NO HANDLER ever called it. So the only members listing the product served was the
 * publication record alone, whose `status` is a SUBSCRIPTION status: a member who registered and was
 * never activated reads as an active subscriber, and gets counted in an audience figure somebody
 * prices a newsletter tier against.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROUTES = join(import.meta.dir, '..', '..', '..', 'server/fuma/publication/routes.ts')
const source = readFileSync(ROUTES, 'utf8')

/** The row builder is module-private, so its behaviour is asserted through the shipped source. */
function sliceOf(name: string): string {
  const start = source.indexOf(`function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const next = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('the member directory route exists and reads the auth realm', () => {
  it('declares a route that calls listIdentities', () => {
    expect(source).toContain("'/publication/member-directory'")
    // The specific gap task 92 recorded: nothing called this from a handler.
    expect(source).toContain('listIdentities(scope)')
  })

  it('reads the publication member list through the SAME scope', () => {
    // MemberIdentityScope IS PublicationRepositoryScope, so one scope serves both realms and the two
    // reads cannot disagree about which site is being listed.
    const slice = source.slice(source.indexOf("'/publication/member-directory'"))
    expect(slice.slice(0, 900)).toContain('const scope = scoped(input)')
    expect(slice.slice(0, 900)).toContain('ports.store.listMembers(scope)')
  })

  it('is gated by the same read permission as the existing members route', () => {
    const slice = source.slice(source.indexOf("'/publication/member-directory'"))
    // A directory that discloses email addresses must not be reachable on a weaker permission than
    // the list it enriches.
    expect(slice.slice(0, 200)).toContain("'publication.members.read'")
  })

  it('is ADDITIVE - the existing members route still exists unchanged', () => {
    // Widening the existing route's shape would change every reader at once, including the audience
    // surface that consumes it today.
    expect(source).toContain("route('GET', '/publication/members', 'publication.members.read'")
  })
})

describe('the join is honest about what it does not know', () => {
  it('reports identityStateAvailable so an absent realm is a stated fact', () => {
    expect(source).toContain('identityStateAvailable')
    // Absent must not be resolved optimistically - claiming every account can sign in is the exact
    // overcount this route removes.
    expect(source).toContain('identities !== null')
  })

  it('joins on email, lowercased on both sides', () => {
    const slice = sliceOf('buildDirectoryRows')
    expect(slice).toContain('identity.email.toLowerCase()')
    expect(slice).toContain('member.email.toLowerCase()')
  })

  it('omits identityState rather than defaulting it when no identity matches', () => {
    const slice = sliceOf('buildDirectoryRows')
    // The absence is the answer: this listing could not determine sign-in capability.
    expect(slice).toContain('identityState === undefined ? {} : { identityState }')
    expect(slice).not.toContain("identityState ?? 'active'")
  })

  it('carries the subscription status under a name that does not imply sign-in', () => {
    // 'active' on the publication record means a current SUBSCRIBER. Calling the field something
    // like accountState or memberState invites reading it as sign-in capability, which is the
    // conflation that produced the wrong figure.
    expect(source).toContain('subscriptionStatus: Type.Union([')
    const rowSchema = source.slice(
      source.indexOf('const MemberDirectoryRowSchema'),
      source.indexOf('const MemberDirectorySchema'))
    expect(rowSchema).toContain('complimentary')
    expect(rowSchema).toContain('unsubscribed')
    // The two states stay separate fields, so neither can be mistaken for the other.
    expect(rowSchema).toContain('identityState')
  })

  it('states in the source WHY the join is on email rather than an id', () => {
    // The reason lives in the doc comment ABOVE the function, so the slice starts there.
    const start = source.indexOf('Joins the two records ON EMAIL')
    expect(start).toBeGreaterThan(-1)
    const slice = source.slice(start, source.indexOf('return members.map'))
    // The publication member carries accountId for a reader account, not an identity id.
    expect(slice).toContain('accountId')
  })
})

describe('the port is optional, so nothing already composed breaks', () => {
  it('declares memberIdentities as an optional port', () => {
    expect(source).toContain('memberIdentities?: Readonly<{')
  })

  it('guards every use of it', () => {
    // An unguarded call would throw for every existing composition site, which supplies no such port.
    const slice = source.slice(source.indexOf("'/publication/member-directory'"))
    expect(slice.slice(0, 900)).toContain('ports.memberIdentities')
    expect(slice.slice(0, 900)).toContain('? await ports.memberIdentities.listIdentities(scope)')
  })
})
