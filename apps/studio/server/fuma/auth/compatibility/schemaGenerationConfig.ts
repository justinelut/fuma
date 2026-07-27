import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { createHostedAuthOptions as createCompatibilityAuthOptions } from '../../../auth/hosted/auth'
import { withHashedSessionTokens } from '../../../auth/hosted/sessionTokenAdapter'

// postgres.js is lazy: schema generation constructs this client but issues no
// network request. The CLI reads Better Auth's logical model graph only.
const schemaClient = postgres(
  'postgres://fuma_schema_generation:unused@127.0.0.1:5432/fuma_schema_generation',
  { max: 1 },
)
const database = withHashedSessionTokens(drizzleAdapter(drizzle(schemaClient), {
  provider: 'pg',
}))

export const auth = betterAuth(createCompatibilityAuthOptions(database, {
  baseURL: 'https://app.fuma.co.ke',
  secret: 'fuma-010-schema-generation-only-secret-at-least-32-characters',
  secureCookies: true,
}, { create: async () => {} }))
