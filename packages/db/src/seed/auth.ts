import { auth_accounts, auth_users } from '@/schema/auth';
import { db } from '@onlook/db/src/client';
import { hashPassword } from 'better-auth/crypto';
import { SEED_USER } from './constants';

export async function seedAuthUser(): Promise<void> {
    console.log('Seeding Better Auth user...');
    const now = new Date();
    const password = await hashPassword(SEED_USER.PASSWORD);

    await db.transaction(async (tx) => {
        await tx
            .insert(auth_users)
            .values({
                id: SEED_USER.ID,
                name: SEED_USER.DISPLAY_NAME,
                email: SEED_USER.EMAIL.toLowerCase(),
                emailVerified: true,
                image: SEED_USER.AVATAR_URL,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: auth_users.id,
                set: {
                    name: SEED_USER.DISPLAY_NAME,
                    email: SEED_USER.EMAIL.toLowerCase(),
                    emailVerified: true,
                    image: SEED_USER.AVATAR_URL,
                    updatedAt: now,
                },
            });

        await tx
            .insert(auth_accounts)
            .values({
                accountId: SEED_USER.ID,
                providerId: 'credential',
                userId: SEED_USER.ID,
                password,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: [auth_accounts.providerId, auth_accounts.accountId],
                set: { password, updatedAt: now },
            });
    });

    console.log('Better Auth user seeded!');
}
