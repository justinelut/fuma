import { randomBytes } from 'node:crypto';
import prompts from 'prompts';
import { writeEnvFile } from './helpers';

export interface HostedBackendConfig {
    databaseUrl: string;
    betterAuthSecret: string;
    siteUrl: string;
    objectStorageEndpoint: string;
    objectStorageRegion: string;
    objectStorageAccessKeyId: string;
    objectStorageSecretAccessKey: string;
    objectStorageBucket: string;
    redisUrl: string;
}

const validUrl = (value: string): boolean | string => {
    try {
        new URL(value);
        return true;
    } catch {
        return 'Enter a valid URL';
    }
};

export function getClientEnvContent(config: HostedBackendConfig): string {
    return [
        `DATABASE_URL=${config.databaseUrl}`,
        `BETTER_AUTH_SECRET=${config.betterAuthSecret}`,
        `BETTER_AUTH_URL=${config.siteUrl}`,
        `NEXT_PUBLIC_SITE_URL=${config.siteUrl}`,
        `OBJECT_STORAGE_ENDPOINT=${config.objectStorageEndpoint}`,
        `OBJECT_STORAGE_REGION=${config.objectStorageRegion}`,
        `OBJECT_STORAGE_ACCESS_KEY_ID=${config.objectStorageAccessKeyId}`,
        `OBJECT_STORAGE_SECRET_ACCESS_KEY=${config.objectStorageSecretAccessKey}`,
        `OBJECT_STORAGE_BUCKET=${config.objectStorageBucket}`,
        `REDIS_URL=${config.redisUrl}`,
    ].join('\n');
}

export function getDbEnvContent(config: HostedBackendConfig): string {
    return `DATABASE_URL=${config.databaseUrl}`;
}

export async function promptAndWriteHostedConfig(
    clientEnvPath: string,
    dbEnvPath: string,
): Promise<void> {
    const generatedSecret = randomBytes(32).toString('base64url');
    const answers = await prompts([
        {
            type: 'text',
            name: 'databaseUrl',
            message: 'Hosted PostgreSQL DATABASE_URL:',
            initial: 'postgresql://postgres:postgres@127.0.0.1:5432/onlook',
            validate: validUrl,
        },
        {
            type: 'password',
            name: 'betterAuthSecret',
            message: 'Better Auth secret (32+ characters):',
            initial: generatedSecret,
            validate: (value: string) => value.length >= 32 || 'Use at least 32 characters',
        },
        {
            type: 'text',
            name: 'siteUrl',
            message: 'Application URL:',
            initial: 'http://localhost:3000',
            validate: validUrl,
        },
        {
            type: 'text',
            name: 'objectStorageEndpoint',
            message: 'S3-compatible MinIO endpoint:',
            initial: 'http://127.0.0.1:9000',
            validate: validUrl,
        },
        { type: 'text', name: 'objectStorageRegion', message: 'Object storage region:', initial: 'us-east-1' },
        { type: 'text', name: 'objectStorageAccessKeyId', message: 'MinIO access key ID:', initial: 'minioadmin' },
        { type: 'password', name: 'objectStorageSecretAccessKey', message: 'MinIO secret access key:', initial: 'minioadmin' },
        { type: 'text', name: 'objectStorageBucket', message: 'MinIO bucket:', initial: 'onlook' },
        {
            type: 'text',
            name: 'redisUrl',
            message: 'Redis URL:',
            initial: 'redis://127.0.0.1:6379',
            validate: validUrl,
        },
    ]);

    const config = answers as HostedBackendConfig;
    if (Object.values(config).some((value) => !value)) {
        throw new Error('Hosted backend configuration was cancelled or incomplete');
    }

    await writeEnvFile(clientEnvPath, getClientEnvContent(config), 'web client');
    await writeEnvFile(dbEnvPath, getDbEnvContent(config), 'db package');
}
