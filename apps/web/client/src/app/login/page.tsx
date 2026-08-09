import { env } from '@/env';
import { getAuthSession } from '@/lib/auth/session';
import { Routes } from '@/utils/constants';
import { redirect } from 'next/navigation';
import { LoginClient } from './login-client';

export default async function LoginPage() {
    if (await getAuthSession()) {
        redirect(Routes.AUTH_REDIRECT);
    }

    return (
        <LoginClient
            githubEnabled={Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)}
            googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
            devLoginEnabled={env.NODE_ENV === 'development'}
        />
    );
}
