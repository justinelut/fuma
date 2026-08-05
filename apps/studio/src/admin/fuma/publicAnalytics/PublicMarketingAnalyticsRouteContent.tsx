import { useMemo } from 'react'
import { PublicMarketingAnalyticsDashboard } from './PublicMarketingAnalyticsDashboard'
import { PublicMarketingAnalyticsHttpClient } from './client'

export const PUBLIC_MARKETING_ANALYTICS_ADMIN_PATH = '/admin/internal/marketing-analytics' as const

export function PublicMarketingAnalyticsRouteContent({ pathname }: Readonly<{ pathname: string }>) {
  const client = useMemo(() => new PublicMarketingAnalyticsHttpClient({
    basePath: '/api/fuma/internal/public-marketing-analytics',
  }), [])
  if (pathname !== PUBLIC_MARKETING_ANALYTICS_ADMIN_PATH) return null
  return <div data-testid="public-marketing-analytics-route"><PublicMarketingAnalyticsDashboard client={client} /></div>
}
