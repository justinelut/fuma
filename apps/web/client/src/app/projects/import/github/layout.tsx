import { getAuthSession } from '@/lib/auth/session';
import { Routes } from '@/utils/constants';
import { type Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ImportGithubProjectProvider } from './_context';

export const metadata: Metadata = {
    title: 'Onlook',
    description: 'Onlook – Import Github Project',
};

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
    if (!(await getAuthSession())) redirect(Routes.LOGIN);
    return <ImportGithubProjectProvider totalSteps={3}>{children}</ImportGithubProjectProvider>;
}
