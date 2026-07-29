import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'

const SiteRuntimeConfigSchema = Type.Object({
  privateHost: Type.String({ minLength: 1, maxLength: 253, pattern: '^(?:localhost|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9]))(?::[0-9]{1,5})?$' }),
  serviceToken: Type.String({ minLength: 32, maxLength: 256 }),
  redisUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
  redisNamespace: Type.String({ minLength: 1, maxLength: 63, pattern: '^[a-z0-9][a-z0-9._-]{0,62}$' }),
  supportedDeployments: Type.Array(Type.String({ pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' }), { minItems: 1, maxItems: 2, uniqueItems: true }),
}, { additionalProperties: false })
export type SiteRuntimeConfig = Static<typeof SiteRuntimeConfigSchema>

function required(env: Readonly<Record<string, unknown>>, name: string, fallback?: string): string {
  const value = env[name] ?? fallback
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required for the private site-runtime boundary.`)
  return value.trim()
}

export function readSiteRuntimeConfig(env: Readonly<Record<string, unknown>> = process.env): SiteRuntimeConfig {
  const production = env.FUMA_ENV === 'production' || env.NODE_ENV === 'production'
  const privateHost = required(env, 'FUMA_SITE_RUNTIME_PRIVATE_HOST', production ? undefined : 'localhost:3001').toLowerCase()
  const deployments = required(env, 'FUMA_SITE_RUNTIME_SUPPORTED_DEPLOYMENTS', production ? undefined : '1.0.0')
    .split(',').map((value) => value.trim()).filter(Boolean)
  const candidate = {
    privateHost,
    serviceToken: required(env, 'FUMA_SITE_RUNTIME_SERVICE_TOKEN', production ? undefined : 'local-site-runtime-service-token-0001'),
    redisUrl: required(env, 'FUMA_REDIS_URL', production ? undefined : 'redis://127.0.0.1:6379/0'),
    redisNamespace: required(env, 'FUMA_REDIS_NAMESPACE', production ? undefined : 'fuma-local'),
    supportedDeployments: deployments,
  }
  const parsed = safeParseValue(SiteRuntimeConfigSchema, candidate)
  if (!parsed.ok) throw new Error('Private site-runtime configuration is invalid.')
  const hostWithoutPort = privateHost.replace(/:[0-9]+$/, '')
  if (hostWithoutPort === 'fuma.co.ke' || hostWithoutPort.endsWith('.fuma.co.ke')) {
    throw new Error('The site-runtime authority must use a private cluster host.')
  }
  return Object.freeze(parsed.value)
}
