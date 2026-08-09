import { checkObjectStorage } from '@/lib/storage/server';
import { db } from '@onlook/db/src/client';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
    const [database, objectStorage] = await Promise.allSettled([
        db.execute(sql`SELECT 1`),
        checkObjectStorage(),
    ]);
    const healthy = database.status === 'fulfilled' && objectStorage.status === 'fulfilled';

    return Response.json(
        {
            status: healthy ? 'ok' : 'unavailable',
            checks: {
                database: database.status === 'fulfilled' ? 'ok' : 'unavailable',
                objectStorage: objectStorage.status === 'fulfilled' ? 'ok' : 'unavailable',
            },
        },
        {
            status: healthy ? 200 : 503,
            headers: { 'Cache-Control': 'no-store' },
        },
    );
}
