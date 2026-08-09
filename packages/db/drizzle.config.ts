import { defineConfig } from 'drizzle-kit';

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/onlook';

export default defineConfig({
    schema: './src/schema',
    out: './drizzle',
    dialect: 'postgresql',
    schemaFilter: ['public'],
    verbose: true,
    dbCredentials: {
        url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    },
});