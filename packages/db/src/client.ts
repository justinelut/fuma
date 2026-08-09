import * as schema from '@onlook/db/src/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
    conn: postgres.Sql | undefined;
};

const connectionUrl = process.env.DATABASE_URL;
if (!connectionUrl) throw new Error('DATABASE_URL is required');

const conn = globalForDb.conn ?? postgres(connectionUrl, { prepare: false });
if (process.env.NODE_ENV !== 'production') globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
export type DrizzleDb = typeof db;