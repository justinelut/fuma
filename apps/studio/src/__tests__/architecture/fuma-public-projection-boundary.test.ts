import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../../../..')

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

type BoundarySources = Readonly<{
  contracts: string
  web: string
  route: string
  router: string
  startup: string
}>

function sources(): BoundarySources {
  return {
    contracts: read('packages/public-contracts/src/projections.ts'),
    web: read('apps/web/lib/public-projections.ts'),
    route: read('apps/web/app/api/public/v1/[resource]/route.ts'),
    router: read('apps/studio/server/router.ts'),
    startup: read('apps/studio/server/index.ts'),
  }
}

function violations(input: BoundarySources): string[] {
  const findings: string[] = []
  const privateFields = /\b(?:privateOffer|setupNegotiation|internalGrant|providerCredential|providerPayment|providerTransfer|cogs|grossMargin|paymentState|transferState|staffSession|adminSession|tenantId|organizationId)\s*:/i
  if (privateFields.test(input.contracts)) findings.push('private-field')
  if (/from ['"](?:@fuma\/studio|.*apps\/studio|.*server\/|.*repositories\/|.*auth\/)/.test(input.web)) findings.push('app-authority-import')
  if (/from ['"]zod/.test(`${input.contracts}\n${input.web}`)) findings.push('zod')
  if (/headers\s*:\s*(?:request|req)\.headers|cookie['"]?\s*:\s*(?:request|req)\.headers/i.test(input.web)) findings.push('credential-forwarding')
  if (/https?:\/\/api\.trimly\.co\.ke/.test(`${input.web}\n${input.route}`)) findings.push('public-api-host')
  if (!input.web.includes("authorization: `Bearer ${config.serviceToken}`")) findings.push('missing-service-credential')
  if (!input.web.includes("request.headers.get('if-none-match')")) findings.push('missing-etag')
  if (!input.web.includes('Value.Check(SPECS[resource].query')) findings.push('unbounded-filter')
  if (!input.web.includes('Value.Check(schema, body)')) findings.push('unvalidated-envelope')
  if (!input.router.includes('tryServePublicProjections,') || !input.startup.includes('publicProjections: publicProjectionRuntime?.boundary')) findings.push('route-not-composed')
  return findings
}

describe('FUMA-WEB-006 public projection architecture', () => {
  test('accepts the implemented strict private projection and BFF composition', () => {
    expect(violations(sources())).toEqual([])
  })

  const hostile: Array<Readonly<{ expected: string; mutate(value: BoundarySources): BoundarySources }>> = [
    { expected: 'private-field', mutate: (value) => ({ ...value, contracts: `${value.contracts}\nconst leaked = { grossMargin: 70 }` }) },
    { expected: 'app-authority-import', mutate: (value) => ({ ...value, web: `import x from '@fuma/studio/server/auth'\n${value.web}` }) },
    { expected: 'zod', mutate: (value) => ({ ...value, web: `import { z } from 'zod'\n${value.web}` }) },
    { expected: 'credential-forwarding', mutate: (value) => ({ ...value, web: `${value.web}\nfetch(url, { headers: request.headers })` }) },
    { expected: 'public-api-host', mutate: (value) => ({ ...value, route: `${value.route}\nconst bad = 'https://api.trimly.co.ke'` }) },
    { expected: 'missing-service-credential', mutate: (value) => ({ ...value, web: value.web.replace("authorization: `Bearer ${config.serviceToken}`", "accept: 'application/json'") }) },
    { expected: 'missing-etag', mutate: (value) => ({ ...value, web: value.web.replace("request.headers.get('if-none-match')", 'null') }) },
    { expected: 'unbounded-filter', mutate: (value) => ({ ...value, web: value.web.replace('Value.Check(SPECS[resource].query', 'Boolean(') }) },
    { expected: 'unvalidated-envelope', mutate: (value) => ({ ...value, web: value.web.replace('Value.Check(schema, body)', 'Boolean(body)') }) },
    { expected: 'route-not-composed', mutate: (value) => ({ ...value, router: value.router.replace('tryServePublicProjections,', '') }) },
  ]

  test.each(hostile)('rejects hostile $expected mutation', ({ expected, mutate }) => {
    expect(violations(mutate(sources()))).toContain(expected)
  })
})
