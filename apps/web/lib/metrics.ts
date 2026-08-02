import type { PublicProjectionResource } from '@fuma/public-contracts'

const RESOURCES = ['product-facts', 'pricing', 'templates', 'showcases', 'experts', 'plugins', 'components'] as const

type WebVitalMetric = Readonly<{
  name: 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB'
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  routeClass: 'home' | 'product' | 'resource' | 'discovery' | 'legal'
}>

type MetricsState = {
  projectionRequests: Record<PublicProjectionResource, number>
  projectionFailures: Record<PublicProjectionResource, number>
  webVitalLatest: Record<string, number>
  webVitalPoor: Record<string, number>
}

const METRICS_STATE = '__fumaPublicWebMetricsV2' as const

function emptyCounters(): Record<PublicProjectionResource, number> {
  return Object.fromEntries(RESOURCES.map((resource) => [resource, 0])) as Record<PublicProjectionResource, number>
}

function state(): MetricsState {
  const runtime = globalThis as typeof globalThis & { [METRICS_STATE]?: MetricsState }
  runtime[METRICS_STATE] ??= {
    projectionRequests: emptyCounters(),
    projectionFailures: emptyCounters(),
    webVitalLatest: {},
    webVitalPoor: {},
  }
  return runtime[METRICS_STATE]
}

export function recordProjectionResult(resource: PublicProjectionResource, status: number): void {
  const metrics = state()
  metrics.projectionRequests[resource] += 1
  if (status >= 500) metrics.projectionFailures[resource] += 1
}

export function recordWebVital(metric: WebVitalMetric): void {
  const metrics = state()
  const key = `${metric.name}:${metric.routeClass}`
  metrics.webVitalLatest[key] = metric.value
  if (metric.rating === 'poor') metrics.webVitalPoor[key] = (metrics.webVitalPoor[key] ?? 0) + 1
}

function label(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

export function publicWebMetrics(revision: string): string {
  const metrics = state()
  const lines = [
    '# HELP fuma_public_web_up Public Web process availability.',
    '# TYPE fuma_public_web_up gauge',
    'fuma_public_web_up 1',
    '# HELP fuma_public_web_info Public Web immutable revision information.',
    '# TYPE fuma_public_web_info gauge',
    `fuma_public_web_info{revision="${label(revision)}"} 1`,
    '# HELP fuma_public_projection_request_total Public projection requests made by Web.',
    '# TYPE fuma_public_projection_request_total counter',
    '# HELP fuma_public_projection_failure_total Public projection requests that failed closed.',
    '# TYPE fuma_public_projection_failure_total counter',
  ]
  for (const resource of RESOURCES) {
    lines.push(`fuma_public_projection_request_total{resource="${resource}"} ${metrics.projectionRequests[resource]}`)
    lines.push(`fuma_public_projection_failure_total{resource="${resource}"} ${metrics.projectionFailures[resource]}`)
  }

  lines.push('# HELP fuma_public_web_vital_latest Last accepted Web Vital value by route class.')
  lines.push('# TYPE fuma_public_web_vital_latest gauge')
  lines.push('# HELP fuma_public_web_vital_poor_total Accepted poor Web Vital observations.')
  lines.push('# TYPE fuma_public_web_vital_poor_total counter')
  for (const key of Object.keys(metrics.webVitalLatest).sort()) {
    const [name, routeClass] = key.split(':') as [string, string]
    lines.push(`fuma_public_web_vital_latest{name="${label(name)}",route_class="${label(routeClass)}"} ${metrics.webVitalLatest[key]}`)
    lines.push(`fuma_public_web_vital_poor_total{name="${label(name)}",route_class="${label(routeClass)}"} ${metrics.webVitalPoor[key] ?? 0}`)
  }
  return `${lines.join('\n')}\n`
}
