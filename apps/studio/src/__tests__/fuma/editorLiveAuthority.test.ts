import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/db/client'
import {
  FumaRequestContextResolutionError,
  PostgresFumaSiteAuthorizationAuthority,
  createFumaHostedSessionAuthenticator,
  createPostgresFumaRequestContextAuthorityPorts,
  deriveFumaRequestContext,
  type FumaSiteAuthorizationInput,
} from '../../../server/fuma/context'

const ACTOR = {
  kind: 'staff' as const,
  userId: 'user-editor',
  sessionId: 'session-editor',
  impersonator: null,
}

const ROUTE = {
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
}

type AuthorityRow = Readonly<{
  platform_id: string
  owner_state: string
  organization_id: string
  organization_kind: string
  organization_status: string
  workspace_id: string
  workspace_organization_id: string
  workspace_status: string
  site_id: string
  site_organization_id: string
  site_workspace_id: string
  site_status: string
  profile_id: string
  capability_overrides_json: unknown
  membership_id: string | null
  membership_role: string | null
  override_access: string | null
  override_role: string | null
}>

function authorityRow(overrides: Partial<AuthorityRow> = {}): AuthorityRow {
  return {
    platform_id: 'platform-fuma',
    owner_state: 'active',
    organization_id: ROUTE.organizationId,
    organization_kind: 'customer',
    organization_status: 'active',
    workspace_id: ROUTE.workspaceId,
    workspace_organization_id: ROUTE.organizationId,
    workspace_status: 'active',
    site_id: ROUTE.siteId,
    site_organization_id: ROUTE.organizationId,
    site_workspace_id: ROUTE.workspaceId,
    site_status: 'active',
    profile_id: 'website',
    capability_overrides_json: { grant: [], revoke: [] },
    membership_id: 'membership-editor',
    membership_role: 'member',
    override_access: null,
    override_role: null,
    ...overrides,
  }
}

function postgresDb(rows: readonly AuthorityRow[]): Readonly<{
  db: DbClient
  sql: () => string
  values: () => readonly unknown[]
}> {
  let recordedSql = ''
  let recordedValues: readonly unknown[] = []
  const query = (async <Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    recordedSql = strings.join('?').replace(/\s+/g, ' ').trim()
    recordedValues = values
    return {
      rows: structuredClone(rows) as Row[],
      rowCount: rows.length,
    }
  }) as DbClient
  query.dialect = 'postgres'
  query.unsafe = async <Row>(): Promise<DbResult<Row>> => ({ rows: [], rowCount: 0 })
  query.transaction = async <T>(work: (tx: DbClient) => Promise<T>): Promise<T> => await work(query)
  return {
    db: query,
    sql: () => recordedSql,
    values: () => recordedValues,
  }
}

async function load(
  row: AuthorityRow,
): Promise<FumaSiteAuthorizationInput> {
  const authority = new PostgresFumaSiteAuthorizationAuthority(postgresDb([row]).db)
  const result = await authority.loadExactSiteAuthorization({ actor: ACTOR, routeScope: ROUTE })
  if (result === null) throw new Error('Expected exact site authority')
  return result
}

function hostedSession() {
  return {
    userId: ACTOR.userId,
    sessionId: ACTOR.sessionId,
    impersonatedBy: null,
    email: 'editor@fuma.test',
    createdAt: new Date('2026-07-25T00:00:00.000Z'),
  }
}

describe('FUMA-027 production editor live request authority', () => {
  it('adapts only hosted session headers into the strict staff actor', async () => {
    let resolvedHeaders: Headers | null = null
    const authenticator = createFumaHostedSessionAuthenticator(async (headers) => {
      resolvedHeaders = headers
      return { ...hostedSession(), impersonatedBy: 'support-user' }
    })
    const request = new Request(
      'https://hosted.fuma.test/attacker/organization/workspace/site',
      { method: 'POST', body: JSON.stringify({ userId: 'attacker', siteId: 'other-site' }) },
    )

    expect(await authenticator.authenticateSameOriginHostedSession(request)).toEqual({
      kind: 'staff',
      userId: ACTOR.userId,
      sessionId: ACTOR.sessionId,
      impersonator: { userId: 'support-user' },
    })
    expect(resolvedHeaders).toBe(request.headers)
    expect(request.bodyUsed).toBe(false)
  })

  it('loads one exact route ancestry and owner platform into the strict authorization shape', async () => {
    const database = postgresDb([authorityRow()])
    const authority = new PostgresFumaSiteAuthorizationAuthority(database.db)
    const result = await authority.loadExactSiteAuthorization({ actor: ACTOR, routeScope: ROUTE })

    expect(result).toMatchObject({
      platformOrganizationId: 'fuma-platform',
      platform: { id: 'platform-fuma', status: 'active' },
      organization: {
        id: ROUTE.organizationId,
        platformId: 'platform-fuma',
        kind: 'customer',
        status: 'active',
      },
      workspace: {
        id: ROUTE.workspaceId,
        organizationId: ROUTE.organizationId,
        status: 'active',
      },
      site: {
        id: ROUTE.siteId,
        organizationId: ROUTE.organizationId,
        workspaceId: ROUTE.workspaceId,
        profileId: 'website',
        status: 'active',
      },
      capabilities: { overrides: { grant: [], revoke: [] } },
      permissions: {
        subjectId: ACTOR.userId,
        protectedOwnerInvariant: null,
        permissionOverrides: [],
        customRoles: [],
      },
    })
    expect(result?.permissions.roleAssignments).toEqual([{
      id: 'membership-editor',
      subjectId: ACTOR.userId,
      scope: {
        kind: 'organization',
        platformId: 'platform-fuma',
        organizationId: ROUTE.organizationId,
      },
      role: { kind: 'launch-persona', persona: 'member' },
    }])
    expect(database.sql()).toContain('where site.organization_id = ? and site.workspace_id = ? and site.id = ?')
    expect(database.values()).toEqual([
      ACTOR.userId,
      ACTOR.userId,
      ROUTE.organizationId,
      ROUTE.workspaceId,
      ROUTE.siteId,
    ])
  })

  it('applies workspace grant and deny semantics without inventing permission tables', async () => {
    const granted = await load(authorityRow({
      membership_role: 'owner',
      override_access: 'grant',
      override_role: 'viewer',
    }))
    expect(granted.permissions.roleAssignments).toHaveLength(2)
    expect(granted.permissions.roleAssignments[0]?.role).toEqual({
      kind: 'launch-persona',
      persona: 'owner',
    })
    expect(granted.permissions.roleAssignments[1]).toMatchObject({
      subjectId: ACTOR.userId,
      scope: {
        kind: 'workspace',
        platformId: 'platform-fuma',
        organizationId: ROUTE.organizationId,
        workspaceId: ROUTE.workspaceId,
      },
      role: { kind: 'launch-persona', persona: 'viewer' },
    })
    expect(granted.permissions.permissionOverrides).toEqual([])
    expect(granted.permissions.customRoles).toEqual([])

    const denied = await load(authorityRow({
      membership_role: 'owner',
      override_access: 'deny',
    }))
    expect(denied.permissions.roleAssignments).toEqual([])

    const noMembership = await load(authorityRow({
      membership_id: null,
      membership_role: null,
      override_access: 'grant',
      override_role: 'owner',
    }))
    expect(noMembership.permissions.roleAssignments).toEqual([])
  })

  it('returns null only for a missing exact route and rejects duplicate or malformed authority', async () => {
    const missing = new PostgresFumaSiteAuthorizationAuthority(postgresDb([]).db)
    expect(await missing.loadExactSiteAuthorization({ actor: ACTOR, routeScope: ROUTE })).toBeNull()

    const duplicate = new PostgresFumaSiteAuthorizationAuthority(
      postgresDb([authorityRow(), authorityRow()]).db,
    )
    expect(duplicate.loadExactSiteAuthorization({ actor: ACTOR, routeScope: ROUTE }))
      .rejects.toThrow('duplicate rows')

    const malformed = new PostgresFumaSiteAuthorizationAuthority(
      postgresDb([authorityRow({ site_organization_id: '' })]).db,
    )
    expect(malformed.loadExactSiteAuthorization({ actor: ACTOR, routeScope: ROUTE }))
      .rejects.toThrow('malformed row')

    const sqlite = postgresDb([]).db
    Object.defineProperty(sqlite, 'dialect', { value: 'sqlite' })
    expect(() => new PostgresFumaSiteAuthorizationAuthority(sqlite))
      .toThrow('requires PostgreSQL')
  })

  it('composes the production ports and preserves derivation ancestry and active checks', async () => {
    const activePorts = createPostgresFumaRequestContextAuthorityPorts({
      db: postgresDb([authorityRow({ membership_role: 'owner' })]).db,
      resolveSession: async () => hostedSession(),
    })
    const input = {
      request: new Request('https://hosted.fuma.test/editor'),
      routeScope: ROUTE,
      requiredPermission: 'content.pages.write' as const,
      generateRequestId: () => 'request-fuma-027',
    }
    const context = await deriveFumaRequestContext({ ...input, ports: activePorts })
    expect(context.actor).toEqual(ACTOR)
    expect(context.scope).toMatchObject({
      platform: { id: 'platform-fuma', status: 'active' },
      organization: { id: ROUTE.organizationId, platformId: 'platform-fuma' },
      workspace: {
        id: ROUTE.workspaceId,
        platformId: 'platform-fuma',
        organizationId: ROUTE.organizationId,
      },
      site: {
        id: ROUTE.siteId,
        platformId: 'platform-fuma',
        organizationId: ROUTE.organizationId,
        workspaceId: ROUTE.workspaceId,
      },
    })

    const suspendedPorts = createPostgresFumaRequestContextAuthorityPorts({
      db: postgresDb([authorityRow({
        membership_role: 'owner',
        organization_status: 'suspended',
      })]).db,
      resolveSession: async () => hostedSession(),
    })
    try {
      await deriveFumaRequestContext({ ...input, ports: suspendedPorts })
      throw new Error('Expected inactive organization denial')
    } catch (error) {
      expect(error).toBeInstanceOf(FumaRequestContextResolutionError)
      if (!(error instanceof FumaRequestContextResolutionError)) throw error
      expect({ code: error.code, status: error.status }).toEqual({ code: 'denied', status: 404 })
    }
  })
})
