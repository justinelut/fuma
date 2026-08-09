import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';

config({ path: '../../.env' });

const connectionUrl = process.env.DATABASE_URL;
if (!connectionUrl) {
    throw new Error('DATABASE_URL is required');
}

const client = postgres(connectionUrl, { max: 1, prepare: false });
const database = drizzle(client);
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

try {
    await migrate(database, { migrationsFolder });

    const authTables = await database.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('auth_users', 'auth_sessions', 'auth_accounts', 'auth_verifications')
    `);
    if (authTables[0]?.count !== 4) {
        throw new Error('Hosted migration invariant failed: Better Auth tables are incomplete');
    }

    const identityForeignKey = await database.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND conname = 'users_id_auth_users_id_fk'
    `);
    if (identityForeignKey[0]?.count !== 1) {
        throw new Error('Hosted migration invariant failed: users.id is not linked to auth_users.id');
    }

    const sandboxClaimTable = await database.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
        FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'sandbox_claims'
    `);
    if (sandboxClaimTable[0]?.count !== 1) {
        throw new Error('Hosted migration invariant failed: sandbox claims table is missing');
    }

    const rowSecurityTables = await database.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
        FROM pg_tables
        WHERE schemaname = 'public' AND rowsecurity
    `);
    if (rowSecurityTables[0]?.count !== 0) {
        throw new Error('Hosted migration invariant failed: legacy Supabase RLS remains enabled');
    }

    console.log('Hosted Drizzle migrations applied and verified.');
} finally {
    await client.end();
}
