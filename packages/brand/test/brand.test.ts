import { describe, expect, test } from 'bun:test'
import {
  createFumaDeploymentProfile,
  FUMA_DEFAULT_DEPLOYMENT_PROFILE,
  FUMA_DEPLOYMENT_ROOT_DOMAIN_ENV,
  FUMA_PUBLIC_IDENTITY,
  readFumaDeploymentProfile,
} from '@fuma/brand'

describe('@fuma/brand identity', () => {
  test('keeps Fuma identity stable and exposes only compatibility host defaults', () => {
    expect(FUMA_PUBLIC_IDENTITY).toEqual({
      product: { name: 'Fuma', host: 'app.trimly.co.ke' },
      marketing: { host: 'trimly.co.ke', status: 'deferred' },
      launchDefaults: { locale: 'en-KE', currency: 'KES', timeZone: 'Africa/Nairobi' },
    })
    expect(FUMA_PUBLIC_IDENTITY.product.name).toBe('Fuma')
  })

  test('keeps exported identity metadata immutable', () => {
    expect(Object.isFrozen(FUMA_PUBLIC_IDENTITY)).toBe(true)
    expect(Object.isFrozen(FUMA_PUBLIC_IDENTITY.product)).toBe(true)
    expect(Object.isFrozen(FUMA_PUBLIC_IDENTITY.marketing)).toBe(true)
    expect(Object.isFrozen(FUMA_PUBLIC_IDENTITY.launchDefaults)).toBe(true)
  })
})

describe('@fuma/brand deployment profile', () => {
  test('derives every exact host and origin from one root domain', () => {
    expect(FUMA_DEFAULT_DEPLOYMENT_PROFILE).toEqual({
      rootDomain: 'trimly.co.ke',
      hosts: {
        public: 'trimly.co.ke', redirect: 'www.trimly.co.ke', auth: 'auth.trimly.co.ke',
        product: 'app.trimly.co.ke', console: 'admin.trimly.co.ke', status: 'status.trimly.co.ke',
        templatePreview: 'templates.preview.trimly.co.ke', customerRouting: 'customers.trimly.co.ke',
      },
      origins: {
        public: 'https://trimly.co.ke', auth: 'https://auth.trimly.co.ke',
        product: 'https://app.trimly.co.ke', console: 'https://admin.trimly.co.ke',
        status: 'https://status.trimly.co.ke', templatePreview: 'https://templates.preview.trimly.co.ke',
      },
      tenantSuffix: '.trimly.co.ke',
      tenantWildcard: '*.trimly.co.ke',
    })
    expect(Object.isFrozen(FUMA_DEFAULT_DEPLOYMENT_PROFILE)).toBe(true)
    expect(Object.isFrozen(FUMA_DEFAULT_DEPLOYMENT_PROFILE.hosts)).toBe(true)
    expect(Object.isFrozen(FUMA_DEFAULT_DEPLOYMENT_PROFILE.origins)).toBe(true)
  })

  test('supports one explicit alternate deployment root without changing product identity', () => {
    const profile = readFumaDeploymentProfile({ [FUMA_DEPLOYMENT_ROOT_DOMAIN_ENV]: 'example.co.ke' }, { required: true })
    expect(profile.hosts).toMatchObject({
      public: 'example.co.ke', redirect: 'www.example.co.ke', auth: 'auth.example.co.ke',
      product: 'app.example.co.ke', console: 'admin.example.co.ke', status: 'status.example.co.ke',
      templatePreview: 'templates.preview.example.co.ke', customerRouting: 'customers.example.co.ke',
    })
    expect(profile.tenantSuffix).toBe('.example.co.ke')
    expect(FUMA_PUBLIC_IDENTITY.product.name).toBe('Fuma')
  })

  test('requires the environment input when requested', () => {
    expect(() => readFumaDeploymentProfile({}, { required: true })).toThrow(FUMA_DEPLOYMENT_ROOT_DOMAIN_ENV)
    expect(readFumaDeploymentProfile({}).rootDomain).toBe('trimly.co.ke')
  })

  test.each([
    '', ' trimly.co.ke', 'TRIMLY.CO.KE', 'https://trimly.co.ke', 'trimly.co.ke:443',
    '*.trimly.co.ke', '.trimly.co.ke', 'trimly..co.ke', 'trimly.co.ke.', 'xn--trimly-9za.co.ke',
    'localhost', `a.${'b'.repeat(64)}.co.ke`,
  ])('rejects malformed or ambiguous root %s', (value) => {
    expect(() => createFumaDeploymentProfile(value)).toThrow(TypeError)
  })
})
