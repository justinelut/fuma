/**
 * The scoped identity list that task 92's directory reads.
 *
 * The scoping assertions are the ones that matter: dropping any scope column would return another
 * site's members and would look like a working list.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_IDENTITY_PAGE,
  MemoryMemberIdentityRepository,
} from '../../../server/fuma/memberIdentity/repository'
import type { MemberIdentityScope } from '../../../server/fuma/memberIdentity/contracts'

const STUDIO = join(import.meta.dir, '..', '..', '..')

const baseScope: MemberIdentityScope = {
  platformId: 'p',
  organizationId: 'o',
  workspaceId: 'w',
  siteId: 'site-a',
  ownerKey: 'owner',
  generation: 1,
  profileId: 'pr',
} as MemberIdentityScope

function record(id: string, email: string, createdAt: string, state = 'active') {
  return {
    identity: {
      memberIdentityId: id,
      email,
      displayName: `Member ${id}`,
      state,
      origin: 'self-signup',
      importReceiptId: null,
      createdAt,
      updatedAt: createdAt,
    },
    normalizedEmail: email,
    passwordHash: '$argon2id$v=19$m=65536,t=2,p=1$aaaaaaaaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  } as never
}

async function seeded() {
  const repo = new MemoryMemberIdentityRepository()
  await repo.createIdentity(baseScope, record('m1', 'a1@x.test', '2026-01-01T00:00:00.000Z'), [])
  // Two members created in the SAME millisecond - the case a keyset without a tiebreak mishandles.
  await repo.createIdentity(baseScope, record('m2', 'a2@x.test', '2026-01-02T00:00:00.000Z', 'activation-required'), [])
  await repo.createIdentity(baseScope, record('m3', 'a3@x.test', '2026-01-02T00:00:00.000Z'), [])
  return repo
}

describe('the list is scoped to one site', () => {
  it('another site\'s members are not returned', async () => {
    const repo = await seeded()
    await repo.createIdentity({ ...baseScope, siteId: 'site-b' }, record('m9', 'b9@x.test', '2026-01-01T00:00:00.000Z'), [])
    const rows = await repo.listIdentities(baseScope)
    expect(rows.map((r) => r.memberIdentityId)).toEqual(['m1', 'm2', 'm3'])
  })

  it('and an owner-generation bump fences the old members off', async () => {
    // The same fencing moduleStore relies on: a new generation must not see the previous one's rows.
    const repo = await seeded()
    const next = await repo.listIdentities({ ...baseScope, generation: 2 })
    expect(next).toHaveLength(0)
  })

  it('every scope coordinate is required, so changing any one empties the list', async () => {
    const repo = await seeded()
    for (const [key, value] of Object.entries({
      platformId: 'other', organizationId: 'other', workspaceId: 'other',
      siteId: 'other', ownerKey: 'other', profileId: 'other',
    })) {
      const rows = await repo.listIdentities({ ...baseScope, [key]: value })
      expect(rows).toHaveLength(0)
    }
  })
})

describe('keyset paging', () => {
  it('orders by createdAt then id, so a same-millisecond pair has a stable boundary', async () => {
    const repo = await seeded()
    const first = await repo.listIdentities(baseScope, { limit: 2 })
    expect(first.map((r) => r.memberIdentityId)).toEqual(['m1', 'm2'])

    // THE POINT: m2 must not come back. Without the id tiebreak a createdAt-only cursor repeats it,
    // which was demonstrated against real Postgres.
    const second = await repo.listIdentities(baseScope, {
      limit: 2,
      after: { createdAt: '2026-01-02T00:00:00.000Z', memberIdentityId: 'm2' },
    })
    expect(second.map((r) => r.memberIdentityId)).toEqual(['m3'])
  })

  it('a cursor past the end returns nothing rather than wrapping', async () => {
    const repo = await seeded()
    const rows = await repo.listIdentities(baseScope, {
      after: { createdAt: '2027-01-01T00:00:00.000Z', memberIdentityId: 'zzz' },
    })
    expect(rows).toHaveLength(0)
  })

  it('the page is bounded however large a limit is asked for', async () => {
    // An unbounded scan of a site with hundreds of thousands of members is not a page.
    const repo = await seeded()
    const rows = await repo.listIdentities(baseScope, { limit: 10_000 })
    expect(rows.length).toBeLessThanOrEqual(MAX_IDENTITY_PAGE)
    expect(MAX_IDENTITY_PAGE).toBeLessThanOrEqual(500)
  })
})

describe('the list carries NO credential', () => {
  it('no returned row has a password hash', async () => {
    // findIdentityByEmail returns a MemberCredentialRecord because verifying needs the hash. A list is
    // read to be displayed, so a hash here would be one serialisation away from an admin response.
    const repo = await seeded()
    const rows = await repo.listIdentities(baseScope)
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('passwordHash')
      expect(JSON.stringify(row)).not.toContain('argon2')
    }
  })

  it('while the by-email read still does, because verification needs it', async () => {
    const repo = await seeded()
    const found = await repo.findIdentityByEmail(baseScope, 'a1@x.test')
    expect(found?.passwordHash).toContain('argon2')
  })

  it('and the Postgres query selects no password_hash column', () => {
    const source = readFileSync(join(STUDIO, 'server/fuma/memberIdentity/postgresRepository.ts'), 'utf8')
    const listQuery = source.slice(source.indexOf('async listIdentities'), source.indexOf('async createSession'))
    expect(listQuery).toContain('fuma_member_identities')
    expect(listQuery).not.toContain('password_hash')
  })

  it('and that query carries all seven scope predicates', () => {
    const source = readFileSync(join(STUDIO, 'server/fuma/memberIdentity/postgresRepository.ts'), 'utf8')
    const listQuery = source.slice(source.indexOf('async listIdentities'), source.indexOf('async createSession'))
    for (const column of ['platform_id=', 'organization_id=', 'workspace_id=', 'site_id=', 'owner_key=', 'owner_generation=', 'profile_id=']) {
      expect(listQuery).toContain(column)
    }
  })

  it('and it orders with the id tiebreak', () => {
    const source = readFileSync(join(STUDIO, 'server/fuma/memberIdentity/postgresRepository.ts'), 'utf8')
    const listQuery = source.slice(source.indexOf('async listIdentities'), source.indexOf('async createSession'))
    expect(listQuery).toContain('order by created_at asc,member_identity_id asc')
  })
})

describe('the state a directory needs is carried through', () => {
  it('activation-required survives the read, because that is what distinguishes a member who arrived', async () => {
    const repo = await seeded()
    const rows = await repo.listIdentities(baseScope)
    expect(rows.find((r) => r.memberIdentityId === 'm2')?.state).toBe('activation-required')
    expect(rows.find((r) => r.memberIdentityId === 'm1')?.state).toBe('active')
  })

  it('and the email is present, which the publication account cannot provide', async () => {
    const repo = await seeded()
    const rows = await repo.listIdentities(baseScope)
    expect(rows.find((r) => r.memberIdentityId === 'm1')?.email).toBe('a1@x.test')
  })
})
