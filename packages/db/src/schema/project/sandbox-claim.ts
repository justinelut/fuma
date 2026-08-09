import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { auth_users } from '../auth';

/**
 * Short-lived ownership records for sandboxes created before a project/branch
 * row exists. Persisted branches remain the long-term authorization source.
 */
export const sandboxClaims = pgTable(
    'sandbox_claims',
    {
        sandboxId: varchar('sandbox_id').primaryKey(),
        userId: uuid('user_id')
            .notNull()
            .references(() => auth_users.id, { onDelete: 'cascade' }),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        index('sandbox_claims_user_id_idx').on(table.userId),
        index('sandbox_claims_expires_at_idx').on(table.expiresAt),
    ],
);

export type SandboxClaim = typeof sandboxClaims.$inferSelect;
