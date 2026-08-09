import { env } from '@/env';
import { db } from '@onlook/db/src/client';
import { users } from '@onlook/db';
import * as authSchema from '@onlook/db/src/schema/auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { withHashedSessionTokens } from './session-token-adapter';
import { hashCompatiblePassword, verifyCompatiblePassword } from './password';

const origin = new URL(env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_SITE_URL).origin;
const secureCookies = origin.startsWith('https://');
const socialProviders: BetterAuthOptions['socialProviders'] = {};

if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        redirectURI: `${origin}/api/auth/callback/github`,
    };
}

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectURI: `${origin}/api/auth/callback/google`,
    };
}

export const auth = betterAuth({
    appName: 'Onlook',
    basePath: '/api/auth',
    baseURL: origin,
    trustedOrigins: [origin],
    secret: env.BETTER_AUTH_SECRET,
    database: withHashedSessionTokens(
        drizzleAdapter(db, {
            provider: 'pg',
            schema: authSchema,
            transaction: true,
        }),
    ),
    user: { modelName: 'auth_users' },
    session: {
        modelName: 'auth_sessions',
        cookieCache: { enabled: false },
        freshAge: 5 * 60,
    },
    account: { modelName: 'auth_accounts' },
    verification: { modelName: 'auth_verifications' },
    emailAndPassword: {
        enabled: true,
        revokeSessionsOnPasswordReset: true,
        password: {
            hash: hashCompatiblePassword,
            verify: verifyCompatiblePassword,
        },
    },
    databaseHooks: {
        user: {
            create: {
                after: async (user) => {
                    await db
                        .insert(users)
                        .values({
                            id: user.id,
                            displayName: user.name,
                            email: user.email,
                            avatarUrl: user.image,
                        })
                        .onConflictDoNothing({ target: users.id });
                },
            },
        },
    },
    socialProviders,
    advanced: {
        database: { generateId: 'uuid' },
        useSecureCookies: secureCookies,
        defaultCookieAttributes: {
            httpOnly: true,
            sameSite: 'lax',
            secure: secureCookies,
            path: '/',
        },
        cookies: {
            session_token: {
                name: secureCookies ? '__Host-onlook_session' : 'onlook_session',
                attributes: {
                    httpOnly: true,
                    sameSite: 'lax',
                    secure: secureCookies,
                    path: '/',
                },
            },
        },
    },
    plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
