import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Value } from '@sinclair/typebox/value'
import {
  FUMA_PRODUCT_METADATA,
  FumaConfigSchema,
  FumaConfigSummarySchema,
  FumaConfigurationError,
  FumaProductMetadataSchema,
  readFumaConfig,
  summarizeFumaConfig,
} from '../../../server/fuma/config'

const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  FUMA_ENV: 'production',
  FUMA_ROLE: 'web',
  FUMA_DEPLOYMENT_ROOT_DOMAIN: 'trimly.co.ke',
  DATABASE_URL: 'postgres://fuma:test-password@postgres:5432/fuma',
  FUMA_REDIS_URL: 'rediss://redis.internal:6379/0',
  FUMA_MINIO_ENDPOINT: 'https://objects.internal',
  FUMA_MINIO_ACCESS_KEY_ID: 'test-minio-access',
  FUMA_MINIO_SECRET_ACCESS_KEY: 'test-minio-secret',
  FUMA_MINIO_BUCKET: 'fuma-production',
  FUMA_OCI_EMAIL_REGION: 'test-region',
  FUMA_OCI_EMAIL_TENANCY_ID: 'test-tenancy',
  FUMA_OCI_EMAIL_USER_ID: 'test-user',
  FUMA_OCI_EMAIL_FINGERPRINT: 'test-fingerprint',
  FUMA_OCI_EMAIL_PRIVATE_KEY_PEM: 'test-private-key',
  FUMA_OCI_EMAIL_COMPARTMENT_ID: 'ocid1.compartment.oc1..test',
  FUMA_OCI_EMAIL_APPROVED_SENDER: 'mail@trimly.co.ke',
  FUMA_OCI_EVENT_VERIFICATION_SECRET: 'test-event-verification-secret-000000000000',
  FUMA_PUBLICATION_UNSUBSCRIBE_SIGNING_SECRET: 'test-unsubscribe-signing-secret-000000000',
  FUMA_PAYSTACK_PROVIDER_URL: 'https://api.paystack.test',
  FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY: 'test-platform-public',
  FUMA_PAYSTACK_PLATFORM_SECRET_KEY: 'test-platform-secret',
  FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY: 'test-customer-public',
  FUMA_PAYSTACK_CUSTOMER_SECRET_KEY: 'test-customer-secret',
  FUMA_CLOUDFLARE_ACCOUNT_ID: 'test-cloudflare-account',
  FUMA_CLOUDFLARE_ZONE_ID: 'test-cloudflare-zone',
  FUMA_CLOUDFLARE_API_TOKEN: 'test-cloudflare-token',
  FUMA_LOCALE: 'en-KE',
  FUMA_CURRENCY: 'KES',
  FUMA_TIME_ZONE: 'Africa/Nairobi',
  FUMA_PROTECTED_OWNER_EMAIL: 'owner@trimly.co.ke',
  FUMA_COOKIE_SECURE: 'true',
  FUMA_COOKIE_HTTP_ONLY: 'true',
  FUMA_COOKIE_SAME_SITE: 'lax',
}

const REQUIRED_CLASSES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['deployment root', ['FUMA_DEPLOYMENT_ROOT_DOMAIN']],
  ['runtime role', ['FUMA_ROLE']],
  ['PostgreSQL', ['DATABASE_URL']],
  ['Redis', ['FUMA_REDIS_URL']],
  ['MinIO', ['FUMA_MINIO_ENDPOINT', 'FUMA_MINIO_ACCESS_KEY_ID', 'FUMA_MINIO_SECRET_ACCESS_KEY', 'FUMA_MINIO_BUCKET']],
  ['OCI Email Delivery', ['FUMA_OCI_EMAIL_REGION', 'FUMA_OCI_EMAIL_TENANCY_ID', 'FUMA_OCI_EMAIL_USER_ID', 'FUMA_OCI_EMAIL_FINGERPRINT', 'FUMA_OCI_EMAIL_PRIVATE_KEY_PEM', 'FUMA_OCI_EMAIL_COMPARTMENT_ID', 'FUMA_OCI_EMAIL_APPROVED_SENDER', 'FUMA_OCI_EVENT_VERIFICATION_SECRET']],
  ['Publication unsubscribe signing', ['FUMA_PUBLICATION_UNSUBSCRIBE_SIGNING_SECRET']],
  ['Paystack provider', ['FUMA_PAYSTACK_PROVIDER_URL']],
  ['Paystack platform billing', ['FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY', 'FUMA_PAYSTACK_PLATFORM_SECRET_KEY']],
  ['Paystack customer merchant', ['FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY', 'FUMA_PAYSTACK_CUSTOMER_SECRET_KEY']],
  ['Fuma-owned Cloudflare', ['FUMA_CLOUDFLARE_ACCOUNT_ID', 'FUMA_CLOUDFLARE_ZONE_ID', 'FUMA_CLOUDFLARE_API_TOKEN']],
  ['Kenya locale', ['FUMA_LOCALE', 'FUMA_CURRENCY', 'FUMA_TIME_ZONE']],
  ['protected owner', ['FUMA_PROTECTED_OWNER_EMAIL']],
  ['staff cookie policy', ['FUMA_COOKIE_SECURE', 'FUMA_COOKIE_HTTP_ONLY', 'FUMA_COOKIE_SAME_SITE']],
]

const SECRET_VALUES = [
  PRODUCTION_ENV.DATABASE_URL,
  PRODUCTION_ENV.FUMA_REDIS_URL,
  PRODUCTION_ENV.FUMA_MINIO_ACCESS_KEY_ID,
  PRODUCTION_ENV.FUMA_MINIO_SECRET_ACCESS_KEY,
  PRODUCTION_ENV.FUMA_OCI_EMAIL_PRIVATE_KEY_PEM,
  PRODUCTION_ENV.FUMA_OCI_EVENT_VERIFICATION_SECRET,
  PRODUCTION_ENV.FUMA_PUBLICATION_UNSUBSCRIBE_SIGNING_SECRET,
  PRODUCTION_ENV.FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY,
  PRODUCTION_ENV.FUMA_PAYSTACK_PLATFORM_SECRET_KEY,
  PRODUCTION_ENV.FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY,
  PRODUCTION_ENV.FUMA_PAYSTACK_CUSTOMER_SECRET_KEY,
  PRODUCTION_ENV.FUMA_CLOUDFLARE_API_TOKEN,
]

function without(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(PRODUCTION_ENV).filter(([name]) => !names.includes(name)))
}

function configurationError(fn: () => unknown): FumaConfigurationError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(FumaConfigurationError)
    if (error instanceof FumaConfigurationError) return error
  }
  throw new Error('Expected Fuma configuration to be rejected.')
}

function expectSecretSafe(error: FumaConfigurationError): void {
  for (const secret of SECRET_VALUES) expect(error.message).not.toContain(secret)
}

describe('FUMA-003 product metadata', () => {
  it('encodes the product host, deferred marketing host, and Kenya launch defaults', () => {
    expect(Value.Check(FumaProductMetadataSchema, FUMA_PRODUCT_METADATA)).toBe(true)
    expect(FUMA_PRODUCT_METADATA).toEqual({
      product: { name: 'Fuma', host: 'app.trimly.co.ke' },
      marketing: { host: 'trimly.co.ke', status: 'deferred' },
      launchDefaults: { locale: 'en-KE', currency: 'KES', timeZone: 'Africa/Nairobi' },
    })
  })
})

describe('FUMA-003 local configuration', () => {
  it('boots with PostgreSQL-only localhost and visibly fake defaults', () => {
    const config = readFumaConfig({})

    expect(Value.Check(FumaConfigSchema, config)).toBe(true)
    expect(config.environment).toBe('local')
    expect(config.role).toBe('web')
    expect(config.hosts).toEqual({
      rootDomain: 'localhost',
      marketing: 'marketing.localhost',
      redirect: 'www.localhost',
      auth: 'auth.localhost',
      product: 'app.localhost',
      console: 'admin.localhost',
      status: 'status.localhost',
      templatePreview: 'templates.preview.localhost',
      customerRouting: 'customers.localhost',
      marketingStatus: 'deferred',
    })
    expect(config.database.engine).toBe('postgresql')
    expect(config.database.url).toStartWith('postgres://')
    expect(config.database.url).toContain('127.0.0.1')
    expect(config.redis.url).toContain('127.0.0.1')
    expect(config.minio.endpoint).toContain('127.0.0.1')
    expect(JSON.stringify(config)).toMatch(/fake-local/)
    expect(config.staffCookie).toEqual({
      name: 'fuma_staff',
      secure: false,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    expect('domain' in config.staffCookie).toBe(false)
  })

  it('uses local defaults when optional environment entries are undefined', () => {
    const config = readFumaConfig({ FUMA_ROLE: undefined })
    expect(config.role).toBe('web')
  })

  it('rejects production reserved hosts in local mode', () => {
    for (const override of [
      { FUMA_PRODUCT_HOST: 'app.trimly.co.ke' },
      { FUMA_MARKETING_HOST: 'trimly.co.ke' },
    ]) {
      const error = configurationError(() => readFumaConfig(override))
      expect(error.path).toBe('FUMA_ENV')
      expect(error.message).toContain('reserved hosts')
    }
  })

  it('produces a TypeBox-valid summary without URLs, credentials, or owner identity', () => {
    const config = readFumaConfig({})
    const summary = summarizeFumaConfig(config)
    const serialized = JSON.stringify(summary)

    expect(Value.Check(FumaConfigSummarySchema, summary)).toBe(true)
    expect(summary).toEqual({
      environment: 'local',
      role: 'web',
      productHost: 'app.localhost',
      marketing: 'deferred',
      database: 'postgresql',
      coordination: 'redis',
      objectStorage: 'minio',
      emailDelivery: 'oci-email-delivery',
      paymentScopes: ['platform_billing', 'customer_merchant'],
      edgeOwner: 'fuma',
      locale: 'en-KE',
      currency: 'KES',
      timeZone: 'Africa/Nairobi',
      protectedOwnerConfigured: true,
      secureStaffCookie: false,
      staffCookieDomain: 'omitted',
      staffCookiePath: '/',
    })
    for (const sensitiveValue of [
      config.database.url,
      config.redis.url,
      config.minio.endpoint,
      config.minio.accessKeyId,
      config.minio.secretAccessKey,
      config.ociEmail.tenancyId,
      config.ociEmail.userId,
      config.ociEmail.fingerprint,
      config.ociEmail.privateKeyPem,
      config.ociEmail.compartmentId,
      config.ociEmail.eventVerificationSecret,
      config.ociEmail.approvedSender,
      config.publication.unsubscribeSigningSecret,
      config.paystack.platformBilling.publicKey,
      config.paystack.platformBilling.secretKey,
      config.paystack.customerMerchant.publicKey,
      config.paystack.customerMerchant.secretKey,
      config.cloudflare.accountId,
      config.cloudflare.zoneId,
      config.cloudflare.apiToken,
      config.protectedOwner.email,
    ]) {
      expect(serialized).not.toContain(sensitiveValue)
    }
  })
})

describe('FUMA-003 production mode selection', () => {
  it('does not downgrade NODE_ENV=production when FUMA_ENV is missing', () => {
    const error = configurationError(() => readFumaConfig({ NODE_ENV: 'production' }))
    expect(error.path).toBe('FUMA_ENV')
    expect(error.message).toContain('explicit FUMA_ENV=production')
  })

  it('does not accept explicit local Fuma mode under NODE_ENV=production', () => {
    const error = configurationError(() => readFumaConfig({
      NODE_ENV: 'production',
      FUMA_ENV: 'local',
    }))
    expect(error.path).toBe('FUMA_ENV')
  })

  it('requires NODE_ENV=production whenever FUMA_ENV=production', () => {
    for (const nodeEnvironment of [undefined, 'development', 'test']) {
      const error = configurationError(() => readFumaConfig({
        NODE_ENV: nodeEnvironment,
        FUMA_ENV: 'production',
      }))
      expect(error.path).toBe('NODE_ENV')
      expect(error.message).toContain('explicit NODE_ENV=production')
    }
  })

  it('rejects non-string and unknown FUMA_ENV values at the boundary', () => {
    expect(configurationError(() => readFumaConfig({ FUMA_ENV: 1 })).path).toBe('FUMA_ENV')
    expect(configurationError(() => readFumaConfig({ FUMA_ENV: 'staging' })).path).toBe('FUMA_ENV')
    expect(configurationError(() => readFumaConfig({ FUMA_ENV: '' })).path).toBe('FUMA_ENV')
  })
})

describe('FUMA-003 production configuration', () => {
  it('accepts one complete explicit production configuration', () => {
    const config = readFumaConfig(PRODUCTION_ENV)

    expect(Value.Check(FumaConfigSchema, config)).toBe(true)
    expect(config.environment).toBe('production')
    expect(config.hosts).toEqual({
      rootDomain: 'trimly.co.ke',
      marketing: 'trimly.co.ke',
      redirect: 'www.trimly.co.ke',
      auth: 'auth.trimly.co.ke',
      product: 'app.trimly.co.ke',
      console: 'admin.trimly.co.ke',
      status: 'status.trimly.co.ke',
      templatePreview: 'templates.preview.trimly.co.ke',
      customerRouting: 'customers.trimly.co.ke',
      marketingStatus: 'deferred',
    })
    expect(config.paystack.platformBilling.scope).toBe('platform_billing')
    expect(config.paystack.customerMerchant.scope).toBe('customer_merchant')
    expect(config.staffCookie).toEqual({
      name: '__Host-fuma_staff',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    expect('domain' in config.staffCookie).toBe(false)
  })

  for (const [requiredClass, variables] of REQUIRED_CLASSES) {
    it(`fails closed when the ${requiredClass} class is omitted`, () => {
      const error = configurationError(() => readFumaConfig(without(variables)))
      expect(error.message).toContain(requiredClass)
      expect(error.path).toBe(variables[0]!)
      expectSecretSafe(error)
    })
  }

  it('rejects every unsafe production cookie setting', () => {
    for (const [name, value] of [
      ['FUMA_COOKIE_SECURE', 'false'],
      ['FUMA_COOKIE_HTTP_ONLY', 'false'],
      ['FUMA_COOKIE_SAME_SITE', 'none'],
    ] as const) {
      const error = configurationError(() => readFumaConfig({ ...PRODUCTION_ENV, [name]: value }))
      expect(error.message).not.toContain(value)
    }
  })

  it('models host-only cookies by rejecting Domain and host-only assertion variables', () => {
    for (const [name, value] of [
      ['FUMA_COOKIE_DOMAIN', '.trimly.co.ke'],
      ['FUMA_COOKIE_HOST_ONLY', 'true'],
    ] as const) {
      const error = configurationError(() => readFumaConfig({ ...PRODUCTION_ENV, [name]: value }))
      expect(error.path).toBe(name)
      expect(error.message).toContain('Domain attribute is omitted')
      expect(error.message).not.toContain(value)
    }
  })

  it('makes a Domain-bearing cookie invalid under the schema and summary boundary', () => {
    const config = readFumaConfig(PRODUCTION_ENV)
    const domainCookieConfig = {
      ...config,
      staffCookie: { ...config.staffCookie, domain: '.trimly.co.ke' },
    }

    expect(Value.Check(FumaConfigSchema, domainCookieConfig)).toBe(false)
    expect(() => summarizeFumaConfig(domainCookieConfig)).toThrow(FumaConfigurationError)
  })

  it('rejects every overlap between platform and customer Paystack credential scopes', () => {
    const overlaps = [
      ['FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY', 'FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY'],
      ['FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY', 'FUMA_PAYSTACK_CUSTOMER_SECRET_KEY'],
      ['FUMA_PAYSTACK_PLATFORM_SECRET_KEY', 'FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY'],
      ['FUMA_PAYSTACK_PLATFORM_SECRET_KEY', 'FUMA_PAYSTACK_CUSTOMER_SECRET_KEY'],
    ] as const

    for (const [platformName, customerName] of overlaps) {
      const overlap = `scope-overlap-${platformName}-${customerName}`
      const error = configurationError(() => readFumaConfig({
        ...PRODUCTION_ENV,
        [platformName]: overlap,
        [customerName]: overlap,
      }))

      expect(error.path).toBe(customerName)
      expect(error.message).toContain('must not overlap')
      expect(error.message).not.toContain(overlap)
    }
  })

  it('derives every exact production host from an alternate deployment root', () => {
    const config = readFumaConfig({
      ...PRODUCTION_ENV,
      FUMA_DEPLOYMENT_ROOT_DOMAIN: 'example.co.ke',
    })
    expect(config.hosts).toMatchObject({
      rootDomain: 'example.co.ke',
      marketing: 'example.co.ke',
      redirect: 'www.example.co.ke',
      auth: 'auth.example.co.ke',
      product: 'app.example.co.ke',
      console: 'admin.example.co.ke',
      status: 'status.example.co.ke',
      templatePreview: 'templates.preview.example.co.ke',
      customerRouting: 'customers.example.co.ke',
    })
  })

  it('rejects malformed, ambiguous, and noncanonical deployment roots', () => {
    for (const rootDomain of [
      'https://trimly.co.ke',
      'trimly.co.ke:443',
      'TRIMLY.CO.KE',
      'trimly.co.ke.',
      '*.trimly.co.ke',
      'xn--trimly-9za.co.ke',
      'localhost',
    ]) {
      const error = configurationError(() => readFumaConfig({
        ...PRODUCTION_ENV,
        FUMA_DEPLOYMENT_ROOT_DOMAIN: rootDomain,
      }))
      expect(error.path).toBe('FUMA_DEPLOYMENT_ROOT_DOMAIN')
      expect(error.message).not.toContain(rootDomain)
      expectSecretSafe(error)
    }
  })

  it('rejects malformed, hostless, and wrong-protocol provider URLs', () => {
    const invalidProviders = [
      ['DATABASE_URL', 'mysql://database/fuma'],
      ['DATABASE_URL', 'postgres:///fuma'],
      ['DATABASE_URL', 'postgres://database'],
      ['DATABASE_URL', 'postgres://database/fuma#credentials'],
      ['FUMA_REDIS_URL', 'http://redis.internal:6379/0'],
      ['FUMA_REDIS_URL', 'redis:///0'],
      ['FUMA_REDIS_URL', 'rediss://redis.internal/0#token'],
      ['FUMA_MINIO_ENDPOINT', 'ftp://objects.internal'],
      ['FUMA_MINIO_ENDPOINT', 'https://user:secret@objects.internal'],
      ['FUMA_MINIO_ENDPOINT', 'https://objects.internal/private'],
      ['FUMA_MINIO_ENDPOINT', 'https://objects.internal?token=secret'],
      ['FUMA_PAYSTACK_PROVIDER_URL', 'http://api.paystack.test'],
      ['FUMA_PAYSTACK_PROVIDER_URL', 'https://user:secret@api.paystack.test'],
      ['FUMA_PAYSTACK_PROVIDER_URL', 'https://api.paystack.test/private'],
      ['FUMA_PAYSTACK_PROVIDER_URL', 'https://api.paystack.test?token=secret'],
    ] as const

    for (const [name, value] of invalidProviders) {
      const error = configurationError(() => readFumaConfig({ ...PRODUCTION_ENV, [name]: value }))
      expect(error.path).toBe(name)
      expect(error.message).not.toContain(value)
      expectSecretSafe(error)
    }
  })

  it('rejects malformed emails through the TypeBox-derived field boundary', () => {
    for (const name of ['FUMA_OCI_EMAIL_APPROVED_SENDER', 'FUMA_PROTECTED_OWNER_EMAIL'] as const) {
      const error = configurationError(() => readFumaConfig({
        ...PRODUCTION_ENV,
        [name]: 'not-an-email',
      }))
      expect(error.path).toBe(name)
      expect(error.message).not.toContain('not-an-email')
    }
  })

  it('never includes rejected credential values in validation errors', () => {
    const malformedSecret = 'do-not-disclose-this-value'
    const error = configurationError(() => readFumaConfig({
      ...PRODUCTION_ENV,
      FUMA_MINIO_ENDPOINT: `https://${malformedSecret}@objects.internal/private`,
    }))
    expect(error.message).not.toContain(malformedSecret)
  })
})

describe('FUMA-003 environment example', () => {
  it('keeps deployment-specific values blank and documents the fixed policy values', () => {
    const example = readFileSync(join(import.meta.dir, '../../../../../.env.fuma.example'), 'utf8')
    for (const name of [
      'DATABASE_URL',
      'FUMA_REDIS_URL',
      'FUMA_MINIO_ENDPOINT',
      'FUMA_MINIO_ACCESS_KEY_ID',
      'FUMA_MINIO_SECRET_ACCESS_KEY',
      'FUMA_MINIO_BUCKET',
      'FUMA_OCI_EMAIL_REGION',
      'FUMA_OCI_EMAIL_TENANCY_ID',
      'FUMA_OCI_EMAIL_USER_ID',
      'FUMA_OCI_EMAIL_FINGERPRINT',
      'FUMA_OCI_EMAIL_PRIVATE_KEY_PEM',
      'FUMA_OCI_EMAIL_APPROVED_SENDER',
      'FUMA_PAYSTACK_PLATFORM_PUBLIC_KEY',
      'FUMA_PAYSTACK_PLATFORM_SECRET_KEY',
      'FUMA_PAYSTACK_CUSTOMER_PUBLIC_KEY',
      'FUMA_PAYSTACK_CUSTOMER_SECRET_KEY',
      'FUMA_CLOUDFLARE_ACCOUNT_ID',
      'FUMA_CLOUDFLARE_ZONE_ID',
      'FUMA_CLOUDFLARE_API_TOKEN',
      'FUMA_PROTECTED_OWNER_EMAIL',
    ]) {
      expect(example).toMatch(new RegExp(`^${name}=$`, 'm'))
    }
    expect(example).toMatch(/^FUMA_PAYSTACK_PROVIDER_URL=https:\/\/api\.paystack\.co$/m)
    expect(example).toMatch(/^NODE_ENV=production$/m)
    expect(example).toMatch(/^FUMA_ENV=production$/m)
    expect(example).not.toMatch(/^FUMA_COOKIE_(?:DOMAIN|HOST_ONLY)=/m)
    expect(example).not.toMatch(/(?:sk|pk)_(?:live|test)_[a-z0-9]+/i)
    expect(example).not.toMatch(/-----BEGIN [A-Z ]+PRIVATE KEY-----/)
  })
})
