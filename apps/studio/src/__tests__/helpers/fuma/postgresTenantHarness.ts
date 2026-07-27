import type { DbClient } from '../../../../server/db/client'
import type { FumaTwoTenantMatrix } from './fixtures'

const SECRET_KEY = /(?:password|secret|token|authorization|cookie|(?:api|auth|access)[-_]?key|private[-_]?key|credential)/i
const SECRET_VALUE = /(?:\bbearer\s+\S+|\bsk_(?:live|test)_\S+|\bpk_(?:live|test)_\S+|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b)/i
const TEST_SCHEMA_PREFIX = 'fuma_fixture_'
let schemaSequence = 0

export class PostgresTenantFixtureRequiredError extends Error {
  constructor() {
    super('Fuma hosted tenant fixtures require a PostgreSQL DbClient')
    this.name = 'PostgresTenantFixtureRequiredError'
  }
}

export class SecretShapedFixtureDataError extends Error {
  constructor(path: string) {
    super(`Secret-shaped fixture data is forbidden at ${path}`)
    this.name = 'SecretShapedFixtureDataError'
  }
}

function assertNoSecretShapedData(value: unknown, path = 'fixture', seen = new Set<object>()): void {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) throw new SecretShapedFixtureDataError(path)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretShapedData(entry, `${path}[${index}]`, seen))
    return
  }

  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new SecretShapedFixtureDataError(`${path}.${key}`)
    assertNoSecretShapedData(entry, `${path}.${key}`, seen)
  }
}

function safeSchemaPart(value: string): string {
  const part = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (part.length === 0) throw new Error('PostgreSQL fixture schema label must not be empty')
  return part.slice(0, 24)
}

function nextSchemaName(label: string): string {
  schemaSequence += 1
  return `${TEST_SCHEMA_PREFIX}${safeSchemaPart(label)}_${process.pid}_${schemaSequence}`
}

function quotedIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) throw new Error('Unsafe fixture schema identifier')
  return `"${identifier}"`
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function assertMatrixShape(matrix: FumaTwoTenantMatrix): void {
  if (matrix.organizations.length !== 2) throw new Error('Fuma fixture matrix must contain two organizations')
  if (matrix.workspaces.length !== 2) throw new Error('Fuma fixture matrix must contain two workspaces')
  if (matrix.sites.length !== 4) throw new Error('Fuma fixture matrix must contain Website and Publication sites in both organizations')
  if (new Set(matrix.workspaces.map(({ id }) => id)).size !== 1) {
    throw new Error('Fuma fixture workspace IDs must deliberately collide')
  }
  if (new Set(matrix.resources.map(({ id }) => id)).size !== 1) {
    throw new Error('Fuma fixture resource IDs must deliberately collide')
  }
  for (const organization of matrix.organizations) {
    const profiles = matrix.sites
      .filter(({ organizationId }) => organizationId === organization.id)
      .map(({ profileId }) => profileId)
    if (!profiles.includes('website') || !profiles.includes('publication')) {
      throw new Error('Each fixture organization must own Website and Publication sites')
    }
  }
}

export type TenantIsolationEvidence = Readonly<{
  organizationIds: readonly string[]
  collidingWorkspaceId: string
  collidingSiteIds: readonly string[]
  collidingResourceId: string
  workspaceRows: number
  siteRows: number
  resourceRows: number
}>

type WorkspaceRow = { organization_id: string; id: string }
type SiteRow = { organization_id: string; workspace_id: string; id: string; profile_id: string }
type ResourceRow = {
  organization_id: string
  workspace_id: string
  site_id: string
  id: string
  marker: string
}

export class PostgresTenantFixtureHarness {
  readonly #db: DbClient
  readonly #schemaName: string
  readonly #schema: string
  #state: 'fresh' | 'active' | 'cleaned' = 'fresh'

  constructor(db: DbClient, schemaLabel: string) {
    if (db.dialect !== 'postgres') throw new PostgresTenantFixtureRequiredError()
    this.#db = db
    this.#schemaName = nextSchemaName(schemaLabel)
    this.#schema = quotedIdentifier(this.#schemaName)
  }

  async provision(matrix: FumaTwoTenantMatrix): Promise<TenantIsolationEvidence> {
    if (this.#state !== 'fresh') throw new Error('PostgreSQL tenant fixture harness is already provisioned or cleaned')
    assertMatrixShape(matrix)
    assertNoSecretShapedData(matrix)

    try {
      await this.#db.unsafe(`create schema ${this.#schema}`)
      this.#state = 'active'
      await this.#db.unsafe(`
        create table ${this.#schema}.fixture_users (
          id text primary key,
          email text not null,
          display_name text not null
        );
        create table ${this.#schema}.fixture_organizations (
          id text primary key,
          owner_user_id text not null references ${this.#schema}.fixture_users(id),
          label text not null
        );
        create table ${this.#schema}.fixture_workspaces (
          organization_id text not null references ${this.#schema}.fixture_organizations(id),
          id text not null,
          label text not null,
          primary key (organization_id, id)
        );
        create table ${this.#schema}.fixture_sites (
          organization_id text not null,
          workspace_id text not null,
          id text not null,
          label text not null,
          profile_id text not null check (profile_id in ('website', 'publication')),
          capability_overrides_json text not null,
          primary key (organization_id, workspace_id, id),
          foreign key (organization_id, workspace_id)
            references ${this.#schema}.fixture_workspaces(organization_id, id)
        );
        create table ${this.#schema}.fixture_resources (
          organization_id text not null,
          workspace_id text not null,
          site_id text not null,
          id text not null,
          label text not null,
          marker text not null,
          primary key (organization_id, workspace_id, site_id, id),
          foreign key (organization_id, workspace_id, site_id)
            references ${this.#schema}.fixture_sites(organization_id, workspace_id, id)
        );
      `)

      await this.#db.transaction(async (tx) => {
        for (const user of matrix.users) {
          await tx.unsafe(
            `insert into ${this.#schema}.fixture_users (id, email, display_name) values ($1, $2, $3)`,
            [user.id, user.email, user.displayName],
          )
        }
        for (const organization of matrix.organizations) {
          await tx.unsafe(
            `insert into ${this.#schema}.fixture_organizations (id, owner_user_id, label) values ($1, $2, $3)`,
            [organization.id, organization.ownerUserId, organization.label],
          )
        }
        for (const workspace of matrix.workspaces) {
          await tx.unsafe(
            `insert into ${this.#schema}.fixture_workspaces (organization_id, id, label) values ($1, $2, $3)`,
            [workspace.organizationId, workspace.id, workspace.label],
          )
        }
        for (const site of matrix.sites) {
          await tx.unsafe(
            `insert into ${this.#schema}.fixture_sites
              (organization_id, workspace_id, id, label, profile_id, capability_overrides_json)
              values ($1, $2, $3, $4, $5, $6)`,
            [
              site.organizationId,
              site.workspaceId,
              site.id,
              site.label,
              site.profileId,
              JSON.stringify(site.capabilityOverrides),
            ],
          )
        }
        for (const resource of matrix.resources) {
          await tx.unsafe(
            `insert into ${this.#schema}.fixture_resources
              (organization_id, workspace_id, site_id, id, label, marker)
              values ($1, $2, $3, $4, $5, $6)`,
            [
              resource.organizationId,
              resource.workspaceId,
              resource.siteId,
              resource.id,
              resource.label,
              resource.value,
            ],
          )
        }
      })

      return await this.verifyIsolation(matrix)
    } catch (err) {
      try {
        await this.cleanup()
      } catch (cleanupError) {
        throw new AggregateError([err, cleanupError], 'PostgreSQL tenant fixture provisioning and cleanup failed')
      }
      throw err
    }
  }

  async verifyIsolation(matrix: FumaTwoTenantMatrix): Promise<TenantIsolationEvidence> {
    if (this.#state !== 'active') throw new Error('PostgreSQL tenant fixture harness is not active')

    const workspaces = await this.#db.unsafe<WorkspaceRow>(
      `select organization_id, id from ${this.#schema}.fixture_workspaces order by organization_id, id`,
    )
    const sites = await this.#db.unsafe<SiteRow>(
      `select organization_id, workspace_id, id, profile_id from ${this.#schema}.fixture_sites
       order by organization_id, workspace_id, id`,
    )
    const resources = await this.#db.unsafe<ResourceRow>(
      `select organization_id, workspace_id, site_id, id, marker from ${this.#schema}.fixture_resources
       order by organization_id, workspace_id, site_id, id`,
    )

    const expectedWorkspaceScopes = sorted(matrix.workspaces.map(
      ({ organizationId, id }) => `${organizationId}/${id}`,
    ))
    const actualWorkspaceScopes = sorted(workspaces.rows.map(
      ({ organization_id, id }) => `${organization_id}/${id}`,
    ))
    const expectedSiteScopes = sorted(matrix.sites.map(
      ({ organizationId, workspaceId, id, profileId }) => `${organizationId}/${workspaceId}/${id}/${profileId}`,
    ))
    const actualSiteScopes = sorted(sites.rows.map(
      ({ organization_id, workspace_id, id, profile_id }) => `${organization_id}/${workspace_id}/${id}/${profile_id}`,
    ))
    const expectedResourceScopes = sorted(matrix.resources.map(
      ({ organizationId, workspaceId, siteId, id, value }) => `${organizationId}/${workspaceId}/${siteId}/${id}/${value}`,
    ))
    const actualResourceScopes = sorted(resources.rows.map(
      ({ organization_id, workspace_id, site_id, id, marker }) => `${organization_id}/${workspace_id}/${site_id}/${id}/${marker}`,
    ))

    if (JSON.stringify(actualWorkspaceScopes) !== JSON.stringify(expectedWorkspaceScopes)) {
      throw new Error('PostgreSQL fixture workspace scope isolation mismatch')
    }
    if (JSON.stringify(actualSiteScopes) !== JSON.stringify(expectedSiteScopes)) {
      throw new Error('PostgreSQL fixture site scope isolation mismatch')
    }
    if (JSON.stringify(actualResourceScopes) !== JSON.stringify(expectedResourceScopes)) {
      throw new Error('PostgreSQL fixture resource scope isolation mismatch')
    }

    return {
      organizationIds: matrix.organizations.map(({ id }) => id),
      collidingWorkspaceId: matrix.workspaces[0].id,
      collidingSiteIds: [...new Set(matrix.sites.map(({ id }) => id))].sort(),
      collidingResourceId: matrix.resources[0].id,
      workspaceRows: workspaces.rowCount,
      siteRows: sites.rowCount,
      resourceRows: resources.rowCount,
    }
  }

  async cleanup(): Promise<void> {
    if (this.#state === 'cleaned') return
    if (this.#state === 'active') await this.#db.unsafe(`drop schema if exists ${this.#schema} cascade`)
    this.#state = 'cleaned'
  }

  async cleanupIsComplete(): Promise<boolean> {
    const result = await this.#db<{ nspname: string }>`
      select nspname from pg_namespace where nspname = ${this.#schemaName}
    `
    return result.rows.length === 0
  }
}

export function createPostgresTenantFixtureHarness(
  db: DbClient,
  schemaLabel: string,
): PostgresTenantFixtureHarness {
  return new PostgresTenantFixtureHarness(db, schemaLabel)
}
