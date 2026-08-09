import { getAuthSession } from '@/lib/auth/session';
import { Routes } from '@/utils/constants';
import { getReturnUrlQueryParam } from '@/utils/url';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
    const session = await getAuthSession();
    if (!session) {
        const pathname = (await headers()).get('x-pathname') ?? Routes.PROJECTS;
        redirect(`${Routes.LOGIN}?${getReturnUrlQueryParam(pathname)}`);
    }

    return <>{children}</>;
}
