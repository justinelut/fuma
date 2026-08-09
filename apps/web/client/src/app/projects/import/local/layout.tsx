import { getAuthSession } from '@/lib/auth/session';
import { Routes } from '@/utils/constants';
import { type Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ProjectCreationProvider } from './_context';

export const metadata: Metadata = {
    title: 'Onlook',
    description: 'Onlook – Import Local Project',
};

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
    if (!(await getAuthSession())) redirect(Routes.LOGIN);
    return <ProjectCreationProvider totalSteps={2}>{children}</ProjectCreationProvider>;
}
