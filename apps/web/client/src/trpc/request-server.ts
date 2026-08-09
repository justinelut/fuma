'use server';

import { auth } from '@/lib/auth/server';
import { db } from '@onlook/db/src/client';
import { createHydrationHelpers } from '@trpc/react-query/rsc';
import type { NextRequest } from 'next/server';
import { cache } from 'react';
import { createCaller, type AppRouter } from '~/server/api/root';
import { createQueryClient } from './query-client';

export const createTRPCContext = async (req: NextRequest, opts: { headers: Headers }) => {
    const resolved = await auth.api.getSession({ headers: req.headers });
    return {
        auth,
        db,
        session: resolved?.session ?? null,
        user: resolved?.user ?? null,
        ...opts,
    };
};

const getQueryClient = cache(createQueryClient);

/** Used for API routes without relying on next/headers. */
export const createClient = async (req: NextRequest) => {
    const caller = createCaller(await createTRPCContext(req, { headers: req.headers }));
    const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(caller, getQueryClient);
    return { api, HydrateClient };
};
