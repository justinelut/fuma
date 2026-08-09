import 'server-only';

import { env } from '@/env';
import {
    CreateBucketCommand,
    GetObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { normalizeStorageBucket, normalizeStoragePath } from './path';

let client: S3Client | undefined;
let bucketReady: Promise<void> | undefined;

function getStatusCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null || !('$metadata' in error)) {
        return undefined;
    }
    const metadata = error.$metadata;
    if (typeof metadata !== 'object' || metadata === null || !('httpStatusCode' in metadata)) {
        return undefined;
    }
    return typeof metadata.httpStatusCode === 'number' ? metadata.httpStatusCode : undefined;
}

function getClient(): S3Client {
    if (client) {
        return client;
    }
    if (
        !env.OBJECT_STORAGE_ENDPOINT ||
        !env.OBJECT_STORAGE_ACCESS_KEY_ID ||
        !env.OBJECT_STORAGE_SECRET_ACCESS_KEY
    ) {
        throw new Error('Object storage is not configured');
    }
    client = new S3Client({
        endpoint: env.OBJECT_STORAGE_ENDPOINT,
        region: env.OBJECT_STORAGE_REGION,
        forcePathStyle: true,
        credentials: {
            accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
            secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
        },
    });
    return client;
}

async function ensureBucket(): Promise<void> {
    if (!bucketReady) {
        bucketReady = (async () => {
            const storage = getClient();
            try {
                await storage.send(new HeadBucketCommand({ Bucket: env.OBJECT_STORAGE_BUCKET }));
            } catch (error) {
                if (getStatusCode(error) !== 404) {
                    throw error;
                }
                await storage.send(new CreateBucketCommand({ Bucket: env.OBJECT_STORAGE_BUCKET }));
            }
        })();
    }
    try {
        await bucketReady;
    } catch (error) {
        bucketReady = undefined;
        throw error;
    }
}

export async function checkObjectStorage(): Promise<void> {
    await ensureBucket();
}

function objectKey(bucket: string, path: string): string {
    return `${normalizeStorageBucket(bucket)}/${normalizeStoragePath(path)}`;
}

export async function putObject(input: {
    bucket: string;
    path: string;
    body: Uint8Array;
    contentType: string;
}): Promise<{ path: string }> {
    const path = normalizeStoragePath(input.path);
    await ensureBucket();
    await getClient().send(new PutObjectCommand({
        Bucket: env.OBJECT_STORAGE_BUCKET,
        Key: objectKey(input.bucket, path),
        Body: input.body,
        ContentType: input.contentType,
        IfNoneMatch: '*',
    }));
    return { path };
}

export async function getObject(bucket: string, path: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
    etag?: string;
    lastModified?: Date;
}> {
    await ensureBucket();
    const result = await getClient().send(new GetObjectCommand({
        Bucket: env.OBJECT_STORAGE_BUCKET,
        Key: objectKey(bucket, path),
    }));
    if (!result.Body) {
        throw new Error('Object storage returned an empty body');
    }
    return {
        bytes: await result.Body.transformToByteArray(),
        contentType: result.ContentType ?? 'application/octet-stream',
        etag: result.ETag,
        lastModified: result.LastModified,
    };
}
