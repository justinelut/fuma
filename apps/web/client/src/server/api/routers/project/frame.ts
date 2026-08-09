import { frameInsertSchema, frames, frameUpdateSchema, fromDbFrame } from '@onlook/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { verifyCanvasAccess, verifyFrameAccess, verifyFrameParentAccess } from './helper';

export const frameRouter = createTRPCRouter({
    get: protectedProcedure
        .input(
            z.object({
                frameId: z.string(),
            }),
        )
        .query(async ({ ctx, input }) => {
            await verifyFrameAccess(ctx.db, ctx.user.id, input.frameId);
            const dbFrame = await ctx.db.query.frames.findFirst({
                where: eq(frames.id, input.frameId),
            });
            if (!dbFrame) {
                return null;
            }
            return fromDbFrame(dbFrame);
        }),
    getByCanvas: protectedProcedure
        .input(
            z.object({
                canvasId: z.string(),
            }),
        )
        .query(async ({ ctx, input }) => {
            await verifyCanvasAccess(ctx.db, ctx.user.id, input.canvasId);
            const dbFrames = await ctx.db.query.frames.findMany({
                where: eq(frames.canvasId, input.canvasId),
                orderBy: (frames, { asc }) => [asc(frames.x), asc(frames.y)],
            });
            return dbFrames.map((frame) => fromDbFrame(frame));
        }),
    create: protectedProcedure
        .input(frameInsertSchema)
        .mutation(async ({ ctx, input }) => {
            await verifyFrameParentAccess(
                ctx.db,
                ctx.user.id,
                input.canvasId,
                input.branchId,
            );
            try {
                await ctx.db.insert(frames).values(input);
                return true;
            } catch (error) {
                console.error('Error creating frame', error);
                return false;
            }
        }),
    update: protectedProcedure
        .input(frameUpdateSchema.omit({ canvasId: true, branchId: true }))
        .mutation(async ({ ctx, input }) => {
            await verifyFrameAccess(ctx.db, ctx.user.id, input.id);
            const { id, ...updates } = input;
            try {
                await ctx.db
                    .update(frames)
                    .set(updates)
                    .where(eq(frames.id, id));
                return true;
            } catch (error) {
                console.error('Error updating frame', error);
                return false;
            }
        }),
    delete: protectedProcedure
        .input(
            z.object({
                frameId: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            await verifyFrameAccess(ctx.db, ctx.user.id, input.frameId);
            try {
                await ctx.db.delete(frames).where(eq(frames.id, input.frameId));
                return true;
            } catch (error) {
                console.error('Error deleting frame', error);
                return false;
            }
        }),
});
