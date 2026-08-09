import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { compare, hash } from 'bcryptjs';
import { db } from '@onlook/db/src/client';
import {
    auth_accounts,
    auth_sessions,
    auth_users,
    projects,
    userProjects,
    users,
} from '@onlook/db';
import { ProjectRole } from '@onlook/models';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

mock.module('server-only', () => ({}));

process.env.CSB_API_KEY ??= 'test';
process.env.OPENROUTER_API_KEY ??= 'test';
let auth: typeof import('./server').auth;
let createCaller: typeof import('../../server/api/root').createCaller;
let storageGet: typeof import('../../app/api/storage/[bucket]/[...path]/route').GET;
const cleanupUserIds: string[] = [];
const cleanupProjectIds: string[] = [];

beforeAll(async () => {
    ({ auth } = await import('./server'));
    ({ createCaller } = await import('../../server/api/root'));
    ({ GET: storageGet } = await import('../../app/api/storage/[bucket]/[...path]/route'));
});

afterAll(async () => {
    if (cleanupProjectIds.length > 0) {
        await db.delete(projects).where(inArray(projects.id, cleanupProjectIds));
    }
    if (cleanupUserIds.length > 0) {
        await db.delete(auth_users).where(inArray(auth_users.id, cleanupUserIds));
    }
});

function cookieFrom(response: Response): string {
    const values = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie') ?? ''];
    const value = values.find((entry) => entry.includes('onlook_session='));
    const pair = value?.split(';')[0];
    if (!pair) throw new Error('Better Auth session cookie missing');
    return pair;
}

function requestHeaders(cookie: string) {
    return new Headers({ cookie });
}

describe('hosted Better Auth', () => {
    it('signs up, persists only a session hash, restores the session, and logs out', async () => {
        const email = `auth-${randomUUID()}@example.com`;
        const password = 'HostedAuth!123';
        const response = await auth.api.signUpEmail({
            body: { name: 'Hosted Auth Test', email, password },
            asResponse: true,
        });
        expect(response.status).toBeLessThan(400);
        const cookie = cookieFrom(response);

        const identity = await db.query.auth_users.findFirst({ where: eq(auth_users.email, email) });
        expect(identity).toBeDefined();
        cleanupUserIds.push(identity!.id);
        const domainUser = await db.query.users.findFirst({ where: eq(users.id, identity!.id) });
        expect(domainUser?.email).toBe(email);

        const session = await auth.api.getSession({ headers: requestHeaders(cookie) });
        expect(session?.user.id).toBe(identity!.id);
        const storedSession = await db.query.auth_sessions.findFirst({
            where: eq(auth_sessions.userId, identity!.id),
        });
        expect(storedSession?.token).toMatch(/^[a-f0-9]{64}$/);
        expect(cookie).not.toContain(storedSession!.token);

        const logout = await auth.api.signOut({
            headers: requestHeaders(cookie),
            asResponse: true,
        });
        expect(logout.status).toBeLessThan(400);
        expect(await auth.api.getSession({ headers: requestHeaders(cookie) })).toBeNull();
        expect(await db.query.auth_sessions.findFirst({
            where: eq(auth_sessions.userId, identity!.id),
        })).toBeUndefined();
    }, 15_000);

    it('accepts a migrated bcrypt credential and rejects the wrong password', async () => {
        const id = randomUUID();
        const email = `bcrypt-${randomUUID()}@example.com`;
        const password = 'MigratedBcrypt!123';
        cleanupUserIds.push(id);
        const passwordHash = await hash(password, 10);
        expect(await compare(password, passwordHash)).toBe(true);

        await db.insert(auth_users).values({
            id,
            name: 'Migrated User',
            email,
            emailVerified: true,
        });
        await db.insert(users).values({ id, email, displayName: 'Migrated User' });
        await db.insert(auth_accounts).values({
            accountId: id,
            providerId: 'credential',
            userId: id,
            password: passwordHash,
        });

        const wrong = await auth.api.signInEmail({
            body: { email, password: 'wrong-password' },
            asResponse: true,
        });
        expect(wrong.status).toBeGreaterThanOrEqual(400);

        const response = await auth.api.signInEmail({
            body: { email, password },
            asResponse: true,
        });
        expect(response.status).toBeLessThan(400);
        const cookie = cookieFrom(response);
        expect((await auth.api.getSession({ headers: requestHeaders(cookie) }))?.user.id).toBe(id);
        await auth.api.signOut({ headers: requestHeaders(cookie), asResponse: true });
    }, 15_000);

    it('rejects unauthenticated tRPC and hides another tenant storage object before MinIO access', async () => {
        const unauthenticated = createCaller({
            auth,
            db,
            headers: new Headers(),
            session: null,
            user: null,
        });
        await expect(unauthenticated.project.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

        const ownerId = randomUUID();
        const readerEmail = `reader-${randomUUID()}@example.com`;
        const ownerEmail = `storage-owner-${randomUUID()}@example.com`;
        cleanupUserIds.push(ownerId);
        await db.insert(auth_users).values({
            id: ownerId,
            name: 'Storage Owner',
            email: ownerEmail,
            emailVerified: true,
        });
        await db.insert(users).values({ id: ownerId, email: ownerEmail });

        const signUp = await auth.api.signUpEmail({
            body: { name: 'Storage Reader', email: readerEmail, password: 'StorageReader!123' },
            asResponse: true,
        });
        const cookie = cookieFrom(signUp);
        const reader = await db.query.auth_users.findFirst({ where: eq(auth_users.email, readerEmail) });
        cleanupUserIds.push(reader!.id);

        const [project] = await db.insert(projects).values({ name: 'Private storage project' }).returning();
        cleanupProjectIds.push(project!.id);
        await db.insert(userProjects).values({
            projectId: project!.id,
            userId: ownerId,
            role: ProjectRole.OWNER,
        });

        const unauthResponse = await storageGet(
            new Request(`http://localhost/api/storage/preview_images/public/${project!.id}/preview.jpg`),
            { params: Promise.resolve({ bucket: 'preview_images', path: ['public', project!.id, 'preview.jpg'] }) },
        );
        expect(unauthResponse.status).toBe(401);

        const crossTenantResponse = await storageGet(
            new Request(`http://localhost/api/storage/preview_images/public/${project!.id}/preview.jpg`, {
                headers: requestHeaders(cookie),
            }),
            { params: Promise.resolve({ bucket: 'preview_images', path: ['public', project!.id, 'preview.jpg'] }) },
        );
        expect(crossTenantResponse.status).toBe(404);
    }, 20_000);
});
