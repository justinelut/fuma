import { ProjectRole } from '@onlook/models';
import { and, eq, gt, inArray, lt, or } from "drizzle-orm";
import {
    branches,
    canvases,
    conversations,
    customDomainVerification,
    deployments,
    frames,
    messages,
    projectInvitations,
    projects,
    sandboxClaims,
    userProjects,
    type DrizzleDb,
    type Frame,
} from "@onlook/db";

/** Type representing a db instance or transaction that has query capabilities */
type DbOrTx = Pick<DrizzleDb, 'query'>;
type SandboxClaimDb = Pick<DrizzleDb, 'query' | 'insert' | 'delete'>;

const SANDBOX_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

export function extractCsbPort(frames: Frame[]): number | null {
    if (!frames || frames.length === 0) return null;

    for (const frame of frames) {
        if (frame.url) {
            // Match CSB preview URL pattern: https://sandboxId-port.csb.app
            const match = frame.url.match(/https:\/\/[^-]+-(\d+)\.csb\.app/);
            if (match && match[1]) {
                const port = parseInt(match[1], 10);
                if (!isNaN(port)) {
                    return port;
                }
            }
        }
    }
    return null;
}

/**
 * Verifies that a user has access to a project by checking the userProjects table.
 * @throws Error if the user does not have access to the project or if it doesn't exist
 *
 * Note: This function intentionally returns the same error message whether the project
 * doesn't exist or the user lacks access to prevent information disclosure about
 * project existence.
 *
 * Accepts either a db instance or a transaction to support atomic authorization checks.
 */
export async function verifyProjectAccess(
    db: DbOrTx,
    userId: string,
    projectId: string,
): Promise<void> {
    const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
        with: {
            userProjects: {
                where: eq(userProjects.userId, userId),
            },
        },
    });

    if (!project || project.userProjects.length === 0) {
        throw new Error('Unauthorized or not found');
    }
}

export async function verifyProjectRole(
    db: DbOrTx,
    userId: string,
    projectId: string,
    allowedRoles: readonly ProjectRole[],
): Promise<void> {
    const membership = await db.query.userProjects.findFirst({
        where: and(eq(userProjects.userId, userId), eq(userProjects.projectId, projectId)),
    });
    if (!membership || !allowedRoles.includes(membership.role)) {
        throw new Error('Unauthorized or not found');
    }
}

/**
 * Verifies that a user has access to a conversation via its parent project.
 * @throws Error if the conversation doesn't exist or the user lacks project access
 */
export async function verifyConversationAccess(
    db: DbOrTx,
    userId: string,
    conversationId: string,
): Promise<void> {
    const conversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, conversationId),
    });
    if (!conversation) {
        throw new Error('Unauthorized or not found');
    }
    await verifyProjectAccess(db, userId, conversation.projectId);
}

/**
 * Verifies that a user has access to every message in `messageIds`, via each
 * message's parent conversation -> project. Used by bulk operations (e.g.
 * message.delete) that accept an array of ids potentially spanning multiple
 * conversations/projects.
 * @throws Error if any message doesn't exist or resolves to an inaccessible project
 */
export async function verifyMessagesAccess(
    db: DbOrTx,
    userId: string,
    messageIds: string[],
): Promise<void> {
    if (messageIds.length === 0) {
        return;
    }
    // Dedupe: `inArray` returns one row per distinct id, so comparing against
    // the raw (possibly-duplicated) input length would falsely reject a caller
    // who passed the same id twice. Compare against the distinct-id count.
    const uniqueIds = [...new Set(messageIds)];
    const rows = await db.query.messages.findMany({
        where: inArray(messages.id, uniqueIds),
        with: { conversation: true },
    });
    if (rows.length !== uniqueIds.length) {
        throw new Error('Unauthorized or not found');
    }
    const projectIds = new Set(rows.map((row) => row.conversation.projectId));
    for (const projectId of projectIds) {
        await verifyProjectAccess(db, userId, projectId);
    }
}

/**
 * Verifies that a user has access to a branch via its parent project.
 * @throws Error if the branch doesn't exist or the user lacks project access
 */
export async function verifyBranchAccess(
    db: DbOrTx,
    userId: string,
    branchId: string,
): Promise<void> {
    const branch = await db.query.branches.findFirst({
        where: eq(branches.id, branchId),
    });
    if (!branch) {
        throw new Error('Unauthorized or not found');
    }
    await verifyProjectAccess(db, userId, branch.projectId);
}

/**
 * Verifies that a user has access to a canvas via its parent project.
 * @throws Error if the canvas doesn't exist or the user lacks project access
 */
export async function verifyCanvasAccess(
    db: DbOrTx,
    userId: string,
    canvasId: string,
): Promise<void> {
    const canvas = await db.query.canvases.findFirst({
        where: eq(canvases.id, canvasId),
    });
    if (!canvas) {
        throw new Error('Unauthorized or not found');
    }
    await verifyProjectAccess(db, userId, canvas.projectId);
}

/**
 * Verifies that a frame's canvas and optional branch belong to the same
 * accessible project. This prevents callers from linking resources across
 * tenants while still supporting historical frames without a branch.
 */
export async function verifyFrameParentAccess(
    db: DbOrTx,
    userId: string,
    canvasId: string,
    branchId?: string | null,
): Promise<void> {
    const canvas = await db.query.canvases.findFirst({
        where: eq(canvases.id, canvasId),
    });
    if (!canvas) {
        throw new Error('Unauthorized or not found');
    }

    if (branchId) {
        const branch = await db.query.branches.findFirst({
            where: eq(branches.id, branchId),
        });
        if (!branch || branch.projectId !== canvas.projectId) {
            throw new Error('Unauthorized or not found');
        }
    }

    await verifyProjectAccess(db, userId, canvas.projectId);
}

/**
 * Verifies that a user has access to a frame via its parent canvas -> project.
 * @throws Error if the frame doesn't exist or the user lacks project access
 */
export async function verifyFrameAccess(
    db: DbOrTx,
    userId: string,
    frameId: string,
): Promise<void> {
    const frame = await db.query.frames.findFirst({
        where: eq(frames.id, frameId),
    });
    if (!frame) {
        throw new Error('Unauthorized or not found');
    }
    await verifyCanvasAccess(db, userId, frame.canvasId);
}

/**
 * Verifies that a user has access to a project invitation via its parent project.
 * @throws Error if the invitation doesn't exist or the user lacks project access
 */
export async function verifyInvitationAccess(
    db: DbOrTx,
    userId: string,
    invitationId: string,
): Promise<void> {
    const invitation = await db.query.projectInvitations.findFirst({
        where: eq(projectInvitations.id, invitationId),
    });
    if (!invitation) {
        throw new Error('Unauthorized or not found');
    }
    await verifyProjectAccess(db, userId, invitation.projectId);
}

export async function verifyInvitationReadAccess(
    db: DbOrTx,
    userId: string,
    userEmail: string,
    invitationId: string,
): Promise<void> {
    const invitation = await db.query.projectInvitations.findFirst({
        where: eq(projectInvitations.id, invitationId),
    });
    if (!invitation) {
        throw new Error('Unauthorized or not found');
    }
    if (invitation.inviteeEmail.trim().toLowerCase() === userEmail.trim().toLowerCase()) {
        return;
    }
    await verifyProjectAccess(db, userId, invitation.projectId);
}

/** Create or refresh a short-lived claim for a newly created sandbox. */
export async function claimSandbox(
    db: SandboxClaimDb,
    userId: string,
    sandboxId: string,
): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SANDBOX_CLAIM_TTL_MS);
    const [claim] = await db
        .insert(sandboxClaims)
        .values({ sandboxId, userId, expiresAt })
        .onConflictDoUpdate({
            target: sandboxClaims.sandboxId,
            set: { userId, expiresAt, createdAt: now },
            setWhere: or(
                eq(sandboxClaims.userId, userId),
                lt(sandboxClaims.expiresAt, now),
            ),
        })
        .returning({ sandboxId: sandboxClaims.sandboxId });
    if (!claim) {
        throw new Error('Unauthorized or not found');
    }
}

/** Verify an active transient sandbox claim without accepting arbitrary IDs. */
export async function verifySandboxClaim(
    db: DbOrTx,
    userId: string,
    sandboxId: string,
): Promise<void> {
    const claim = await db.query.sandboxClaims.findFirst({
        where: and(
            eq(sandboxClaims.sandboxId, sandboxId),
            eq(sandboxClaims.userId, userId),
            gt(sandboxClaims.expiresAt, new Date()),
        ),
    });
    if (!claim) {
        throw new Error('Unauthorized or not found');
    }
}

/** Atomically consume a claim when its sandbox is attached to a project. */
export async function consumeSandboxClaim(
    db: SandboxClaimDb,
    userId: string,
    sandboxId: string,
): Promise<void> {
    const [claim] = await db
        .delete(sandboxClaims)
        .where(and(
            eq(sandboxClaims.sandboxId, sandboxId),
            eq(sandboxClaims.userId, userId),
            gt(sandboxClaims.expiresAt, new Date()),
        ))
        .returning({ sandboxId: sandboxClaims.sandboxId });
    if (!claim) {
        throw new Error('Unauthorized or not found');
    }
}

/** Remove a caller-owned transient claim after explicit sandbox cleanup. */
export async function releaseSandboxClaim(
    db: SandboxClaimDb,
    userId: string,
    sandboxId: string,
): Promise<void> {
    await db.delete(sandboxClaims).where(and(
        eq(sandboxClaims.sandboxId, sandboxId),
        eq(sandboxClaims.userId, userId),
    ));
}

/**
 * Verifies access through a persisted project binding or an active transient
 * claim. Unknown provider sandbox IDs are denied.
 */
export async function verifySandboxAccess(
    db: DbOrTx,
    userId: string,
    sandboxId: string,
): Promise<void> {
    const branch = await db.query.branches.findFirst({
        where: eq(branches.sandboxId, sandboxId),
    });
    if (branch) {
        await verifyProjectAccess(db, userId, branch.projectId);
        return;
    }
    const project = await db.query.projects.findFirst({
        where: eq(projects.sandboxId, sandboxId),
    });
    if (project) {
        await verifyProjectAccess(db, userId, project.id);
        return;
    }
    await verifySandboxClaim(db, userId, sandboxId);
}

/** Return persisted and actively claimed sandbox IDs visible to the user. */
export async function listAccessibleSandboxIds(
    db: DbOrTx,
    userId: string,
): Promise<Set<string>> {
    const memberships = await db.query.userProjects.findMany({
        where: eq(userProjects.userId, userId),
    });
    const projectIds = memberships.map((m) => m.projectId);
    const [projectRows, branchRows, claimRows] = await Promise.all([
        projectIds.length > 0
            ? db.query.projects.findMany({ where: inArray(projects.id, projectIds) })
            : Promise.resolve([]),
        projectIds.length > 0
            ? db.query.branches.findMany({ where: inArray(branches.projectId, projectIds) })
            : Promise.resolve([]),
        db.query.sandboxClaims.findMany({
            where: and(
                eq(sandboxClaims.userId, userId),
                gt(sandboxClaims.expiresAt, new Date()),
            ),
        }),
    ]);
    const ids = new Set<string>();
    for (const p of projectRows) {
        if (p.sandboxId) ids.add(p.sandboxId);
    }
    for (const b of branchRows) {
        if (b.sandboxId) ids.add(b.sandboxId);
    }
    for (const claim of claimRows) {
        ids.add(claim.sandboxId);
    }
    return ids;
}

/**
 * Verifies that a user has access to a deployment via its parent project.
 * @throws Error if the deployment doesn't exist or the user lacks project access
 */
export async function verifyDeploymentAccess(
    db: DbOrTx,
    userId: string,
    deploymentId: string,
): Promise<void> {
    const deployment = await db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
    });
    if (!deployment) {
        throw new Error('Unauthorized or not found');
    }
    await verifyProjectAccess(db, userId, deployment.projectId);
}

/**
 * Verifies that a user has access to a custom-domain verification via its
 * parent project.
 * @throws Error if the verification doesn't exist or the user lacks project access
 */
export async function verifyDomainVerificationAccess(
    db: DbOrTx,
    userId: string,
    verificationId: string,
): Promise<void> {
    const verification = await db.query.customDomainVerification.findFirst({
        where: eq(customDomainVerification.id, verificationId),
    });
    if (!verification) {
        throw new Error('Unauthorized or not found');
    }
    await verifyProjectAccess(db, userId, verification.projectId);
}
