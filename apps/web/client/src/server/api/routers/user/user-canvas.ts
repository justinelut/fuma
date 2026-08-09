import {
    canvases,
    createDefaultUserCanvas,
    projects,
    fromDbCanvas,
    fromDbFrame,
    userCanvases,
    userCanvasUpdateSchema,
    type UserCanvas
} from '@onlook/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { verifyProjectAccess } from '../project/helper';

export const userCanvasRouter = createTRPCRouter({
    get: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
            }),
        )
        .query(async ({ ctx, input }) => {
            await verifyProjectAccess(ctx.db, ctx.user.id, input.projectId);
            const canvas = await ctx.db.query.canvases.findFirst({
                where: eq(canvases.projectId, input.projectId),
            });
            if (!canvas) {
                throw new Error('User canvas not found');
            }
            const userCanvas = await ctx.db.query.userCanvases.findFirst({
                where: and(
                    eq(userCanvases.canvasId, canvas.id),
                    eq(userCanvases.userId, ctx.user.id),
                ),
            });

            if (!userCanvas) {
                throw new Error('User canvas not found');
            }
            return fromDbCanvas(userCanvas);
        }),
    getWithFrames: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
            }),
        )
        .query(async ({ ctx, input }) => {
            await verifyProjectAccess(ctx.db, ctx.user.id, input.projectId);
            const dbCanvas = await ctx.db.query.canvases.findFirst({
                where: eq(canvases.projectId, input.projectId),
                with: {
                    frames: true,
                    userCanvases: {
                        where: eq(userCanvases.userId, ctx.user.id),
                    },
                },
            });
            if (!dbCanvas) {
                return null;
            }
            const userCanvas: UserCanvas = dbCanvas.userCanvases[0] ?? createDefaultUserCanvas(ctx.user.id, dbCanvas.id);
            return {
                userCanvas: fromDbCanvas(userCanvas),
                frames: dbCanvas.frames.map(fromDbFrame),
            };
        }),
    update: protectedProcedure.input(
        z.object({
            projectId: z.string(),
            canvasId: z.string(),
            canvas: userCanvasUpdateSchema.omit({ userId: true, canvasId: true }),
        })).mutation(async ({ ctx, input }) => {
            await verifyProjectAccess(ctx.db, ctx.user.id, input.projectId);
            const canvas = await ctx.db.query.canvases.findFirst({
                where: and(
                    eq(canvases.id, input.canvasId),
                    eq(canvases.projectId, input.projectId),
                ),
                columns: { id: true },
            });
            if (!canvas) {
                throw new Error('Unauthorized or not found');
            }
            try {
                await ctx.db
                    .update(userCanvases)
                    .set(input.canvas)
                    .where(
                        and(
                            eq(userCanvases.canvasId, input.canvasId),
                            eq(userCanvases.userId, ctx.user.id),
                        ),
                    );
                await ctx.db.update(projects).set({
                    updatedAt: new Date(),
                }).where(eq(projects.id, input.projectId));
                return true;
            } catch (error) {
                console.error('Error updating user canvas', error);
                return false;
            }
        }),
});
