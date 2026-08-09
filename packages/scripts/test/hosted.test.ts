import { describe, expect, it } from 'bun:test';
import {
    getClientEnvContent,
    getDbEnvContent,
    type HostedBackendConfig,
} from '../src/backend';
import { buildEnvFileContent, parseEnvContent } from '../src/helpers';

const config: HostedBackendConfig = {
    databaseUrl: 'postgresql://postgres:postgres@postgres:5432/onlook',
    betterAuthSecret: 'a-secure-secret-with-at-least-32-characters',
    siteUrl: 'https://onlook.example.com',
    objectStorageEndpoint: 'http://minio.fuma.svc.cluster.local:9000',
    objectStorageRegion: 'us-east-1',
    objectStorageAccessKeyId: 'onlook',
    objectStorageSecretAccessKey: 'storage-secret',
    objectStorageBucket: 'onlook',
    redisUrl: 'redis://redis.fuma.svc.cluster.local:6379',
};

describe('hosted environment setup', () => {
    it('renders the complete web backend contract without legacy service keys', () => {
        const content = getClientEnvContent(config);
        const values = parseEnvContent(content);

        expect(values.get('DATABASE_URL')?.value).toBe(config.databaseUrl);
        expect(values.get('BETTER_AUTH_SECRET')?.value).toBe(config.betterAuthSecret);
        expect(values.get('OBJECT_STORAGE_ENDPOINT')?.value).toBe(config.objectStorageEndpoint);
        expect(values.get('REDIS_URL')?.value).toBe(config.redisUrl);
        expect(content.toLowerCase()).not.toContain('supabase');
    });

    it('renders a DATABASE_URL-only DB package contract', () => {
        expect(getDbEnvContent(config)).toBe(`DATABASE_URL=${config.databaseUrl}`);
    });

    it('round-trips environment values containing equals signs', () => {
        const parsed = parseEnvContent('DATABASE_URL=postgresql://host/db?sslmode=require\nTOKEN=a=b=c');
        expect(parsed.get('TOKEN')?.value).toBe('a=b=c');
        expect(parseEnvContent(buildEnvFileContent(parsed))).toEqual(parsed);
    });
});
