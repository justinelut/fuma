import { trackEvent } from '@/utils/analytics/server';
import { callUserWebhook } from '@/utils/n8n/webhook';
import { auth_users, fromDbUser, projects, userInsertSchema, userProjects, users, type User } from '@onlook/db';
import { ProjectRole } from '@onlook/models';
import { extractNames } from '@onlook/utility';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { userSettingsRouter } from './user-settings';

export const userRouter = createTRPCRouter({
    get: protectedProcedure.query(async ({ ctx }) => {
        const authUser = ctx.user;
        const user = await ctx.db.query.users.findFirst({
            where: eq(users.id, authUser.id),
        });

        const { displayName, firstName, lastName } = getUserName(authUser);
        const userData = user ? fromDbUser({
            ...user,
            firstName: user.firstName ?? firstName,
            lastName: user.lastName ?? lastName,
            displayName: user.displayName ?? displayName,
            email: user.email ?? authUser.email,
            avatarUrl: user.avatarUrl ?? authUser.image ?? null,
        }) : null;
        return userData;
    }),
    getById: protectedProcedure.input(z.string()).query(async ({ ctx, input }) => {
        // A user may only look themselves up by id (this returns PII + the full
        // project list). `get` is the normal self path; guarding here closes the
        // cross-user read while keeping the endpoint's self-lookup behavior.
        if (input !== ctx.user.id) {
            throw new Error('Unauthorized or not found');
        }
        const user = await ctx.db.query.users.findFirst({
            where: eq(users.id, input),
            with: {
                userProjects: {
                    with: {
                        project: true,
                    },
                },
            },
        });
        return user;
    }),
    upsert: protectedProcedure
        .input(userInsertSchema)
        .mutation(async ({ ctx, input }): Promise<User | null> => {
            const authUser = ctx.user;

            // Pin the row to the session user — the client-supplied `input.id`
            // must never be able to create or overwrite another user's account.
            const existingUser = await ctx.db.query.users.findFirst({
                where: eq(users.id, authUser.id),
            });

            const { firstName, lastName, displayName } = getUserName(authUser);

            const userData = {
                id: authUser.id,
                firstName: input.firstName ?? firstName,
                lastName: input.lastName ?? lastName,
                displayName: input.displayName ?? displayName,
                email: authUser.email,
                avatarUrl: input.avatarUrl ?? authUser.image,
            };

            const [user] = await ctx.db
                .insert(users)
                .values(userData)
                .onConflictDoUpdate({
                    target: [users.id],
                    set: {
                        ...userData,
                        updatedAt: new Date(),
                    },
                }).returning();

            if (!existingUser) {
                await trackEvent({
                    distinctId: authUser.id,
                    event: 'user_first_signup',
                    properties: {
                        email: userData.email,
                        firstName: userData.firstName,
                        lastName: userData.lastName,
                        displayName: userData.displayName,
                        source: 'web beta',
                    },
                });

                await callUserWebhook({
                    email: userData.email,
                    firstName: userData.firstName,
                    lastName: userData.lastName,
                    source: 'web beta',
                    subscribed: false,
                });
            }

            return user ?? null;
        }),
    settings: userSettingsRouter,
    delete: protectedProcedure.mutation(async ({ ctx }) => {
        await ctx.db.transaction(async (tx) => {
            const ownedMemberships = await tx.query.userProjects.findMany({
                where: and(
                    eq(userProjects.userId, ctx.user.id),
                    eq(userProjects.role, ProjectRole.OWNER),
                ),
                columns: { projectId: true },
            });

            for (const membership of ownedMemberships) {
                const owners = await tx
                    .select({ userId: userProjects.userId })
                    .from(userProjects)
                    .where(and(
                        eq(userProjects.projectId, membership.projectId),
                        eq(userProjects.role, ProjectRole.OWNER),
                    ))
                    .for('update');
                if (owners.length === 1 && owners[0]?.userId === ctx.user.id) {
                    await tx.delete(projects).where(eq(projects.id, membership.projectId));
                }
            }

            await tx.delete(auth_users).where(eq(auth_users.id, ctx.user.id));
        });
    }),
});

function getUserName(authUser: { name: string }) {
    const displayName = authUser.name;
    const { firstName, lastName } = extractNames(displayName ?? '');
    return {
        displayName: displayName ?? '',
        firstName,
        lastName,
    };
}
