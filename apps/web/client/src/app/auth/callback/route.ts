import { Routes } from '@/utils/constants';
import { NextResponse } from 'next/server';

/** Better Auth owns OAuth callbacks under /api/auth/callback/:provider. */
export function GET(request: Request) {
    return NextResponse.redirect(new URL(Routes.AUTH_REDIRECT, request.url));
}
