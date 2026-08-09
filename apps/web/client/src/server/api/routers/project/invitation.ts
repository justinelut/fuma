import { env } from '@/env';
import {
    auth_users,
    createDefaultUserCanvas,
    projectInvitationInsertSchema,
    projectInvitations,
    fromDbUser,
    userCanvases,
    userProjects,
    users,
} from '@onlook/db';
import { constructInvitationLink, getResendClient, sendInvitationEmail } from '@onlook/email';
import { ProjectRole } from '@onlook/models';
import { isFreeEmail } from '@onlook/utility';
import { TRPCError } from '@trpc/server';
import { addDays, isAfter } from 'date-fns';
import { and, eq, ilike, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { verifyInvitationAccess, verifyInvitationReadAccess, verifyProjectAccess, verifyProjectRole } from './helper';

export const invitationRouter = createTRPCRouter({
    get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
        await verifyInvitationReadAccess(ctx.db, ctx.user.id, ctx.user.email, input.id);
        const invitation = await ctx.db.query.projectInvitations.findFirst({
            where: eq(projectInvitations.id, input.id),
            with: {
                inviter: true,
            },
        });

        if (!invitation) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Invitation not found',
            });
        }

        if (!invitation.inviter) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Inviter not found',
            });
        }

        return {
            ...invitation,
            inviter: fromDbUser(invitation.inviter),
        };
    }),
    getWithoutToken: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
        await verifyInvitationReadAccess(ctx.db, ctx.user.id, ctx.user.email, input.id);
        const invitation = await ctx.db.query.projectInvitations.findFirst({
            where: eq(projectInvitations.id, input.id),
            with: {
                inviter: true,
            },
        });

        if (!invitation) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Invitation not found',
            });
        }

        if (!invitation.inviter) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Inviter not found',
            });
        }

        return {
            ...invitation,
            token: null,
            inviter: fromDbUser(invitation.inviter),
        };
    }),
    list: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
            }),
        )
        .query(async ({ ctx, input }) => {
            await verifyProjectAccess(ctx.db, ctx.user.id, input.projectId);
            const invitations = await ctx.db.query.projectInvitations.findMany({
                where: eq(projectInvitations.projectId, input.projectId),
            });

            return invitations;
        }),
    create: protectedProcedure
        .input(
            projectInvitationInsertSchema.pick({
                projectId: true,
                inviteeEmail: true,
                role: true,
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const inviteeEmail = input.inviteeEmail.trim().toLowerCase();
            if (!ctx.user.id) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'You must be logged in to invite a user',
                });
            }
            const allowedInviterRoles = input.role === ProjectRole.OWNER
                ? [ProjectRole.OWNER]
                : [ProjectRole.OWNER, ProjectRole.ADMIN];
            await verifyProjectRole(ctx.db, ctx.user.id, input.projectId, allowedInviterRoles);
            const inviter = await ctx.db.query.users.findFirst({
                where: eq(users.id, ctx.user.id),
            });

            if (!inviter) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Inviter not found',
                });
            }

            const [invitation] = await ctx.db
                .transaction(async (tx) => {
                    const existingUser = await tx
                        .select()
                        .from(userProjects)
                        .innerJoin(auth_users, eq(auth_users.id, userProjects.userId))
                        .where(
                            and(
                                eq(userProjects.projectId, input.projectId),
                                eq(auth_users.email, inviteeEmail),
                            ),
                        )
                        .limit(1);

                    if (existingUser.length > 0) {
                        throw new TRPCError({
                            code: 'CONFLICT',
                            message: 'User is already a member of the project',
                        });
                    }

                    return await tx
                        .insert(projectInvitations)
                        .values([
                            {
                                ...input,
                                inviteeEmail,
                                role: input.role as ProjectRole,
                                token: uuidv4(),
                                inviterId: ctx.user.id,
                                expiresAt: addDays(new Date(), 7),
                            },
                        ])
                        .returning();
                })

            if (invitation && env.RESEND_API_KEY) {
                const emailClient = getResendClient({
                    apiKey: env.RESEND_API_KEY,
                });

                await sendInvitationEmail(
                    emailClient,
                    {
                        inviteeEmail,
                        invitedByName: inviter.firstName ?? inviter.displayName ?? undefined,
                        invitedByEmail: ctx.user.email,
                        inviteLink: constructInvitationLink(
                            env.NEXT_PUBLIC_SITE_URL,
                            invitation.id,
                            invitation.token,
                        ),
                    },
                    {
                        dryRun: env.NODE_ENV !== 'production',
                    },
                );
            }

            return invitation;
        }),
    delete: protectedProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            await verifyInvitationAccess(ctx.db, ctx.user.id, input.id);
            const invitation = await ctx.db.query.projectInvitations.findFirst({
                where: eq(projectInvitations.id, input.id),
                columns: { projectId: true, role: true },
            });
            if (!invitation) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' });
            }
            if (invitation.role === ProjectRole.OWNER) {
                await verifyProjectRole(ctx.db, ctx.user.id, invitation.projectId, [ProjectRole.OWNER]);
            }
            await ctx.db.delete(projectInvitations).where(eq(projectInvitations.id, input.id));

            return true;
        }),
    accept: protectedProcedure
        .input(z.object({ token: z.string(), id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            if (!ctx.user.id) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'You must be logged in to accept an invitation',
                });
            }

            const invitation = await ctx.db.query.projectInvitations.findFirst({
                where: and(
                    eq(projectInvitations.id, input.id),
                    eq(projectInvitations.token, input.token),
                ),
                with: {
                    project: {
                        with: {
                            canvas: true,
                        },
                    },
                },
            });

            if (!invitation) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Invitation does not exist',
                });
            }

            if (invitation.inviteeEmail.trim().toLowerCase() !== ctx.user.email.trim().toLowerCase()) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `This invitation was sent to ${invitation.inviteeEmail}. Please sign in with that email address.`,
                });
            }

            if (invitation.role === ProjectRole.OWNER) {
                await verifyProjectRole(
                    ctx.db,
                    invitation.inviterId,
                    invitation.projectId,
                    [ProjectRole.OWNER],
                );
            }

            if (isAfter(new Date(), invitation.expiresAt)) {
                if (invitation) {
                    await ctx.db
                        .delete(projectInvitations)
                        .where(eq(projectInvitations.id, invitation.id));
                }

                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Invitation has expired',
                });
            }

            await ctx.db.transaction(async (tx) => {
                await tx.delete(projectInvitations).where(eq(projectInvitations.id, invitation.id));

                await tx
                    .insert(userProjects)
                    .values({
                        projectId: invitation.projectId,
                        userId: ctx.user.id,
                        role: invitation.role,
                    })
                    .onConflictDoNothing();

                await tx
                    .insert(userCanvases)
                    .values(createDefaultUserCanvas(ctx.user.id, invitation.project.canvas.id))
                    .onConflictDoNothing();
            });
        }),
    suggested: protectedProcedure
        .input(z.object({ projectId: z.string() }))
        .query(async ({ ctx, input }) => {
            await verifyProjectAccess(ctx.db, ctx.user.id, input.projectId);
            if (isFreeEmail(ctx.user.email)) {
                return [];
            }
            const domain = ctx.user.email.split('@').at(-1);

            const suggestedUsers = await ctx.db
                .select()
                .from(auth_users)
                .leftJoin(
                    userProjects,
                    and(
                        eq(userProjects.userId, auth_users.id),
                        eq(userProjects.projectId, input.projectId),
                    ),
                )
                .leftJoin(
                    projectInvitations,
                    and(
                        eq(projectInvitations.inviteeEmail, auth_users.email),
                        eq(projectInvitations.projectId, input.projectId),
                    ),
                )
                .where(
                    and(
                        ilike(auth_users.email, `%@${domain}`),
                        isNull(userProjects.userId), // Not in the project
                        isNull(projectInvitations.id), // Not invited
                    ),
                )
                .limit(5);

            return suggestedUsers.map((user) => user.auth_users.email);
        }),
});
