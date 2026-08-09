import { relations, sql } from 'drizzle-orm';
import {
    boolean,
    index,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';

/**
 * Better Auth's canonical identity tables.
 *
 * UUID identifiers deliberately preserve the existing Onlook domain foreign-key
 * types while Better Auth remains the sole owner of credentials and sessions.
 */
export const auth_users = pgTable(
    'auth_users',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        name: text('name').notNull(),
        email: text('email').notNull().unique(),
        emailVerified: boolean('email_verified').default(false).notNull(),
        image: text('image'),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [uniqueIndex('auth_users_email_normalized_idx').on(sql`lower(${table.email})`)],
);

export const auth_sessions = pgTable(
    'auth_sessions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        token: text('token').notNull().unique(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
        ipAddress: text('ip_address'),
        userAgent: text('user_agent'),
        userId: uuid('user_id')
            .notNull()
            .references(() => auth_users.id, { onDelete: 'cascade' }),
    },
    (table) => [index('auth_sessions_user_id_idx').on(table.userId)],
);

export const auth_accounts = pgTable(
    'auth_accounts',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        accountId: text('account_id').notNull(),
        providerId: text('provider_id').notNull(),
        userId: uuid('user_id')
            .notNull()
            .references(() => auth_users.id, { onDelete: 'cascade' }),
        accessToken: text('access_token'),
        refreshToken: text('refresh_token'),
        idToken: text('id_token'),
        accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
        refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
        scope: text('scope'),
        password: text('password'),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index('auth_accounts_user_id_idx').on(table.userId),
        uniqueIndex('auth_accounts_provider_account_idx').on(table.providerId, table.accountId),
        uniqueIndex('auth_accounts_user_credential_idx')
            .on(table.userId)
            .where(sql`${table.providerId} = 'credential'`),
    ],
);

export const auth_verifications = pgTable(
    'auth_verifications',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        identifier: text('identifier').notNull(),
        value: text('value').notNull(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [index('auth_verifications_identifier_idx').on(table.identifier)],
);

export const authUsersRelations = relations(auth_users, ({ many }) => ({
    sessions: many(auth_sessions),
    accounts: many(auth_accounts),
}));

export const authSessionsRelations = relations(auth_sessions, ({ one }) => ({
    user: one(auth_users, { fields: [auth_sessions.userId], references: [auth_users.id] }),
}));

export const authAccountsRelations = relations(auth_accounts, ({ one }) => ({
    user: one(auth_users, { fields: [auth_accounts.userId], references: [auth_users.id] }),
}));

export type AuthUser = typeof auth_users.$inferSelect;
export type AuthSession = typeof auth_sessions.$inferSelect;
