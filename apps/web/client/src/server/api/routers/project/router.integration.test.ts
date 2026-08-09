import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { db } from '@onlook/db/src/client';
import {
    auth_users,
    auth_verifications,
    canvases,
    projects,
    sandboxClaims,
    userProjects,
    users,
} from '@onlook/db';
import { DeploymentType, ProjectRole } from '@onlook/models';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { claimSandbox } from './helper';

mock.module('server-only', () => ({}));

let createCaller: typeof import('../../root').createCaller;

process.env.CSB_API_KEY ??= 'test';
process.env.OPENROUTER_API_KEY ??= 'test';
process.env.GITHUB_APP_ID ??= '1';
process.env.GITHUB_APP_SLUG ??= 'test-app';
process.env.GITHUB_APP_PRIVATE_KEY ??= 'test-key';
beforeAll(async () => {
    ({ createCaller } = await import('../../root'));
});

const createdUserIds: string[] = [];
const createdProjectIds: string[] = [];

function authUser(id: string, email: string) {
    const now = new Date();
    return {
        id,
        name: email.split('@')[0] ?? 'Test User',
        email,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
    };
}

function callerFor(user: ReturnType<typeof authUser>) {
    return createCaller({
        auth: {} as never,
        db,
        headers: new Headers(),
        user,
        session: {
            id: randomUUID(),
            token: 'integration-session',
            userId: user.id,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            updatedAt: new Date(),
            ipAddress: null,
            userAgent: null,
        },
    } as never);
}

afterAll(async () => {
    if (createdProjectIds.length > 0) {
        await db.delete(projects).where(inArray(projects.id, createdProjectIds));
    }
    if (createdUserIds.length > 0) {
        await db.delete(auth_users).where(inArray(auth_users.id, createdUserIds));
    }
});

describe('hosted project/editor persistence', () => {
    it('consumes sandbox claims, persists editor state, binds publishing, and denies another tenant', async () => {
        const owner = authUser(randomUUID(), `owner-${randomUUID()}@example.com`);
        const outsider = authUser(randomUUID(), `outsider-${randomUUID()}@example.com`);
        createdUserIds.push(owner.id, outsider.id);

        await db.insert(auth_users).values([owner, outsider]);
        await db.insert(users).values([
            { id: owner.id, email: owner.email, displayName: owner.name },
            { id: outsider.id, email: outsider.email, displayName: outsider.name },
        ]);

        const sandboxId = `integration-${randomUUID()}`;
        await claimSandbox(db, owner.id, sandboxId);

        const ownerCaller = callerFor(owner);
        const outsiderCaller = callerFor(outsider);

        const installation = await ownerCaller.github.generateInstallationUrl();
        const installationState = new URL(installation.url).searchParams.get('state');
        expect(installationState).toBeTruthy();
        expect(installationState).not.toBe(owner.id);
        const storedState = await db.query.auth_verifications.findFirst({
            where: eq(auth_verifications.identifier, `github-install:${owner.id}`),
        });
        expect(storedState?.value).not.toBe(installationState);
        await ownerCaller.github.handleInstallationCallbackUrl({
            installationId: '123456',
            setupAction: 'install',
            state: installationState!,
        });
        await expect(ownerCaller.github.handleInstallationCallbackUrl({
            installationId: '123456',
            setupAction: 'install',
            state: installationState!,
        })).rejects.toThrow('Invalid or expired state parameter');

        await expect(ownerCaller.project.create({
            project: { name: 'Wrong authenticated owner' },
            userId: outsider.id,
            sandboxId,
            sandboxUrl: `https://${sandboxId}-3000.csb.app`,
        })).rejects.toThrow('Unauthorized');

        await expect(ownerCaller.project.create({
            project: { name: 'Mismatched sandbox URL' },
            userId: owner.id,
            sandboxId,
            sandboxUrl: `https://another-sandbox-3000.csb.app`,
        })).rejects.toThrow('Sandbox preview URL does not match sandbox');

        const project = await ownerCaller.project.create({
            project: {
                name: 'Persistence integration',
                description: 'Hosted Drizzle integration fixture',
                tags: ['integration'],
            },
            userId: owner.id,
            sandboxId,
            sandboxUrl: `https://${sandboxId}-3000.csb.app`,
        });
        createdProjectIds.push(project.id);

        const consumedClaim = await db.query.sandboxClaims.findFirst({
            where: and(
                eq(sandboxClaims.sandboxId, sandboxId),
                eq(sandboxClaims.userId, owner.id),
            ),
        });
        expect(consumedClaim).toBeUndefined();

        const branches = await ownerCaller.branch.getByProjectId({ projectId: project.id });
        expect(branches).toHaveLength(1);
        expect(branches[0]?.sandbox.id).toBe(sandboxId);

        const initial = await ownerCaller.project.getProjectWithCanvas({ projectId: project.id });
        if (!initial) {
            throw new Error('Project canvas was not persisted');
        }
        expect(initial.frames).toHaveLength(1);
        const frame = initial.frames[0];
        expect(frame).toBeDefined();

        await ownerCaller.frame.update({ id: frame!.id, x: '321', y: '123' });
        const reloadedFrame = await ownerCaller.frame.get({ frameId: frame!.id });
        expect(reloadedFrame?.position).toEqual({ x: 321, y: 123 });

        await ownerCaller.userCanvas.update({
            projectId: project.id,
            canvasId: initial.userCanvas.id,
            canvas: { x: '44', y: '55', scale: '0.75' },
        });
        const reloadedCanvas = await ownerCaller.userCanvas.get({ projectId: project.id });
        expect(reloadedCanvas.position).toEqual({ x: 44, y: 55 });
        expect(reloadedCanvas.scale).toBe(0.75);

        await ownerCaller.settings.upsert({
            projectId: project.id,
            settings: {
                projectId: project.id,
                installCommand: 'bun install',
                runCommand: 'bun dev',
                buildCommand: 'bun run build',
            },
        });
        const settings = await ownerCaller.settings.get({ projectId: project.id });
        expect(settings?.commands.run).toBe('bun dev');

        const deployment = await ownerCaller.publish.deployment.create({
            projectId: project.id,
            sandboxId,
            type: DeploymentType.PREVIEW,
        });
        expect(deployment.projectId).toBe(project.id);
        expect(deployment.sandboxId).toBe(sandboxId);

        expect(await outsiderCaller.project.hasAccess({ projectId: project.id })).toBe(false);
        await expect(
            outsiderCaller.project.get({ projectId: project.id }),
        ).rejects.toThrow('Unauthorized or not found');
        await expect(
            outsiderCaller.sandbox.start({ sandboxId }),
        ).rejects.toThrow('Unauthorized or not found');

        await ownerCaller.user.delete();
        const [deletedIdentity, deletedProject] = await Promise.all([
            db.query.auth_users.findFirst({ where: eq(auth_users.id, owner.id) }),
            db.query.projects.findFirst({ where: eq(projects.id, project.id) }),
        ]);
        expect(deletedIdentity).toBeUndefined();
        expect(deletedProject).toBeUndefined();
    }, 20_000);

    it('enforces invitation roles, invitee identity, owner-only removal, and the last-owner invariant', async () => {
        const owner = authUser(randomUUID(), `invite-owner-${randomUUID()}@example.com`);
        const admin = authUser(randomUUID(), `invite-admin-${randomUUID()}@example.com`);
        const invitee = authUser(randomUUID(), `invitee-${randomUUID()}@example.com`);
        const outsider = authUser(randomUUID(), `invite-outsider-${randomUUID()}@example.com`);
        const fixtureUsers = [owner, admin, invitee, outsider];
        createdUserIds.push(...fixtureUsers.map((user) => user.id));
        await db.insert(auth_users).values(fixtureUsers);
        await db.insert(users).values(fixtureUsers.map((user) => ({
            id: user.id,
            email: user.email,
            displayName: user.name,
        })));

        const [project] = await db.insert(projects).values({ name: 'Invitation integration' }).returning();
        createdProjectIds.push(project!.id);
        await db.insert(canvases).values({ projectId: project!.id });
        await db.insert(userProjects).values([
            { projectId: project!.id, userId: owner.id, role: ProjectRole.OWNER },
            { projectId: project!.id, userId: admin.id, role: ProjectRole.ADMIN },
        ]);

        const ownerCaller = callerFor(owner);
        const adminCaller = callerFor(admin);
        const inviteeCaller = callerFor(invitee);
        const outsiderCaller = callerFor(outsider);

        await expect(adminCaller.invitation.create({
            projectId: project!.id,
            inviteeEmail: invitee.email,
            role: ProjectRole.OWNER,
        })).rejects.toThrow('Unauthorized or not found');

        const invitation = await ownerCaller.invitation.create({
            projectId: project!.id,
            inviteeEmail: invitee.email.toUpperCase(),
            role: ProjectRole.OWNER,
        });
        expect(invitation?.inviteeEmail).toBe(invitee.email);
        await expect(outsiderCaller.invitation.get({ id: invitation!.id })).rejects.toThrow(
            'Unauthorized or not found',
        );
        expect((await inviteeCaller.invitation.get({ id: invitation!.id })).id).toBe(invitation!.id);

        await inviteeCaller.invitation.accept({ id: invitation!.id, token: invitation!.token });
        const inviteeMembership = await db.query.userProjects.findFirst({
            where: and(
                eq(userProjects.projectId, project!.id),
                eq(userProjects.userId, invitee.id),
            ),
        });
        expect(inviteeMembership?.role).toBe(ProjectRole.OWNER);

        await expect(adminCaller.member.remove({
            projectId: project!.id,
            userId: invitee.id,
        })).rejects.toThrow('Unauthorized or not found');
        expect(await ownerCaller.member.remove({
            projectId: project!.id,
            userId: invitee.id,
        })).toBe(true);
        await expect(ownerCaller.member.remove({
            projectId: project!.id,
            userId: owner.id,
        })).rejects.toThrow('A project must retain at least one owner');
    }, 20_000);
});
