/**
 * Task 92: the site members surface, scoped to the tenant's own users.
 *
 * The assertions that matter most are about the TWO-RECORD resolution, because that is where a list
 * can look correct and overstate the audience.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, cleanup } from '@testing-library/react'
import {
  DIRECTORY_CONTRACT,
  VISIBLE_MEMBER_LIMIT,
  countsFor,
  describeState,
  effectiveState,
  isListable,
  reviewDirectory,
  searchMembers,
  type MemberRow,
} from '../../core/fuma/memberDirectory'
import { SiteMembersSurface } from '../../admin/fuma/members/SiteMembersSurface'

const STUDIO = join(import.meta.dir, '..', '..', '..')

function row(over: Partial<MemberRow> = {}): MemberRow {
  return {
    memberIdentityId: over.memberIdentityId ?? 'member-1',
    email: over.email,
    displayName: over.displayName ?? 'Ada Reader',
    identityState: over.identityState ?? 'active',
    accountState: over.accountState,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00.000Z',
  }
}

describe('THE RESOLUTION: two records, one state', () => {
  it('a never-activated identity is NOT active however the account reads', () => {
    // The defect this file exists to prevent: the profile says active, the person cannot sign in.
    expect(effectiveState(row({ identityState: 'activation-required', accountState: 'active' })))
      .toBe('never-activated')
  })

  it('removal outranks everything, including an active credential', () => {
    expect(effectiveState(row({ identityState: 'active', accountState: 'deleted' }))).toBe('removed')
    expect(effectiveState(row({ identityState: 'active', accountState: 'deletion-pending' }))).toBe('removed')
  })

  it('disabled in EITHER record is disabled', () => {
    // Taking the permissive reading would let a stale profile re-open a door the auth realm closed.
    expect(effectiveState(row({ identityState: 'disabled', accountState: 'active' }))).toBe('disabled')
    expect(effectiveState(row({ identityState: 'active', accountState: 'disabled' }))).toBe('disabled')
  })

  it('an identity with no account at all still resolves, for a website-profile site', () => {
    expect(effectiveState(row({ accountState: undefined }))).toBe('active')
    expect(effectiveState(row({ identityState: 'activation-required', accountState: undefined })))
      .toBe('never-activated')
  })

  it('a removed member is not listable', () => {
    expect(isListable(row({ accountState: 'deleted' }))).toBe(false)
    expect(isListable(row())).toBe(true)
  })
})

describe('counts are never one total', () => {
  const rows = [
    row({ memberIdentityId: 'a' }),
    row({ memberIdentityId: 'b' }),
    row({ memberIdentityId: 'c', identityState: 'activation-required' }),
    row({ memberIdentityId: 'd', identityState: 'disabled' }),
    row({ memberIdentityId: 'e', accountState: 'deleted' }),
  ]

  it('each state is counted separately', () => {
    expect(countsFor(rows)).toEqual({ active: 2, neverActivated: 1, disabled: 1, removed: 1 })
  })

  it('so a never-activated registration cannot hide inside an audience number', () => {
    // The whole point: 5 rows, but only 2 people have actually arrived.
    const counts = countsFor(rows)
    expect(counts.active).toBe(2)
    expect(counts.active + counts.neverActivated).not.toBe(counts.active)
  })

  it('and the contract states why no single total is offered', () => {
    expect(DIRECTORY_CONTRACT.noSingleTotal).toContain('overstates the audience')
  })
})

describe('search', () => {
  const rows = [
    row({ memberIdentityId: 'a', displayName: 'Ada Reader', email: 'ada@example.com' }),
    row({ memberIdentityId: 'b', displayName: 'Grace Writer', email: 'grace@example.com' }),
    row({ memberIdentityId: 'c', displayName: 'Deleted Person', email: 'gone@example.com', accountState: 'deleted' }),
  ]

  it('matches on the display name', () => {
    expect(searchMembers(rows, 'grace').visible.map((r) => r.memberIdentityId)).toEqual(['b'])
  })

  it('and on the email, because a support request arrives with an address', () => {
    expect(searchMembers(rows, 'ada@example').visible.map((r) => r.memberIdentityId)).toEqual(['a'])
  })

  it('a removed member cannot be found by typing their address', () => {
    expect(searchMembers(rows, 'gone@example.com').visible).toHaveLength(0);
    expect(searchMembers(rows, '').visible.map((r) => r.memberIdentityId)).toEqual(['a', 'b'])
  })

  it('reports the hidden count so the cap is not mistaken for the whole list', () => {
    const many = Array.from({ length: VISIBLE_MEMBER_LIMIT + 7 }, (_, i) =>
      row({ memberIdentityId: `m-${i}`, displayName: `Member ${i}` }))
    const result = searchMembers(many, '')
    expect(result.visible).toHaveLength(VISIBLE_MEMBER_LIMIT)
    expect(result.hidden).toBe(7)
    expect(result.matched).toBe(VISIBLE_MEMBER_LIMIT + 7)
  })

  it('a row with no email is searchable by name without throwing', () => {
    expect(searchMembers([row({ email: undefined })], 'ada').visible).toHaveLength(1)
  })
})

describe('the state description states the consequence', () => {
  it('never-activated says they cannot sign in, not merely "pending"', () => {
    expect(describeState('never-activated')).toContain('cannot sign in')
    expect(describeState('disabled')).toContain('cannot sign in')
  })
})

describe('the review records the real enumeration gap', () => {
  it('reports that identities cannot be listed, naming what closes it', () => {
    const problems = reviewDirectory({ rows: [], hasPublicationAccounts: true, identitiesEnumerable: false })
    expect(problems.map((p) => p.code)).toContain('identities-not-enumerable')
    expect(problems[0]!.message).toContain('findIdentityByEmail')
  })

  it('and stops reporting it once identities are readable', () => {
    expect(reviewDirectory({ rows: [], hasPublicationAccounts: true, identitiesEnumerable: true })).toEqual([])
  })

  it('an account state on a site with no accounts is a disagreement between sources', () => {
    const problems = reviewDirectory({
      rows: [row({ accountState: 'active' })],
      hasPublicationAccounts: false,
      identitiesEnumerable: true,
    })
    expect(problems.map((p) => p.code)).toContain('account-state-without-accounts')
  })

  it('a row with no identity is reported, because nothing in the list could act on it', () => {
    const problems = reviewDirectory({
      rows: [row({ memberIdentityId: '' })],
      hasPublicationAccounts: true,
      identitiesEnumerable: true,
    })
    expect(problems.map((p) => p.code)).toContain('row-without-identity')
  })
})

describe('the surface', () => {
  function renderSurface(props: Partial<Parameters<typeof SiteMembersSurface>[0]> = {}) {
    cleanup()
    render(<SiteMembersSurface rows={props.rows ?? []} incompleteReason={props.incompleteReason ?? null} />)
  }

  it('shows active and never-activated as separate figures', () => {
    renderSurface({
      rows: [row({ memberIdentityId: 'a' }), row({ memberIdentityId: 'b', identityState: 'activation-required' })],
    })
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Never activated')).toBeTruthy()
  })

  it('does not draw a never-activated figure when there are none', () => {
    // A zero for a state nobody is in is noise on the commonest surface.
    renderSurface({ rows: [row()] })
    expect(screen.queryByText('Never activated')).toBeNull()
  })

  it('a removed member is not rendered', () => {
    renderSurface({ rows: [row({ displayName: 'Gone Person', accountState: 'deleted' })] })
    expect(screen.queryByText('Gone Person')).toBeNull()
  })

  it('an absent email is stated rather than left blank', () => {
    renderSurface({ rows: [row({ email: undefined })] })
    expect(screen.getByText('Email not available in this list')).toBeTruthy()
  })

  it('an empty site says nobody has signed up, not "no matches"', () => {
    // Those are different facts and the wrong one reads as a broken search.
    renderSurface({ rows: [] })
    expect(screen.getByText('Nobody has signed up to this site yet.')).toBeTruthy()
  })

  it('an incomplete list explains itself and is announced', () => {
    renderSurface({ rows: [row()], incompleteReason: 'Addresses are not available in this list yet.' })
    expect(screen.getByRole('status').textContent).toContain('not available')
  })

  it('and says nothing when the list is whole', () => {
    renderSurface({ rows: [row()] })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a non-active member carries its state as a readable label', () => {
    renderSurface({ rows: [row({ identityState: 'activation-required' })] })
    expect(screen.getByText(/cannot sign in yet/)).toBeTruthy()
  })
})

describe('it serves BOTH profiles, which is the defect being fixed', () => {
  const source = readFileSync(join(STUDIO, 'src/admin/fuma/members/SiteMembersSurface.tsx'), 'utf8')

  it('the surface does not live under the publication area', () => {
    // Living there is exactly why a website-profile site had no members page.
    expect(source).toContain('a WEBSITE-profile site has members too')
  })

  it('and it is composed from shadcn rather than the old admin kit with a CSS module', () => {
    expect(source).toContain("from '@admin/fuma/ui/")
    expect(source).not.toContain('@ui/components/')
    expect(source).not.toContain('.module.css')
  })

  it('the contract states these are end users and never staff', () => {
    expect(DIRECTORY_CONTRACT.notStaff).toContain('never platform staff')
    expect(DIRECTORY_CONTRACT.scope).toContain('one site')
  })
})
