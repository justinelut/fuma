import { hashSessionToken } from '@/lib/auth/token-hash';
import { auth_verifications, users, type DrizzleDb } from '@onlook/db';
import {
    createInstallationOctokit,
    generateInstallationUrl
} from '@onlook/github';
import { TRPCError } from '@trpc/server';
import { and, eq, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc';

const getUserGitHubInstallation = async (db: DrizzleDb, userId: string) => {
    const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { githubInstallationId: true }
    });

    if (!user?.githubInstallationId) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'GitHub App installation required',
        });
    }
    return {
        octokit: createInstallationOctokit(user.githubInstallationId),
        installationId: user.githubInstallationId
    };
};

export const githubRouter = createTRPCRouter({
    validate: protectedProcedure
        .input(
            z.object({
                owner: z.string(),
                repo: z.string()
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const { octokit } = await getUserGitHubInstallation(ctx.db, ctx.user.id);
            const { data } = await octokit.rest.repos.get({ owner: input.owner, repo: input.repo });
            return {
                branch: data.default_branch,
                isPrivateRepo: data.private
            };
        }),
    getRepo: protectedProcedure
        .input(
            z.object({
                owner: z.string(),
                repo: z.string()
            }),
        )
        .query(async ({ input, ctx }) => {
            const { octokit } = await getUserGitHubInstallation(ctx.db, ctx.user.id);
            const { data } = await octokit.rest.repos.get({
                owner: input.owner,
                repo: input.repo
            });
            return data;
        }),

    getOrganizations: protectedProcedure
        .query(async ({ ctx }) => {
            try {
                const { octokit, installationId } = await getUserGitHubInstallation(ctx.db, ctx.user.id);

                // Get installation details to determine account type
                const installation = await octokit.rest.apps.getInstallation({
                    installation_id: parseInt(installationId, 10),
                });

                // If installed on an organization, return that organization
                if (installation.data.account && 'type' in installation.data.account && installation.data.account.type === 'Organization') {
                    return [{
                        id: installation.data.account.id,
                        login: 'login' in installation.data.account ? installation.data.account.login : (installation.data.account as any).name || '',
                        avatar_url: installation.data.account.avatar_url,
                        description: undefined, // Organizations don't have descriptions in this context
                    }];
                }

                // If installed on a user account, return empty (no organizations)
                return [];
            } catch (error) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: 'GitHub App installation is invalid or has been revoked',
                    cause: error
                });
            }
        }),
    getRepoFiles: protectedProcedure
        .input(
            z.object({
                owner: z.string(),
                repo: z.string(),
                path: z.string().default(''),
                ref: z.string().optional() // branch, tag, or commit SHA
            })
        )
        .query(async ({ input, ctx }) => {
            const { octokit } = await getUserGitHubInstallation(ctx.db, ctx.user.id);
            const { data } = await octokit.rest.repos.getContent({
                owner: input.owner,
                repo: input.repo,
                path: input.path,
                ...(input.ref && { ref: input.ref })
            });
            return data;
        }),
    generateInstallationUrl: protectedProcedure
        .mutation(async ({ ctx }) => {
            const state = randomUUID();
            const identifier = `github-install:${ctx.user.id}`;
            const value = await hashSessionToken(state);
            await ctx.db.transaction(async (tx) => {
                await tx.delete(auth_verifications).where(eq(auth_verifications.identifier, identifier));
                await tx.insert(auth_verifications).values({
                    identifier,
                    value,
                    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                });
            });

            const { url } = generateInstallationUrl({ state });
            return { url };
        }),

    checkGitHubAppInstallation: protectedProcedure
        .query(async ({ ctx }): Promise<string | null> => {
            try {
                const { octokit, installationId } = await getUserGitHubInstallation(ctx.db, ctx.user.id);
                await octokit.rest.apps.getInstallation({
                    installation_id: parseInt(installationId, 10),
                });
                return installationId;
            } catch (error) {
                console.error('Error checking GitHub App installation:', error);
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: error instanceof Error ? error.message : 'GitHub App installation is invalid or has been revoked',
                    cause: error
                });
            }
        }),

    // Repository fetching using GitHub App installation (required)
    getRepositoriesWithApp: protectedProcedure
        .input(
            z.object({
                username: z.string().optional(),
            }).optional()
        )
        .query(async ({ ctx }) => {
            try {
                const { octokit, installationId } = await getUserGitHubInstallation(ctx.db, ctx.user.id);

                const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
                    installation_id: parseInt(installationId, 10),
                    per_page: 100,
                    page: 1,
                });

                // Transform to match reference implementation pattern
                return data.repositories.map(repo => ({
                    id: repo.id,
                    name: repo.name,
                    full_name: repo.full_name,
                    description: repo.description,
                    private: repo.private,
                    default_branch: repo.default_branch,
                    clone_url: repo.clone_url,
                    html_url: repo.html_url,
                    updated_at: repo.updated_at,
                    owner: {
                        login: repo.owner.login,
                        avatar_url: repo.owner.avatar_url,
                    },
                }));
            } catch (error) {
                throw new TRPCError({
                    code: 'FORBIDDEN',
                    message: 'GitHub App installation is invalid or has been revoked. Please reinstall the GitHub App.',
                    cause: error
                });
            }
        }),
    handleInstallationCallbackUrl: protectedProcedure
        .input(
            z.object({
                installationId: z.string().regex(/^\d+$/),
                setupAction: z.enum(['install', 'update']),
                state: z.string().uuid(),
            })
        )
        .mutation(async ({ input, ctx }) => {
            const identifier = `github-install:${ctx.user.id}`;
            const value = await hashSessionToken(input.state);

            try {
                const result = await ctx.db.transaction(async (tx) => {
                    const [consumedState] = await tx
                        .delete(auth_verifications)
                        .where(and(
                            eq(auth_verifications.identifier, identifier),
                            eq(auth_verifications.value, value),
                            gt(auth_verifications.expiresAt, new Date()),
                        ))
                        .returning({ id: auth_verifications.id });
                    if (!consumedState) {
                        throw new TRPCError({
                            code: 'BAD_REQUEST',
                            message: 'Invalid or expired state parameter',
                        });
                    }

                    const [updatedUser] = await tx
                        .update(users)
                        .set({ githubInstallationId: input.installationId })
                        .where(eq(users.id, ctx.user.id))
                        .returning({ id: users.id });
                    if (!updatedUser) {
                        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
                    }
                    return updatedUser;
                });

                return {
                    success: true,
                    message: 'GitHub App installation completed successfully',
                    installationId: input.installationId,
                    userId: result.id,
                };
            } catch (error) {
                if (error instanceof TRPCError) throw error;
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to update GitHub installation',
                    cause: error,
                });
            }
        }),

});