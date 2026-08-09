'use server';

import { env } from '@/env';
import { auth } from '@/lib/auth/server';
import { getAuthSession } from '@/lib/auth/session';
import { Routes } from '@/utils/constants';
import { SEED_USER } from '@onlook/db';
import { SignInMethod } from '@onlook/models';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export async function login(provider: SignInMethod.GITHUB | SignInMethod.GOOGLE) {
    if (await getAuthSession()) redirect(Routes.AUTH_REDIRECT);

    const result = await auth.api.signInSocial({
        body: {
            provider,
            callbackURL: `${env.NEXT_PUBLIC_SITE_URL}${Routes.AUTH_REDIRECT}`,
        },
    });

    if (!result.url) throw new Error(`Could not start ${provider} sign-in`);
    redirect(result.url);
}

export async function devLogin() {
    if (env.NODE_ENV !== 'development') throw new Error('Dev login is only available in development mode');
    if (await getAuthSession()) redirect(Routes.AUTH_REDIRECT);

    try {
        await auth.api.signInEmail({
            body: { email: SEED_USER.EMAIL, password: SEED_USER.PASSWORD },
            headers: await headers(),
        });
    } catch {
        await auth.api.signUpEmail({
            body: {
                name: SEED_USER.DISPLAY_NAME,
                email: SEED_USER.EMAIL,
                password: SEED_USER.PASSWORD,
                image: SEED_USER.AVATAR_URL,
            },
            headers: await headers(),
        });
    }

    redirect(Routes.AUTH_REDIRECT);
}
