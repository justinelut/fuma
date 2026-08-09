import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { compare } from 'bcryptjs';

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$/;

export async function verifyCompatiblePassword(input: {
    hash: string;
    password: string;
}): Promise<boolean> {
    if (BCRYPT_HASH.test(input.hash)) {
        return await compare(input.password, input.hash);
    }
    return await verifyPassword(input);
}

export async function hashCompatiblePassword(password: string): Promise<string> {
    return await hashPassword(password);
}
