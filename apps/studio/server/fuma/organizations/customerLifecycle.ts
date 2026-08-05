import type { DbClient } from '../../db/client'
import { authorizeOrganizationCreation, type OrganizationCreationContribution } from './policy'

export type CustomerOrganizationBeforeCreateInput = Readonly<{
  organization: Readonly<{
    name?: string
    slug?: string
    logo?: string | null
    metadata?: Record<string, unknown>
  }>
  user: Readonly<{ id: string }>
}>

export type CustomerOrganizationAfterCreateInput = Readonly<{
  organization: Readonly<{ id: string; name: string; slug: string }>
  member: Readonly<{ organizationId: string; userId: string; role: string }>
  user: Readonly<{ id: string }>
}>

export type CustomerOrganizationLifecycle = Readonly<{
  beforeCreate(input: CustomerOrganizationBeforeCreateInput): Promise<Readonly<{ data: Record<string, unknown> }>>
  afterCreate(input: CustomerOrganizationAfterCreateInput): Promise<void>
}>

function contribution(input: CustomerOrganizationBeforeCreateInput): OrganizationCreationContribution {
  return authorizeOrganizationCreation({
    actor: {
      authentication: { state: 'authenticated', userId: input.user.id },
      authorization: { canCreateOrganizations: true, canManageOrganizations: false },
    },
    organization: {
      organization_class: 'customer',
      displayName: input.organization.name,
      slug: input.organization.slug,
    },
    placement: { placement_class: 'shared' },
  })
}

/**
 * Bridges Better Auth's organization plugin to Fuma's organization sidecars.
 * Better Auth remains the sole writer of `auth_organizations` and
 * `auth_members`; this lifecycle adds only Fuma profile, limits and placement
 * rows after the plugin has created its authoritative organization + owner.
 */
export class PostgresCustomerOrganizationLifecycle implements CustomerOrganizationLifecycle {
  readonly #db: DbClient

  constructor(db: DbClient) {
    if (db.dialect !== 'postgres') throw new TypeError('Customer organization lifecycle requires PostgreSQL.')
    this.#db = db
  }

  async beforeCreate(input: CustomerOrganizationBeforeCreateInput) {
    const approved = contribution(input)
    return Object.freeze({
      data: {
        ...input.organization,
        name: approved.displayName,
        slug: approved.slug,
        metadata: {
          ...(input.organization.metadata ?? {}),
          fumaOrganizationClass: approved.organization_class,
        },
      },
    })
  }

  async reconcileOwned(userId: string): Promise<void> {
    const rows = await this.#db<Readonly<{ id: string; name: string; slug: string }>>`
      select organization.id,organization.name,organization.slug
      from auth_members member
      join auth_organizations organization on organization.id=member.organization_id
      left join fuma_organization_profiles profile on profile.organization_id=organization.id
      where member.user_id=${userId} and member.role='owner' and profile.organization_id is null
      order by organization.id`
    for (const organization of rows.rows) {
      await this.afterCreate({
        organization,
        member: { organizationId: organization.id, userId, role: 'owner' },
        user: { id: userId },
      })
    }
  }

  async afterCreate(input: CustomerOrganizationAfterCreateInput): Promise<void> {
    const approved = contribution({
      organization: { name: input.organization.name, slug: input.organization.slug },
      user: input.user,
    })
    if (
      input.member.organizationId !== input.organization.id
      || input.member.userId !== input.user.id
      || input.member.role !== 'owner'
      || approved.ownerUserId !== input.user.id
    ) {
      throw new Error('Better Auth returned an invalid customer organization owner binding.')
    }

    await this.#db.transaction(async (db) => {
      await db`select pg_advisory_xact_lock(hashtextextended(${'fuma:customer-organization:' + input.organization.id},0))`
      const authority = await db`
        select 1
        from auth_organizations organization
        join auth_members member on member.organization_id=organization.id
        where organization.id=${input.organization.id}
          and member.user_id=${input.user.id}
          and member.role='owner'`
      if (authority.rowCount !== 1) {
        throw new Error('Customer organization authority disappeared before Fuma provisioning.')
      }

      await db`
        insert into fuma_organization_profiles(organization_id,kind,status)
        values(${input.organization.id},'customer','active')
        on conflict(organization_id) do nothing`
      await db`
        insert into fuma_organization_limits(organization_id,max_workspaces,max_sites,max_staff)
        values(
          ${input.organization.id},
          ${approved.limits.workspaces},
          ${approved.limits.sites},
          ${approved.limits.members}
        )
        on conflict(organization_id) do nothing`
      await db`
        insert into fuma_organization_placements(organization_id,placement_class,placement_key)
        values(
          ${input.organization.id},
          ${approved.placement.placement_class},
          ${approved.placement.placement_key}
        )
        on conflict(organization_id) do nothing`

      const rows = await db<Readonly<{
        kind: string
        status: string
        max_workspaces: number
        max_sites: number
        max_staff: number
        placement_class: string
        placement_key: string
      }>>`
        select profile.kind,profile.status,limits.max_workspaces,limits.max_sites,
          limits.max_staff,placement.placement_class,placement.placement_key
        from fuma_organization_profiles profile
        join fuma_organization_limits limits on limits.organization_id=profile.organization_id
        join fuma_organization_placements placement on placement.organization_id=profile.organization_id
        where profile.organization_id=${input.organization.id}`
      const stored = rows.rows[0]
      if (
        rows.rows.length !== 1
        || stored?.kind !== 'customer'
        || stored.status !== 'active'
        || stored.max_workspaces !== approved.limits.workspaces
        || stored.max_sites !== approved.limits.sites
        || stored.max_staff !== approved.limits.members
        || stored.placement_class !== approved.placement.placement_class
        || stored.placement_key !== approved.placement.placement_key
      ) {
        throw new Error('Customer organization Fuma sidecars conflict with approved policy.')
      }
    })
  }
}
