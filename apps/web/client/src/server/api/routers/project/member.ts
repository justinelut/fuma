import { fromDbUser, userProjects } from '@onlook/db';
import { ProjectRole } from '@onlook/models';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { verifyProjectAccess, verifyProjectRole } from './helper';

export const memberRouter = createTRPCRouter({
    list: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
            }),
        )
        .query(async ({ ctx, input }) => {
            await verifyProjectAccess(ctx.db, ctx.user.id, input.projectId);
            const members = await ctx.db.query.userProjects.findMany({
                where: eq(userProjects.projectId, input.projectId),
                with: {
                    user: true,
                },
            });
            // TODO: Fix this later
            return members.map((member) => ({
                role: member.role,
                user: fromDbUser({
                    id: member.user.id,
                    email: member.user.email,
                    createdAt: new Date(),
                    updatedAt: new Date(),

                    firstName: member.user.firstName ?? '',
                    lastName: member.user.lastName ?? '',
                    displayName: member.user.displayName ?? '',
                    avatarUrl: member.user.avatarUrl ?? '',
                    stripeCustomerId: null,
                    githubInstallationId: null,
                }),
            }));
        }),
    remove: protectedProcedure
        .input(z.object({ userId: z.string(), projectId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            return await ctx.db.transaction(async (tx) => {
                const membership = await tx.query.userProjects.findFirst({
                    where: and(
                        eq(userProjects.userId, input.userId),
                        eq(userProjects.projectId, input.projectId),
                    ),
                });
                if (!membership) {
                    throw new Error('Unauthorized or not found');
                }

                if (input.userId === ctx.user.id) {
                    await verifyProjectAccess(tx, ctx.user.id, input.projectId);
                } else {
                    await verifyProjectRole(tx, ctx.user.id, input.projectId, [ProjectRole.OWNER]);
                }

                if (membership.role === ProjectRole.OWNER) {
                    const owners = await tx
                        .select({ userId: userProjects.userId })
                        .from(userProjects)
                        .where(and(
                            eq(userProjects.projectId, input.projectId),
                            eq(userProjects.role, ProjectRole.OWNER),
                        ))
                        .for('update');
                    if (owners.length <= 1) {
                        throw new Error('A project must retain at least one owner');
                    }
                }

                await tx
                    .delete(userProjects)
                    .where(
                        and(
                            eq(userProjects.userId, input.userId),
                            eq(userProjects.projectId, input.projectId),
                        ),
                    );

                return true;
            });
        }),
});
