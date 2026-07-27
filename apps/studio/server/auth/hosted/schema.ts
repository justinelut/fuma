import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const auth_users = pgTable(
  'auth_users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
    role: text('role'),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
  },
  (table) => [uniqueIndex('auth_users_email_normalized_idx').on(sql`lower(${table.email})`)],
)

export const auth_sessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => auth_users.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id'),
    impersonatedBy: text('impersonated_by'),
  },
  (table) => [index('auth_sessions_user_id_idx').on(table.userId)],
)

export const auth_accounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => auth_users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    index('auth_accounts_user_id_idx').on(table.userId),
    uniqueIndex('auth_accounts_provider_account_idx').on(table.providerId, table.accountId),
    uniqueIndex('auth_accounts_user_credential_idx').on(table.userId).where(sql`${table.providerId} = 'credential'`),
  ],
)

export const auth_verifications = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [index('auth_verifications_identifier_idx').on(table.identifier)],
)

export const auth_organizations = pgTable('auth_organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  metadata: text('metadata'),
})

export const auth_members = pgTable(
  'auth_members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => auth_organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => auth_users.id, { onDelete: 'cascade' }),
    role: text('role').default('member').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('auth_members_organization_id_idx').on(table.organizationId),
    index('auth_members_user_id_idx').on(table.userId),
    uniqueIndex('auth_members_organization_user_idx').on(table.organizationId, table.userId),
  ],
)

export const auth_invitations = pgTable(
  'auth_invitations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => auth_organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    inviterId: text('inviter_id').notNull().references(() => auth_users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('auth_invitations_organization_id_idx').on(table.organizationId),
    index('auth_invitations_email_idx').on(table.email),
  ],
)

export const auth_two_factors = pgTable(
  'auth_two_factors',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id').notNull().references(() => auth_users.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (table) => [
    index('auth_two_factors_secret_idx').on(table.secret),
    index('auth_two_factors_user_id_idx').on(table.userId),
    uniqueIndex('auth_two_factors_user_idx').on(table.userId),
  ],
)

export const auth_staff_profiles = pgTable('auth_staff_profiles', {
  userId: text('user_id').primaryKey().references(() => auth_users.id, { onDelete: 'restrict' }),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
})

export const auth_legacy_identity_links = pgTable('auth_legacy_identity_links', {
  legacyUserId: text('legacy_user_id').primaryKey(),
  authUserId: text('auth_user_id').notNull().unique().references(() => auth_users.id, { onDelete: 'restrict' }),
  linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
})

export const auth_usersRelations = relations(auth_users, ({ many, one }) => ({
  sessions: many(auth_sessions),
  accounts: many(auth_accounts),
  memberships: many(auth_members),
  invitations: many(auth_invitations),
  twoFactors: many(auth_two_factors),
  staffProfile: one(auth_staff_profiles),
  legacyIdentityLink: one(auth_legacy_identity_links),
}))

export const auth_sessionsRelations = relations(auth_sessions, ({ one }) => ({
  user: one(auth_users, { fields: [auth_sessions.userId], references: [auth_users.id] }),
}))

export const auth_accountsRelations = relations(auth_accounts, ({ one }) => ({
  user: one(auth_users, { fields: [auth_accounts.userId], references: [auth_users.id] }),
}))

export const auth_organizationsRelations = relations(auth_organizations, ({ many }) => ({
  memberships: many(auth_members),
  invitations: many(auth_invitations),
}))

export const auth_membersRelations = relations(auth_members, ({ one }) => ({
  organization: one(auth_organizations, { fields: [auth_members.organizationId], references: [auth_organizations.id] }),
  user: one(auth_users, { fields: [auth_members.userId], references: [auth_users.id] }),
}))

export const auth_invitationsRelations = relations(auth_invitations, ({ one }) => ({
  organization: one(auth_organizations, { fields: [auth_invitations.organizationId], references: [auth_organizations.id] }),
  inviter: one(auth_users, { fields: [auth_invitations.inviterId], references: [auth_users.id] }),
}))

export const auth_two_factorsRelations = relations(auth_two_factors, ({ one }) => ({
  user: one(auth_users, { fields: [auth_two_factors.userId], references: [auth_users.id] }),
}))

export const auth_staff_profilesRelations = relations(auth_staff_profiles, ({ one }) => ({
  user: one(auth_users, { fields: [auth_staff_profiles.userId], references: [auth_users.id] }),
}))

export const auth_legacy_identity_linksRelations = relations(auth_legacy_identity_links, ({ one }) => ({
  authUser: one(auth_users, { fields: [auth_legacy_identity_links.authUserId], references: [auth_users.id] }),
}))
