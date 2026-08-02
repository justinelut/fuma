import { NextResponse } from 'next/server'

/** FUMA-070 credentials use only the exact scoped /api/fuma/.../credentials route. */
export async function POST(): Promise<Response> {
  return NextResponse.json({ error: 'route-retired' }, {
    status: 410,
    headers: { 'cache-control': 'no-store' },
  })
}
