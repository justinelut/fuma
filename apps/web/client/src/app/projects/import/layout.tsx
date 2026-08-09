import { getAuthSession } from '@/lib/auth/session';
import { Routes } from '@/utils/constants';
import { type Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
    title: 'Onlook',
    description: 'Onlook – Create Project',
};

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
    if (!(await getAuthSession())) redirect(Routes.LOGIN);
    return <>{children}</>;
}
