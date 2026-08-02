import type { TenantRuntimeRatification } from './contracts'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const PUBLIC_ACCESS = '0'.repeat(64)

export type TenantRuntimeFixture = Readonly<{
  name: string
  appDirectories: readonly string[]
  files: readonly Readonly<{ path: string, content: string }>[]
  ratification: unknown
  persistedRecords: readonly unknown[]
}>

export const VALID_TENANT_RUNTIME_RATIFICATION: TenantRuntimeRatification = {
  ticket: 'FUMA-SITE-001',
  application: {
    schemaVersion: 1,
    applicationPath: 'apps/site-runtime',
    deploymentModel: 'single-multi-tenant',
    router: 'next-app-router',
    serverRuntime: 'node',
    bunRole: 'benchmark-only',
    outputMode: 'standalone',
    privateContractValidation: 'typebox',
    imports: { applications: [], sharedUiPackage: false, studioAuthority: false },
    tenantState: { processGlobal: false, defaultTenant: null },
    styling: {
      ownership: 'app-local',
      tailwindVersion: '4.3.3',
      shadcnVersion: '4.14.1',
      utilities: 'static-source-only',
      persistedUtilitiesCompile: false,
      studioTailwind: false,
    },
    production: { os: 'linux', architecture: 'arm64', emulation: false },
  },
  authority: {
    hostAuthority: 'studio-exact-host-private-api',
    releaseAuthority: 'studio-active-immutable-release-private-api',
    dynamicAuthority: 'typed-bun-domain-api',
    directDatabase: false,
    directProvider: false,
    draftReads: false,
  },
  compatibility: {
    semanticHtmlCompiler: 'retained',
    staticHostedRoutes: 'retained-during-migration',
    portableExport: 'retained',
    selfHostedPublishing: 'retained',
    legacyReleaseReader: 'retained',
    stringPluginRenderer: 'bounded-legacy-only',
    emergencyRollback: 'legacy-without-data-mutation',
  },
  hostBindings: [
    {
      host: 'alpha.trimly.co.ke',
      platformId: 'platform_fuma',
      organizationId: 'organization_alpha',
      workspaceId: 'workspace_alpha',
      siteId: 'site_alpha',
      ownerKey: 'owner_alpha',
      ownerGeneration: 7,
      state: 'active',
      releaseId: 'release_alpha_17',
      releaseHashSha256: HASH_A,
    },
    {
      host: 'customer.example',
      platformId: 'platform_fuma',
      organizationId: 'organization_beta',
      workspaceId: 'workspace_beta',
      siteId: 'site_beta',
      ownerKey: 'owner_beta',
      ownerGeneration: 11,
      state: 'active',
      releaseId: 'release_beta_23',
      releaseHashSha256: HASH_B,
    },
  ],
  cacheIdentities: [
    {
      host: 'alpha.trimly.co.ke',
      platformId: 'platform_fuma',
      organizationId: 'organization_alpha',
      workspaceId: 'workspace_alpha',
      siteId: 'site_alpha',
      ownerKey: 'owner_alpha',
      ownerGeneration: 7,
      releaseId: 'release_alpha_17',
      releaseHashSha256: HASH_A,
      route: '/colliding-route',
      canonicalQuery: '',
      audience: { kind: 'public', memberId: null, accessFingerprintSha256: PUBLIC_ACCESS },
      runtimeDeploymentVersion: '1.0.0',
      componentRegistryVersion: '1.0.0',
    },
    {
      host: 'customer.example',
      platformId: 'platform_fuma',
      organizationId: 'organization_beta',
      workspaceId: 'workspace_beta',
      siteId: 'site_beta',
      ownerKey: 'owner_beta',
      ownerGeneration: 11,
      releaseId: 'release_beta_23',
      releaseHashSha256: HASH_B,
      route: '/colliding-route',
      canonicalQuery: '',
      audience: { kind: 'public', memberId: null, accessFingerprintSha256: PUBLIC_ACCESS },
      runtimeDeploymentVersion: '1.0.0',
      componentRegistryVersion: '1.0.0',
    },
  ],
  components: [{
    namespace: 'fuma.official',
    componentId: 'content.article',
    exactVersion: '1.2.0',
    execution: 'server-component',
    trustTier: 'official',
    propsSchemaHashSha256: HASH_C,
    slotsSchemaHashSha256: HASH_C,
    sourceHashSha256: HASH_C,
    capabilities: ['content.public.read'],
    dynamicTenantImport: false,
    persistedExecutableSource: false,
  }],
  cookies: [{
    host: 'customer.example',
    realm: 'site-member',
    name: '__Host-fuma_site_0123456789abcdef',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    domain: null,
    staffCookie: false,
  }],
}

export function validTenantRuntimeFixture(): TenantRuntimeFixture {
  return structuredClone({
    name: 'approved-single-site-runtime',
    appDirectories: ['apps/studio', 'apps/web', 'apps/site-runtime'],
    files: [
      {
        path: 'apps/site-runtime/package.json',
        content: JSON.stringify({
          name: '@fuma/site-runtime',
          private: true,
          dependencies: {
            '@sinclair/typebox': '0.34.49',
            next: '16.2.9',
            react: '19.2.5',
            'react-dom': '19.2.5',
          },
          devDependencies: { tailwindcss: '4.3.3', shadcn: '4.14.1' },
        }),
      },
      {
        path: 'apps/site-runtime/app/[[...route]]/page.tsx',
        content: "import { resolvePrivateRuntimeContract } from '../../lib/private-runtime-client'\nexport default async function Page() { return resolvePrivateRuntimeContract() }\n",
      },
      {
        path: 'apps/site-runtime/components/official/article.tsx',
        content: "export function Article({ title }: { title: string }) { return <article className=\"mx-auto max-w-prose\"><h1>{title}</h1></article> }\n",
      },
      {
        path: 'apps/studio/package.json',
        content: JSON.stringify({ name: '@fuma/studio', private: true, dependencies: { react: '19.2.5' } }),
      },
      {
        path: 'apps/studio/src/admin/app.tsx',
        content: "import styles from './app.module.css'\nexport function Studio() { return <main className={styles.root}>Studio</main> }\n",
      },
    ],
    ratification: VALID_TENANT_RUNTIME_RATIFICATION,
    persistedRecords: [{
      kind: 'canonical-node-tree',
      moduleId: 'fuma.official.content.article',
      componentVersion: '1.2.0',
      props: { title: 'Fixture article' },
      classes: ['article-featured'],
      children: [],
    }],
  })
}

export type TenantRuntimeHostileRule =
  | 'single-site-runtime'
  | 'app-to-app-import'
  | 'shared-ui-package'
  | 'direct-authority'
  | 'studio-tailwind'
  | 'typebox-only'
  | 'app-local-exact-tailwind'
  | 'dynamic-tenant-server-import'
  | 'release-qualified-cache'
  | 'release-bound-component'
  | 'unknown-host-fallback'
  | 'process-global-tenant'
  | 'unsafe-cookie'
  | 'persisted-jsx'
  | 'persisted-tailwind-utilities'
  | 'arbitrary-server-component'
  | 'static-export-self-host-compatibility'
  | 'node-first-runtime'
  | 'native-linux-arm64'

export type HostileTenantRuntimeFixture = Readonly<{
  ruleId: TenantRuntimeHostileRule
  fixture: TenantRuntimeFixture
}>

type MutableFixture = {
  name: string
  appDirectories: string[]
  files: Array<{ path: string, content: string }>
  ratification: TenantRuntimeRatification & Record<string, unknown>
  persistedRecords: unknown[]
}

function hostile(ruleId: TenantRuntimeHostileRule, mutate: (fixture: MutableFixture) => void): HostileTenantRuntimeFixture {
  const fixture = validTenantRuntimeFixture() as MutableFixture
  fixture.name = `hostile-${ruleId}`
  mutate(fixture)
  return { ruleId, fixture }
}

export function hostileTenantRuntimeFixtures(): readonly HostileTenantRuntimeFixture[] {
  return [
    hostile('single-site-runtime', (fixture) => { fixture.appDirectories.push('apps/site-customer-alpha') }),
    hostile('app-to-app-import', (fixture) => { fixture.files.push({ path: 'apps/site-runtime/lib/studio.ts', content: "import authority from '../../studio/server/fuma/releases/service'\nexport { authority }\n" }) }),
    hostile('shared-ui-package', (fixture) => { fixture.files.push({ path: 'apps/site-runtime/components/button.tsx', content: "export { Button } from '@fuma/shared-ui'\n" }) }),
    hostile('direct-authority', (fixture) => { fixture.files.push({ path: 'apps/site-runtime/lib/database.ts', content: "import postgres from 'postgres'\nexport const db = postgres(process.env.DATABASE_URL!)\n" }) }),
    hostile('studio-tailwind', (fixture) => { fixture.files[3]!.content = JSON.stringify({ name: '@fuma/studio', dependencies: { tailwindcss: '4.3.3' } }) }),
    hostile('typebox-only', (fixture) => { fixture.files.push({ path: 'apps/site-runtime/lib/contracts.ts', content: "import { z } from 'zod'\nexport const Host = z.string()\n" }) }),
    hostile('app-local-exact-tailwind', (fixture) => { const manifest = JSON.parse(fixture.files[0]!.content); manifest.devDependencies.tailwindcss = '^4.3.3'; fixture.files[0]!.content = JSON.stringify(manifest) }),
    hostile('dynamic-tenant-server-import', (fixture) => { fixture.files.push({ path: 'apps/site-runtime/lib/tenant-component.ts', content: 'export const load = (tenantPath: string) => import(tenantPath)\n' }) }),
    hostile('release-qualified-cache', (fixture) => { (fixture.ratification.cacheIdentities[0] as Record<string, unknown>).host = 'customer.example' }),
    hostile('release-bound-component', (fixture) => { (fixture.ratification.components[0] as Record<string, unknown>).exactVersion = '^1.2.0' }),
    hostile('unknown-host-fallback', (fixture) => { fixture.files.push({ path: 'apps/site-runtime/lib/hosts.ts', content: "export const unknownHostFallback = 'site_alpha'\n" }) }),
    hostile('process-global-tenant', (fixture) => { fixture.files.push({ path: 'apps/site-runtime/lib/current-tenant.ts', content: 'export let currentTenant: string | null = null\n' }) }),
    hostile('unsafe-cookie', (fixture) => { (fixture.ratification.cookies[0] as Record<string, unknown>).secure = false }),
    hostile('persisted-jsx', (fixture) => { fixture.persistedRecords.push({ jsx: '<TenantOwnedServerComponent />' }) }),
    hostile('persisted-tailwind-utilities', (fixture) => { fixture.persistedRecords.push({ tailwindUtilities: ['bg-red-500', 'hover:text-white'] }) }),
    hostile('arbitrary-server-component', (fixture) => { const component = fixture.ratification.components[0] as Record<string, unknown>; component.trustTier = 'reviewed-client' }),
    hostile('static-export-self-host-compatibility', (fixture) => { (fixture.ratification.compatibility as Record<string, unknown>).portableExport = 'removed' }),
    hostile('node-first-runtime', (fixture) => { (fixture.ratification.application as unknown as Record<string, unknown>).serverRuntime = 'bun' }),
    hostile('native-linux-arm64', (fixture) => { (fixture.ratification.application.production as unknown as Record<string, unknown>).architecture = 'amd64' }),
  ]
}
