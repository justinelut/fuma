export const FUMA_DEPLOYMENT_ROOT_DOMAIN_ENV = 'FUMA_DEPLOYMENT_ROOT_DOMAIN' as const
export const FUMA_DEFAULT_DEPLOYMENT_ROOT_DOMAIN = 'trimly.co.ke' as const

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export type FumaDeploymentProfile = Readonly<{
  rootDomain: string
  hosts: Readonly<{
    public: string
    redirect: string
    auth: string
    product: string
    console: string
    status: string
    templatePreview: string
    customerRouting: string
  }>
  origins: Readonly<{
    public: string
    auth: string
    product: string
    console: string
    status: string
    templatePreview: string
  }>
  tenantSuffix: string
  tenantWildcard: string
}>

export type FumaDeploymentEnvironment = Readonly<Record<string, unknown>>
export type ReadFumaDeploymentProfileOptions = Readonly<{
  required?: boolean
  defaultRootDomain?: string
}>

function validDnsName(value: string): boolean {
  return value.length <= 253
    && value.includes('.')
    && value.split('.').every((label) => DNS_LABEL.test(label) && !label.startsWith('xn--'))
}

export function createFumaDeploymentProfile(rootDomain: unknown): FumaDeploymentProfile {
  if (typeof rootDomain !== 'string' || rootDomain.length === 0 || rootDomain !== rootDomain.trim()
    || rootDomain !== rootDomain.toLowerCase() || !validDnsName(rootDomain)) {
    throw new TypeError('Fuma deployment root domain must be a canonical lowercase ASCII DNS name.')
  }

  const hosts = Object.freeze({
    public: rootDomain,
    redirect: `www.${rootDomain}`,
    auth: `auth.${rootDomain}`,
    product: `app.${rootDomain}`,
    console: `admin.${rootDomain}`,
    status: `status.${rootDomain}`,
    templatePreview: `templates.preview.${rootDomain}`,
    customerRouting: `customers.${rootDomain}`,
  })
  if (Object.values(hosts).some((host) => !validDnsName(host))) {
    throw new TypeError('Fuma deployment root domain produces an invalid derived host.')
  }

  const https = (host: string) => `https://${host}`
  return Object.freeze({
    rootDomain,
    hosts,
    origins: Object.freeze({
      public: https(hosts.public),
      auth: https(hosts.auth),
      product: https(hosts.product),
      console: https(hosts.console),
      status: https(hosts.status),
      templatePreview: https(hosts.templatePreview),
    }),
    tenantSuffix: `.${rootDomain}`,
    tenantWildcard: `*.${rootDomain}`,
  })
}

export function readFumaDeploymentProfile(
  env: FumaDeploymentEnvironment,
  options: ReadFumaDeploymentProfileOptions = {},
): FumaDeploymentProfile {
  const configured = env[FUMA_DEPLOYMENT_ROOT_DOMAIN_ENV]
  if (configured === undefined) {
    if (options.required) throw new TypeError(`${FUMA_DEPLOYMENT_ROOT_DOMAIN_ENV} is required.`)
    return createFumaDeploymentProfile(options.defaultRootDomain ?? FUMA_DEFAULT_DEPLOYMENT_ROOT_DOMAIN)
  }
  return createFumaDeploymentProfile(configured)
}

export const FUMA_DEFAULT_DEPLOYMENT_PROFILE = createFumaDeploymentProfile(
  FUMA_DEFAULT_DEPLOYMENT_ROOT_DOMAIN,
)

const product = Object.freeze({
  name: 'Fuma',
  host: FUMA_DEFAULT_DEPLOYMENT_PROFILE.hosts.product,
} as const)

const marketing = Object.freeze({
  host: FUMA_DEFAULT_DEPLOYMENT_PROFILE.hosts.public,
  status: 'deferred',
} as const)

const launchDefaults = Object.freeze({
  locale: 'en-KE',
  currency: 'KES',
  timeZone: 'Africa/Nairobi',
} as const)

/**
 * Public Fuma identity metadata. Host fields are compatibility defaults only;
 * routing and deployment authority must use a FumaDeploymentProfile.
 */
export const FUMA_PUBLIC_IDENTITY = Object.freeze({
  product,
  marketing,
  launchDefaults,
} as const)

export type FumaPublicIdentity = typeof FUMA_PUBLIC_IDENTITY
