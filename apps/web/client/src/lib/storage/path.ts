const BUCKET_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function normalizeStorageBucket(bucket: string): string {
    const normalized = bucket.trim().toLowerCase();
    if (!BUCKET_PATTERN.test(normalized)) {
        throw new Error('Invalid storage bucket');
    }
    return normalized;
}

export function normalizeStoragePath(path: string): string {
    const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '');
    const segments = normalized.split('/');
    if (
        !normalized ||
        segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))
    ) {
        throw new Error('Invalid storage path');
    }
    return segments.join('/');
}

export function getFileUrlFromStorage(bucket: string, path: string): string {
    const safeBucket = normalizeStorageBucket(bucket);
    const safePath = normalizeStoragePath(path)
        .split('/')
        .map(encodeURIComponent)
        .join('/');
    return `/api/storage/${encodeURIComponent(safeBucket)}/${safePath}`;
}
