import { describe, expect, test } from 'bun:test'
import { publicWebMetrics, recordProjectionResult, recordWebVital } from '../lib/metrics'

describe('public Web metrics', () => {
  test('exports projection and bounded Web Vital observations', () => {
    recordProjectionResult('pricing', 503)
    recordProjectionResult('templates', 200)
    recordWebVital({ name: 'LCP', value: 2200, rating: 'poor', routeClass: 'home' })

    const metrics = publicWebMetrics('release_1"\nunsafe')
    expect(metrics).toContain('fuma_public_projection_request_total{resource="pricing"}')
    expect(metrics).toContain('fuma_public_projection_failure_total{resource="pricing"}')
    expect(metrics).toContain('fuma_public_web_vital_latest{name="LCP",route_class="home"} 2200')
    expect(metrics).toContain('fuma_public_web_vital_poor_total{name="LCP",route_class="home"} 1')
    expect(metrics).toContain('revision="release_1\\"\\nunsafe"')
  })
})
