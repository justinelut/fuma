import { auth } from '@/lib/auth/server';
import { getObject } from '@/lib/storage/server';
import { userProjects } from '@onlook/db';
import { db } from '@onlook/db/src/client';
import { STORAGE_BUCKETS } from '@onlook/constants';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    context: { params: Promise<{ bucket: string; path: string[] }> },
) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { bucket, path: segments } = await context.params;
    if (bucket !== STORAGE_BUCKETS.PREVIEW_IMAGES || segments.length < 3 || segments[0] !== 'public') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const projectId = segments[1];
    if (!projectId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const membership = await db.query.userProjects.findFirst({
        where: and(eq(userProjects.userId, session.user.id), eq(userProjects.projectId, projectId)),
        columns: { projectId: true },
    });
    if (!membership) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    try {
        const object = await getObject(bucket, segments.join('/'));
        return new Response(Buffer.from(object.bytes), {
            headers: {
                'Content-Type': object.contentType,
                'Cache-Control': 'private, max-age=300',
                ...(object.etag ? { ETag: object.etag } : {}),
                ...(object.lastModified ? { 'Last-Modified': object.lastModified.toUTCString() } : {}),
            },
        });
    } catch (error) {
        console.error('Object storage read failed', error);
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
}
