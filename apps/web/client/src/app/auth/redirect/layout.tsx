import { getAuthSession } from '@/lib/auth/session';
import { Routes } from '@/utils/constants';
import { redirect } from 'next/navigation';

export default async function AuthRedirectLayout({ children }: { children: React.ReactNode }) {
    if (!(await getAuthSession())) {
        redirect(Routes.LOGIN);
    }
    return children;
}
