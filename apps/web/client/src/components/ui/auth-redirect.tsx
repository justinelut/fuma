'use client';

import { useSession } from '@/lib/auth/client';
import { LocalForageKeys, Routes } from '@/utils/constants';
import localforage from 'localforage';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export const AuthRedirect = ({ children }: { children: React.ReactNode }) => {
    const { data: session, isPending } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (isPending || session) return;
        const redirectToLogin = async () => {
            await localforage.setItem(LocalForageKeys.RETURN_URL, window.location.pathname);
            router.push(Routes.LOGIN);
        };
        void redirectToLogin();
    }, [isPending, router, session]);

    if (isPending) return null;
    return <>{children}</>;
};
