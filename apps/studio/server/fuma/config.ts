import { FUMA_PUBLIC_IDENTITY } from '@fuma/brand'
import {
  Type,
  safeParseValue,
  type Static,
  type TSchema,
} from '@core/utils/typeboxHelpers'

const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EnvironmentSchema = Type.Union([
  Type.Literal('local'),
  Type.Literal('production'),
])

const RoleSchema = Type.Union([
  Type.Literal('web'),
  Type.Literal('worker'),
  Type.Literal('scheduler'),
])

const HostSchema = Type.String({ minLength: 1, maxLength: 253, pattern: HOST_PATTERN.source })
const RequiredStringSchema = Type.String({ minLength: 1, pattern: '\\S' })
const EmailSchema = Type.String({ minLength: 1, pattern: EMAIL_PATTERN.source })

export const FumaProductMetadataSchema = Type.Object({
  product: Type.Object({
    name: Type.Literal(FUMA_PUBLIC_IDENTITY.product.name),
    host: Type.Literal(FUMA_PUBLIC_IDENTITY.product.host),
  }, { additionalProperties: false }),
  marketing: Type.Object({
    host: Type.Literal(FUMA_PUBLIC_IDENTITY.marketing.host),
    status: Type.Literal(FUMA_PUBLIC_IDENTITY.marketing.status),
  }, { additionalProperties: false }),
  launchDefaults: Type.Object({
    locale: Type.Literal(FUMA_PUBLIC_IDENTITY.launchDefaults.locale),
    currency: Type.Literal(FUMA_PUBLIC_IDENTITY.launchDefaults.currency),
    timeZone: Type.Literal(FUMA_PUBLIC_IDENTITY.launchDefaults.timeZone),
  }, { additionalProperties: false }),
}, { additionalProperties: false })

export type FumaProductMetadata = Static<typeof FumaProductMetadataSchema>

export const FUMA_PRODUCT_METADATA: FumaProductMetadata = FUMA_PUBLIC_IDENTITY

const PlatformPaystackCredentialsSchema = Type.Object({
  scope: Type.Literal('platform_billing'),
  publicKey: RequiredStringSchema,
  secretKey: RequiredStringSchema,
}, { additionalProperties: false })

const CustomerPaystackCredentialsSchema = Type.Object({
  scope: Type.Literal('customer_merchant'),
  publicKey: RequiredStringSchema,
  secretKey: RequiredStringSchema,
}, { additionalProperties: false })

const StaffCookieSchema = Type.Object({
  name: RequiredStringSchema,
  secure: Type.Boolean(),
  httpOnly: Type.Literal(true),
  sameSite: Type.Literal('lax'),
  path: Type.Literal('/'),
  // Host-only is represented by the absence of Domain, never by a boolean claim.
  domain: Type.Optional(Type.Never()),
}, { additionalProperties: false })

export const FumaConfigSchema = Type.Object({
  environment: EnvironmentSchema,
  role: RoleSchema,
  hosts: Type.Object({
    product: HostSchema,
    marketing: HostSchema,
    marketingStatus: Type.Literal('deferred'),
  }, { additionalProperties: false }),
  database: Type.Object({
    url: RequiredStringSchema,
    engine: Type.Literal('postgresql'),
  }, { additionalProperties: false }),
  redis: Type.Object({
    url: RequiredStringSchema,
  }, { additionalProperties: false }),
  minio: Type.Object({
    endpoint: RequiredStringSchema,
    accessKeyId: RequiredStringSchema,
    secretAccessKey: RequiredStringSchema,
    bucket: RequiredStringSchema,
  }, { additionalProperties: false }),
  ociEmail: Type.Object({
    region: RequiredStringSchema,
    tenancyId: RequiredStringSchema,
    userId: RequiredStringSchema,
    fingerprint: RequiredStringSchema,
    privateKeyPem: RequiredStringSchema,
    compartmentId: RequiredStringSchema,
    approvedSender: EmailSchema,
    eventVerificationSecret: Type.String({ minLength: 32 }),
  }, { additionalProperties: false }),
  publication: Type.Object({
    unsubscribeSigningSecret: Type.String({ minLength: 32 }),
  }, { additionalProperties: false }),
  paystack: Type.Object({
    providerBaseUrl: RequiredStringSchema,
    platformBilling: PlatformPaystackCredentialsSchema,
    customerMerchant: CustomerPaystackCredentialsSchema,
  }, { additionalProperties: false }),
  cloudflare: Type.Object({
    owner: Type.Literal('fuma'),
    accountId: RequiredStringSchema,
    zoneId: RequiredStringSchema,
    apiToken: RequiredStringSchema,
  }, { additionalProperties: false }),
  locale: Type.Object({
    locale: Type.Literal('en-KE'),
    currency: Type.Literal('KES'),
    timeZone: Type.Literal('Africa/Nairobi'),
  }, { additionalProperties: false }),
  protectedOwner: Type.Object({
    email: EmailSchema,
  }, { additionalProperties: false }),
  staffCookie: StaffCookieSchema,
}, { additionalProperties: false })

export type FumaConfig = Static<typeof FumaConfigSchema>

export const FumaConfigSummarySchema = Type.Object({
  environment: EnvironmentSchema,
  role: RoleSchema,
  productHost: HostSchema,
  marketing: Type.Literal('deferred'),
  database: Type.Literal('postgresql'),
  coordination: Type.Literal('redis'),
  objectStorage: Type.Literal('minio'),
  emailDelivery: Type.Literal('oci-email-delivery'),
  paymentScopes: Type.Tuple([
    Type.Literal('platform_billing'),
    Type.Literal('customer_merchant'),
  ]),
  edgeOwner: Type.Literal('fuma'),
  locale: Type.Literal('en-KE'),
  currency: Type.Literal('KES'),
  timeZone: Type.Literal('Africa/Nairobi'),
  protectedOwnerConfigured: Type.Literal(true),
  secureStaffCookie: Type.Boolean(),
  staffCookieDomain: Type.Literal('omitted'),
  staffCookiePath: Type.Literal('/'),
}, { additionalProperties: false })

export type FumaConfigSummary = Static<typeof FumaConfigSummarySchema>

type Env = Readonly<Record<string, unknown>>
type RequiredClass = Readonly<{
  name: string
  variables: readonly string[]
}>

const PRODUCTION_REQUIRED_CLASSES: readonly RequiredClass[] = [
  { name: 'reserved hosts', variables: ['FUMA_PRODUCT_HOST', 'FUMA_MARKETING_HOST'] },
  { name: 'runtime role', variables: ['FUMA_ROLE'] },
  { name: 'PostgreSQL', variables: ['DATABASE_URL'] },
  { name: 'Redis', variables: ['FUMA_REDIS_URL'] },
  { name: 'MinIO', variables: ['FUMA_MINIO_ENDPOINT', 'FUMA_MINIO_ACCESS_KEY_ID', 'FUMA_MINIO_SECRET_ACCESS_KEY', 'FUMA_MINIO_BUCKET'] },
  { name: 'OCI Email Delivery', variables: ['FUMA_OCI_EMAIL_REGION', 'FUMA_OCI_EMAIL_TENANCY_ID', 'FUMA_OCI_EMAIL_USER_ID', 'FUMA_OCI_EMAIL_FINGERPRINT', 'FUMA_OCI_EMAIL_PRIVATE_KEY_PEM', 'FUMA_OCI_EMAIL_COMPARTMENT_ID', 'FUMA_OCI_EMAIL_APPROVED_SENDER', 'FUMA_OCI_EVENT_VERIFICATION_SECRET'] },
  { name: 'Publication unsubscribe signing', variables: ['FUMA_PUBLICATION_UNSUBSCRIBE_SIGNING_SECRET'] },
  { name: 'Paystack provider', variables: ['FUMA_PAYSTACK_PROVIDER_URL'] },
  { name: 'Paystack platform billing', variables: ['FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY', 'FUMA_PAYSTACK_PLATFORM_SECRET_KEY'] },
  { name: 'Paystack customer merchant', variables: ['FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY', 'FUMA_PAYSTACK_CUSTOMER_SECRET_KEY'] },
  { name: 'Fuma-owned Cloudflare', variables: ['FUMA_CLOUDFLARE_ACCOUNT_ID', 'FUMA_CLOUDFLARE_ZONE_ID', 'FUMA_CLOUDFLARE_API_TOKEN'] },
  { name: 'Kenya locale', variables: ['FUMA_LOCALE', 'FUMA_CURRENCY', 'FUMA_TIME_ZONE'] },
  { name: 'protected owner', variables: ['FUMA_PROTECTED_OWNER_EMAIL'] },
  { name: 'staff cookie policy', variables: ['FUMA_COOKIE_SECURE', 'FUMA_COOKIE_HTTP_ONLY', 'FUMA_COOKIE_SAME_SITE'] },
]

const LOCAL_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  FUMA_ROLE: 'web',
  FUMA_PRODUCT_HOST: 'app.localhost',
  FUMA_MARKETING_HOST: 'marketing.localhost',
  DATABASE_URL: 'postgres://fuma_local:fake-local-password@127.0.0.1:5432/fuma_local',
  FUMA_REDIS_URL: 'redis://127.0.0.1:6379/0',
  FUMA_MINIO_ENDPOINT: 'http://127.0.0.1:9000',
  FUMA_MINIO_ACCESS_KEY_ID: 'fake-local-minio-access',
  FUMA_MINIO_SECRET_ACCESS_KEY: 'fake-local-minio-secret',
  FUMA_MINIO_BUCKET: 'fuma-local',
  FUMA_OCI_EMAIL_REGION: 'fake-local-region',
  FUMA_OCI_EMAIL_TENANCY_ID: 'fake-local-tenancy',
  FUMA_OCI_EMAIL_USER_ID: 'fake-local-user',
  FUMA_OCI_EMAIL_FINGERPRINT: 'fake-local-fingerprint',
  FUMA_OCI_EMAIL_PRIVATE_KEY_PEM: 'fake-local-private-key',
  FUMA_OCI_EMAIL_COMPARTMENT_ID: 'ocid1.compartment.oc1..fake-local-compartment',
  FUMA_OCI_EMAIL_APPROVED_SENDER: 'fuma@localhost.invalid',
  FUMA_OCI_EVENT_VERIFICATION_SECRET: 'fake-local-event-verification-secret-000000000000',
  FUMA_PUBLICATION_UNSUBSCRIBE_SIGNING_SECRET: 'fake-local-unsubscribe-signing-secret-0000000000',
  FUMA_PAYSTACK_PROVIDER_URL: 'https://paystack.test',
  FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY: 'fake-local-platform-public',
  FUMA_PAYSTACK_PLATFORM_SECRET_KEY: 'fake-local-platform-secret',
  FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY: 'fake-local-customer-public',
  FUMA_PAYSTACK_CUSTOMER_SECRET_KEY: 'fake-local-customer-secret',
  FUMA_CLOUDFLARE_ACCOUNT_ID: 'fake-local-cloudflare-account',
  FUMA_CLOUDFLARE_ZONE_ID: 'fake-local-cloudflare-zone',
  FUMA_CLOUDFLARE_API_TOKEN: 'fake-local-cloudflare-token',
  FUMA_LOCALE: 'en-KE',
  FUMA_CURRENCY: 'KES',
  FUMA_TIME_ZONE: 'Africa/Nairobi',
  FUMA_PROTECTED_OWNER_EMAIL: 'owner@localhost.invalid',
  FUMA_COOKIE_SECURE: 'false',
  FUMA_COOKIE_HTTP_ONLY: 'true',
  FUMA_COOKIE_SAME_SITE: 'lax',
})

export class FumaConfigurationError extends Error {
  readonly path: string

  constructor(message: string, path: string) {
    super(message)
    this.name = 'FumaConfigurationError'
    this.path = path
  }
}

function invalidConfiguration(path: string): FumaConfigurationError {
  return new FumaConfigurationError(`Fuma configuration is invalid at ${path}.`, path)
}

function validateValue<T extends TSchema>(schema: T, value: unknown, path: string): Static<T> {
  const result = safeParseValue(schema, value)
  if (!result.ok) throw invalidConfiguration(path)
  return result.value
}

function optionalString(env: Env, name: string): string | undefined {
  const value = env[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalidConfiguration(name)
  return value.trim()
}

function requiredValue(env: Env, name: string): string {
  const value = optionalString(env, name)
  if (!value) throw invalidConfiguration(name)
  return value
}

function enumValue<T extends string>(value: string, allowed: readonly T[], path: string): T {
  const match = allowed.find((entry) => entry === value)
  if (!match) throw invalidConfiguration(path)
  return match
}

function booleanValue(value: string, path: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw invalidConfiguration(path)
}

function trueValue(value: string, path: string): true {
  if (value === 'true') return true
  throw invalidConfiguration(path)
}

function readEnvironment(env: Env): Static<typeof EnvironmentSchema> {
  const fumaEnvironment = optionalString(env, 'FUMA_ENV')
  const nodeEnvironment = optionalString(env, 'NODE_ENV')

  if (nodeEnvironment === 'production' && fumaEnvironment !== 'production') {
    throw new FumaConfigurationError(
      'Fuma production mode requires explicit FUMA_ENV=production.',
      'FUMA_ENV',
    )
  }
  if (fumaEnvironment === 'production' && nodeEnvironment !== 'production') {
    throw new FumaConfigurationError(
      'Fuma production mode requires explicit NODE_ENV=production.',
      'NODE_ENV',
    )
  }

  if (fumaEnvironment === undefined) return 'local'
  return enumValue(fumaEnvironment, ['local', 'production'], 'FUMA_ENV')
}

function requireProductionClasses(env: Env): void {
  for (const requiredClass of PRODUCTION_REQUIRED_CLASSES) {
    const missing = requiredClass.variables.filter((name) => {
      const value = env[name]
      return typeof value !== 'string' || value.trim().length === 0
    })
    if (missing.length > 0) {
      throw new FumaConfigurationError(
        `Fuma production configuration is missing the ${requiredClass.name} class (${missing.join(', ')}).`,
        missing[0]!,
      )
    }
  }
}

function rejectCookieDomainConfiguration(env: Env): void {
  for (const name of ['FUMA_COOKIE_DOMAIN', 'FUMA_COOKIE_HOST_ONLY']) {
    if (env[name] !== undefined) {
      throw new FumaConfigurationError(
        'Fuma staff cookies are host-only because the Domain attribute is omitted.',
        name,
      )
    }
  }
}

type ProviderUrlPolicy = Readonly<{
  protocols: readonly string[]
  requirePath?: boolean
  originOnly?: boolean
}>

function assertProviderUrl(value: string, policy: ProviderUrlPolicy, path: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidConfiguration(path)
  }

  if (!policy.protocols.includes(url.protocol) || !url.hostname || url.hash) {
    throw invalidConfiguration(path)
  }
  if (policy.requirePath && (url.pathname === '' || url.pathname === '/')) {
    throw invalidConfiguration(path)
  }
  if (policy.originOnly && (
    url.username
    || url.password
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search
  )) {
    throw invalidConfiguration(path)
  }
}

function assertPaystackScopesDoNotOverlap(config: FumaConfig): void {
  const platformCredentials = new Set([
    config.paystack.platformBilling.publicKey,
    config.paystack.platformBilling.secretKey,
  ])
  const customerCredentials = [
    ['FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY', config.paystack.customerMerchant.publicKey],
    ['FUMA_PAYSTACK_CUSTOMER_SECRET_KEY', config.paystack.customerMerchant.secretKey],
  ] as const

  for (const [path, credential] of customerCredentials) {
    if (platformCredentials.has(credential)) {
      throw new FumaConfigurationError(
        'Fuma Paystack platform billing and customer merchant credential scopes must not overlap.',
        path,
      )
    }
  }
}

function assertConfigInvariants(config: FumaConfig): void {
  assertProviderUrl(config.database.url, {
    protocols: ['postgres:', 'postgresql:'],
    requirePath: true,
  }, 'DATABASE_URL')
  assertProviderUrl(config.redis.url, {
    protocols: ['redis:', 'rediss:'],
  }, 'FUMA_REDIS_URL')
  assertProviderUrl(config.paystack.providerBaseUrl, {
    protocols: ['https:'],
    originOnly: true,
  }, 'FUMA_PAYSTACK_PROVIDER_URL')
  assertProviderUrl(config.minio.endpoint, {
    protocols: ['http:', 'https:'],
    originOnly: true,
  }, 'FUMA_MINIO_ENDPOINT')

  if (config.hosts.product === config.hosts.marketing) {
    throw new FumaConfigurationError('Fuma product and marketing hosts must be distinct.', 'FUMA_PRODUCT_HOST')
  }

  const reservedHosts = new Set<string>([
    FUMA_PRODUCT_METADATA.product.host,
    FUMA_PRODUCT_METADATA.marketing.host,
  ])
  if (config.environment === 'local'
    && (reservedHosts.has(config.hosts.product) || reservedHosts.has(config.hosts.marketing))) {
    throw new FumaConfigurationError(
      'Fuma production reserved hosts cannot run with local configuration.',
      'FUMA_ENV',
    )
  }

  if (config.environment === 'production') {
    if (config.hosts.product !== FUMA_PRODUCT_METADATA.product.host
      || config.hosts.marketing !== FUMA_PRODUCT_METADATA.marketing.host) {
      throw new FumaConfigurationError(
        'Fuma production reserved hosts must match the product metadata.',
        'FUMA_PRODUCT_HOST',
      )
    }
    if (!config.staffCookie.secure
      || !config.staffCookie.httpOnly
      || config.staffCookie.sameSite !== 'lax'
      || config.staffCookie.path !== '/') {
      throw new FumaConfigurationError(
        'Fuma production staff cookies must be Secure, HttpOnly, host-only, SameSite=Lax, and Path=/.',
        'FUMA_COOKIE_SECURE',
      )
    }
  }

  assertPaystackScopesDoNotOverlap(config)
}

export function readFumaConfig(env: Env = process.env): FumaConfig {
  const environment = readEnvironment(env)
  rejectCookieDomainConfiguration(env)
  if (environment === 'production') requireProductionClasses(env)

  const localOverrides = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined),
  )
  const source: Env = environment === 'local'
    ? { ...LOCAL_DEFAULTS, ...localOverrides }
    : env

  const candidate = {
    environment,
    role: enumValue(requiredValue(source, 'FUMA_ROLE'), ['web', 'worker', 'scheduler'], 'FUMA_ROLE'),
    hosts: {
      product: validateValue(HostSchema, requiredValue(source, 'FUMA_PRODUCT_HOST'), 'FUMA_PRODUCT_HOST'),
      marketing: validateValue(HostSchema, requiredValue(source, 'FUMA_MARKETING_HOST'), 'FUMA_MARKETING_HOST'),
      marketingStatus: 'deferred',
    },
    database: {
      url: requiredValue(source, 'DATABASE_URL'),
      engine: 'postgresql',
    },
    redis: { url: requiredValue(source, 'FUMA_REDIS_URL') },
    minio: {
      endpoint: requiredValue(source, 'FUMA_MINIO_ENDPOINT'),
      accessKeyId: requiredValue(source, 'FUMA_MINIO_ACCESS_KEY_ID'),
      secretAccessKey: requiredValue(source, 'FUMA_MINIO_SECRET_ACCESS_KEY'),
      bucket: requiredValue(source, 'FUMA_MINIO_BUCKET'),
    },
    ociEmail: {
      region: requiredValue(source, 'FUMA_OCI_EMAIL_REGION'),
      tenancyId: requiredValue(source, 'FUMA_OCI_EMAIL_TENANCY_ID'),
      userId: requiredValue(source, 'FUMA_OCI_EMAIL_USER_ID'),
      fingerprint: requiredValue(source, 'FUMA_OCI_EMAIL_FINGERPRINT'),
      privateKeyPem: requiredValue(source, 'FUMA_OCI_EMAIL_PRIVATE_KEY_PEM'),
      compartmentId: requiredValue(source, 'FUMA_OCI_EMAIL_COMPARTMENT_ID'),
      approvedSender: validateValue(
        EmailSchema,
        requiredValue(source, 'FUMA_OCI_EMAIL_APPROVED_SENDER'),
        'FUMA_OCI_EMAIL_APPROVED_SENDER',
      ),
      eventVerificationSecret: requiredValue(source, 'FUMA_OCI_EVENT_VERIFICATION_SECRET'),
    },
    publication: {
      unsubscribeSigningSecret: requiredValue(source, 'FUMA_PUBLICATION_UNSUBSCRIBE_SIGNING_SECRET'),
    },
    paystack: {
      providerBaseUrl: requiredValue(source, 'FUMA_PAYSTACK_PROVIDER_URL'),
      platformBilling: {
        scope: 'platform_billing',
        publicKey: requiredValue(source, 'FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY'),
        secretKey: requiredValue(source, 'FUMA_PAYSTACK_PLATFORM_SECRET_KEY'),
      },
      customerMerchant: {
        scope: 'customer_merchant',
        publicKey: requiredValue(source, 'FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY'),
        secretKey: requiredValue(source, 'FUMA_PAYSTACK_CUSTOMER_SECRET_KEY'),
      },
    },
    cloudflare: {
      owner: 'fuma',
      accountId: requiredValue(source, 'FUMA_CLOUDFLARE_ACCOUNT_ID'),
      zoneId: requiredValue(source, 'FUMA_CLOUDFLARE_ZONE_ID'),
      apiToken: requiredValue(source, 'FUMA_CLOUDFLARE_API_TOKEN'),
    },
    locale: {
      locale: enumValue(requiredValue(source, 'FUMA_LOCALE'), ['en-KE'], 'FUMA_LOCALE'),
      currency: enumValue(requiredValue(source, 'FUMA_CURRENCY'), ['KES'], 'FUMA_CURRENCY'),
      timeZone: enumValue(requiredValue(source, 'FUMA_TIME_ZONE'), ['Africa/Nairobi'], 'FUMA_TIME_ZONE'),
    },
    protectedOwner: {
      email: validateValue(
        EmailSchema,
        requiredValue(source, 'FUMA_PROTECTED_OWNER_EMAIL'),
        'FUMA_PROTECTED_OWNER_EMAIL',
      ),
    },
    staffCookie: {
      name: environment === 'production' ? '__Host-fuma_staff' : 'fuma_staff',
      secure: booleanValue(requiredValue(source, 'FUMA_COOKIE_SECURE'), 'FUMA_COOKIE_SECURE'),
      httpOnly: trueValue(requiredValue(source, 'FUMA_COOKIE_HTTP_ONLY'), 'FUMA_COOKIE_HTTP_ONLY'),
      sameSite: enumValue(
        requiredValue(source, 'FUMA_COOKIE_SAME_SITE').toLowerCase(),
        ['lax'],
        'FUMA_COOKIE_SAME_SITE',
      ),
      path: '/',
    },
  }

  const config = validateValue(FumaConfigSchema, candidate, 'FUMA_CONFIG')
  assertConfigInvariants(config)
  return config
}

export function summarizeFumaConfig(input: unknown): FumaConfigSummary {
  const config = validateValue(FumaConfigSchema, input, 'FUMA_CONFIG')
  return validateValue(FumaConfigSummarySchema, {
    environment: config.environment,
    role: config.role,
    productHost: config.hosts.product,
    marketing: config.hosts.marketingStatus,
    database: config.database.engine,
    coordination: 'redis',
    objectStorage: 'minio',
    emailDelivery: 'oci-email-delivery',
    paymentScopes: ['platform_billing', 'customer_merchant'],
    edgeOwner: config.cloudflare.owner,
    locale: config.locale.locale,
    currency: config.locale.currency,
    timeZone: config.locale.timeZone,
    protectedOwnerConfigured: true,
    secureStaffCookie: config.staffCookie.secure,
    staffCookieDomain: 'omitted',
    staffCookiePath: config.staffCookie.path,
  }, 'FUMA_CONFIG_SUMMARY')
}
