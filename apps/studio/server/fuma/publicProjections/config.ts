import { readFumaDeploymentProfile } from '@fuma/brand'
import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'

const PrivateProjectionConfigSchema = Type.Object({
  host: Type.String({
    minLength: 1,
    maxLength: 253,
    pattern: '^(?:localhost|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9]))(?::[0-9]{1,5})?$',
  }),
  serviceToken: Type.String({ minLength: 32, maxLength: 256 }),
  redisUrl: Type.String({ minLength: 1, maxLength: 2_048 }),
  redisNamespace: Type.String({ minLength: 1, maxLength: 63, pattern: '^[a-z0-9][a-z0-9._-]{0,62}$' }),
}, { additionalProperties: false })

export type PrivateProjectionConfig = Static<typeof PrivateProjectionConfigSchema>

type Env = Readonly<Record<string, unknown>>

function value(env: Env, name: string, fallback?: string): string {
  const candidate = env[name] ?? fallback
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new Error(`${name} is required for the private public-projection boundary.`)
  }
  return candidate.trim()
}

export function readPrivateProjectionConfig(env: Env = process.env): PrivateProjectionConfig {
  const production = env.FUMA_ENV === 'production' || env.NODE_ENV === 'production'
  const host = value(env, 'FUMA_PUBLIC_PROJECTION_INTERNAL_HOST', production ? undefined : 'localhost:3001').toLowerCase()
  const candidate = {
    host,
    serviceToken: value(env, 'FUMA_PUBLIC_PROJECTION_SERVICE_TOKEN', production ? undefined : 'local-public-projection-token-00000001'),
    redisUrl: value(env, 'FUMA_REDIS_URL', production ? undefined : 'redis://127.0.0.1:6379/0'),
    redisNamespace: value(env, 'FUMA_REDIS_NAMESPACE', production ? undefined : 'fuma-local'),
  }
  const parsed = safeParseValue(PrivateProjectionConfigSchema, candidate)
  if (!parsed.ok) throw new Error('Private public-projection configuration is invalid.')
  const deployment = readFumaDeploymentProfile(env, { required: production })
  if (host === deployment.hosts.public
    || host === deployment.hosts.redirect
    || host.endsWith(deployment.tenantSuffix)) {
    throw new Error('The public projection endpoint must use a private cluster host.')
  }
  return Object.freeze(parsed.value)
}
