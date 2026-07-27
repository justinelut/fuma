import type { DbClient } from '../../db/client'

export const LEGACY_STAFF_IDENTITY_BACKFILL_SQL = `
  insert into auth_users (
    id, name, email, email_verified, image, created_at, updated_at,
    role, banned, ban_reason, ban_expires, two_factor_enabled
  )
  select
    users.id,
    users.display_name,
    users.email,
    true,
    null,
    users.created_at,
    users.updated_at,
    users.role_id,
    users.status = 'suspended',
    case when users.status = 'suspended' then 'Legacy account suspended before hosted migration' else null end,
    null,
    false
  from users
  where users.deleted_at is null and users.role_id <> 'member'
  on conflict (id) do nothing;

  insert into auth_accounts (
    id, account_id, provider_id, user_id, password, created_at, updated_at
  )
  select
    'legacy-credential:' || users.id,
    users.id,
    'credential',
    users.id,
    users.password_hash,
    users.created_at,
    users.updated_at
  from users
  where users.deleted_at is null and users.role_id <> 'member'
  on conflict (id) do nothing;

  insert into auth_staff_profiles (user_id, source, created_at, updated_at)
  select users.id, 'legacy', users.created_at, users.updated_at
  from users
  where users.deleted_at is null and users.role_id <> 'member'
  on conflict (user_id) do nothing;

  insert into auth_legacy_identity_links (legacy_user_id, auth_user_id)
  select users.id, users.id
  from users
  where users.deleted_at is null and users.role_id <> 'member'
  on conflict (legacy_user_id) do nothing;

  select 1 / (
    case when exists (
      select 1
      from users
      left join auth_legacy_identity_links links on links.legacy_user_id = users.id
      left join auth_users identities on identities.id = links.auth_user_id
      left join auth_accounts credentials
        on credentials.user_id = identities.id and credentials.provider_id = 'credential'
      left join auth_staff_profiles profiles on profiles.user_id = identities.id
      where users.deleted_at is null
        and users.role_id <> 'member'
        and (
          links.auth_user_id is null
          or links.auth_user_id <> users.id
          or identities.email is distinct from users.email
          or credentials.password is distinct from users.password_hash
          or profiles.source is distinct from 'legacy'
        )
    ) then 0 else 1 end
  ) as legacy_staff_identity_backfill_valid;
`

export type LegacyStaffIdentityBackfillReport = Readonly<{
  eligibleLegacyStaff: number
  linkedLegacyStaff: number
}>

export async function backfillLegacyStaffIdentitiesInTransaction(
  db: DbClient,
): Promise<LegacyStaffIdentityBackfillReport> {
  if (db.dialect !== 'postgres') {
    throw new Error('Hosted staff identity backfill requires PostgreSQL')
  }
  await db.unsafe(LEGACY_STAFF_IDENTITY_BACKFILL_SQL)
  const [eligible, linked] = await Promise.all([
    db<{ count: string | number }>`
      select count(*) as count from users
      where deleted_at is null and role_id <> 'member'
    `,
    db<{ count: string | number }>`
      select count(*) as count
      from auth_legacy_identity_links links
      join users on users.id = links.legacy_user_id
      where users.deleted_at is null and users.role_id <> 'member'
    `,
  ])
  return {
    eligibleLegacyStaff: Number(eligible.rows[0]?.count ?? 0),
    linkedLegacyStaff: Number(linked.rows[0]?.count ?? 0),
  }
}

export async function backfillLegacyStaffIdentities(
  db: DbClient,
): Promise<LegacyStaffIdentityBackfillReport> {
  return await db.transaction(async (tx) => await backfillLegacyStaffIdentitiesInTransaction(tx))
}
