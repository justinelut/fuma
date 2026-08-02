import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const files = [
  'server/fuma/publicAnalytics/service.ts',
  'server/fuma/publicAnalytics/boundary.ts',
  'server/fuma/publicAnalytics/postgres.ts',
  'src/core/fuma/publicAnalytics/contracts.ts',
].map((path) => [path, readFileSync(resolve(root, path), 'utf8')] as const)

test('FUMA-WEB-016 remains first-party, aggregate-only, and separate from tenant/member analytics', () => {
  const combined = files.map(([, text]) => text).join('\n')
  for (const forbidden of [
    'document.cookie', 'localStorage', 'fingerprint', 'deviceId', 'visitorId',
    'google-analytics', 'googletagmanager', 'segment.com', 'mixpanel', 'posthog',
    'PublicationPrivacyAnalyticsService', 'memberIdentity', 'tenantId:', 'paymentReference:',
  ]) expect(combined).not.toContain(forbidden)
  expect(combined).not.toMatch(/fetch\(['"]https?:\/\//)
  expect(combined).toContain("request.headers.get('x-fuma-audience') === 'fuma-public-web'")
  expect(combined).toContain("collectionBasis: event.kind === 'page_view' ? 'cookieless-baseline' : 'explicit-consent'")
  expect(combined).toContain('correlationSha256')
})
