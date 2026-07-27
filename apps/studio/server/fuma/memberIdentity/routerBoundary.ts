import { jsonResponse } from '../../http'
import type { MemberAuthBoundary } from './boundary'
import type { MemberImportBoundary } from './importBoundary'

export interface MemberRouterRuntime {
  memberAuth?: MemberAuthBoundary
  memberImports?: MemberImportBoundary
}

export async function tryServeMemberAuth(
  req: Request,
  runtime: MemberRouterRuntime,
  _url: URL,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== '/_fuma/member-auth' && !pathname.startsWith('/_fuma/member-auth/')) return null
  try {
    if (!runtime.memberAuth?.handles(req)) return jsonResponse({ error: 'Not found.' }, { status: 404, headers: { 'cache-control': 'no-store' } })
    return await runtime.memberAuth.handle(req) ?? jsonResponse({ error: 'Not found.' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[fuma-member-auth] boundary failed:', error)
    return jsonResponse({ error: 'Authentication request failed.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}

export async function tryServeMemberImports(
  req: Request,
  runtime: MemberRouterRuntime,
): Promise<Response | null> {
  if (!runtime.memberImports?.handles(req)) return null
  try {
    return await runtime.memberImports.handle(req)
      ?? jsonResponse({ error: 'Resource not found.' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[fuma-member-import] boundary failed:', error)
    return jsonResponse({ error: 'Member import failed.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
