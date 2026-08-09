import 'server-only';

import { headers } from 'next/headers';
import { auth } from './server';

export async function getAuthSession() {
    return await auth.api.getSession({ headers: await headers() });
}

export async function requireAuthSession() {
    const session = await getAuthSession();
    if (!session) throw new Error('Auth session missing!');
    return session;
}
