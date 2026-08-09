import { getAuthSession } from '@/lib/auth/session';
import { Routes } from '@/utils/constants';
import { getReturnUrlQueryParam } from '@/utils/url';
import { type Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
    title: 'Onlook',
    description: 'Onlook – Projects',
};

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
    const session = await getAuthSession();
    if (!session) {
        const headersList = await headers();
        const pathname = headersList.get('x-pathname') || Routes.PROJECTS;
        redirect(`${Routes.LOGIN}?${getReturnUrlQueryParam(pathname)}`);
    }

    return <>{children}</>;
}
