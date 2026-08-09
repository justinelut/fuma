import { deployments, deploymentUpdateSchema, previewDomains, projectCustomDomains, type Deployment, type DrizzleDb } from '@onlook/db';
import {
    DeploymentStatus,
    DeploymentType
} from '@onlook/models';
import { assertNever } from '@onlook/utility';
import { TRPCError } from '@trpc/server';
import { and, eq, ne } from 'drizzle-orm';
import { z } from "zod";

export async function getProjectUrls(db: DrizzleDb, projectId: string, type: DeploymentType): Promise<string[]> {
    let urls: string[] = [];
    if (type === DeploymentType.PREVIEW || type === DeploymentType.UNPUBLISH_PREVIEW) {
        const foundPreviewDomains = await db.query.previewDomains.findMany({
            where: eq(previewDomains.projectId, projectId),
        });
        if (!foundPreviewDomains || foundPreviewDomains.length === 0) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'No preview domain found',
            });
        }
        urls = foundPreviewDomains.map(domain => domain.fullDomain);
    } else if (type === DeploymentType.CUSTOM || type === DeploymentType.UNPUBLISH_CUSTOM) {
        const foundCustomDomains = await db.query.projectCustomDomains.findMany({
            where: eq(projectCustomDomains.projectId, projectId),
        });
        if (!foundCustomDomains || foundCustomDomains.length === 0) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'No custom domain found',
            });
        }
        urls = foundCustomDomains.map(domain => domain.fullDomain);
    } else {
        assertNever(type);
    }
    return urls;
}

export async function updateDeployment(db: DrizzleDb, deployment: z.infer<typeof deploymentUpdateSchema>): Promise<Deployment | null> {
    try {
        const { id, type, status, ...updates } = deployment;
        const [result] = await db.update(deployments).set({
            ...updates,
            ...(type ? { type: type as DeploymentType } : {}),
            ...(status ? { status: status as DeploymentStatus } : {}),
            updatedAt: new Date(),
        }).where(
            and(
                eq(deployments.id, id),
                ne(deployments.status, DeploymentStatus.CANCELLED)
            )
        ).returning();
        return result ?? null;
    } catch (error) {
        console.error(`Failed to update deployment ${deployment.id}:`, error);
        return null;
    }
}
