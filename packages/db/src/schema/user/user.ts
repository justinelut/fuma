import { relations } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { projectInvitations } from '../project';
import { usageRecords } from '../subscription';
import { subscriptions } from '../subscription/subscription';
import { auth_users } from '../auth';
import { userSettings } from './settings';
import { userCanvases } from './user-canvas';
import { userProjects } from './user-project';

export const users = pgTable('users', {
    id: uuid('id')
        .primaryKey()
        .references(() => auth_users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    firstName: text('first_name'),
    lastName: text('last_name'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    githubInstallationId: text('github_installation_id'),
});

export const usersRelations = relations(users, ({ many, one }) => ({
    userCanvases: many(userCanvases),
    userProjects: many(userProjects),
    userSettings: one(userSettings),
    authUser: one(auth_users),
    subscriptions: many(subscriptions),
    usageRecords: many(usageRecords),
    projectInvitations: many(projectInvitations),
}));

export const userInsertSchema = createInsertSchema(users);
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
