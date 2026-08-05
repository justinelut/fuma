import type { HostedResolvedSession } from '../../auth/hosted/auth'
import type { PublicMarketingAnalyticsService } from './service'

export const PUBLIC_MARKETING_ANALYTICS_REPORT_PATH = '/api/fuma/internal/public-marketing-analytics' as const

export interface PublicMarketingAnalyticsAdminBoundary {
  handles(request: Request): boolean
  handle(request: Request): Promise<Response | null>
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  })
}

export function createPublicMarketingAnalyticsAdminBoundary(input: Readonly<{
  productHost: string
  protectedOwnerEmail: string
  resolveSession: (headers: Headers) => Promise<HostedResolvedSession | null>
  service: Pick<PublicMarketingAnalyticsService, 'report'>
}>): PublicMarketingAnalyticsAdminBoundary {
  const productHost = input.productHost.toLowerCase()
  const protectedOwner = input.protectedOwnerEmail.trim().toLowerCase()
  return Object.freeze({
    handles(request: Request) {
      return new URL(request.url).pathname === PUBLIC_MARKETING_ANALYTICS_REPORT_PATH
    },
    async handle(request: Request) {
      if (!this.handles(request)) return null
      const url = new URL(request.url)
      if (url.host.toLowerCase() !== productHost || request.method !== 'GET') return json({ error: 'Not found' }, 404)
      const session = await input.resolveSession(request.headers)
      if (!session || session.impersonatedBy !== null || session.email.trim().toLowerCase() !== protectedOwner) {
        return json({ error: 'Not found' }, 404)
      }
      const keys = [...url.searchParams.keys()]
      if (keys.some((key) => key !== 'from' && key !== 'to')
        || url.searchParams.getAll('from').length !== 1 || url.searchParams.getAll('to').length !== 1) {
        return json({ error: 'Invalid range' }, 400)
      }
      try {
        return json(await input.service.report({ from: url.searchParams.get('from'), to: url.searchParams.get('to') }), 200)
      } catch {
        return json({ error: 'Marketing analytics are temporarily unavailable.' }, 503)
      }
    },
  })
}
