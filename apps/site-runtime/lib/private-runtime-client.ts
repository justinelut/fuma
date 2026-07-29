import {
  ResolveResponseSchema,
  SiteApplicationMutationCommandSchema,
  SiteApplicationMutationResponseSchema,
  SiteRuntimeClientError,
  parseContract,
  type ResolveResponse,
  type SiteApplicationMutationCommand,
  type SiteApplicationMutationResponse,
} from './contracts'

export type RuntimeResolveInput = Readonly<{
  host: string
  route: string
  canonicalQuery: string
  runtimeDeploymentVersion: string
  memberSessionToken: string | null
}>

export type PrivateRuntimeClientConfig = Readonly<{
  origin: string
  serviceToken: string
  fetchImpl?: typeof fetch
}>

function validOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new SiteRuntimeClientError('authority-unavailable', 'Private runtime origin is invalid.') }
  const production = process.env.NODE_ENV === 'production'
  if ((production && url.protocol !== 'https:') || (!production && !['http:', 'https:'].includes(url.protocol)) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new SiteRuntimeClientError('authority-unavailable', 'Private runtime origin must be an origin-only URL.')
  }
  return url.origin
}

export class PrivateRuntimeClient {
  readonly #origin: string
  readonly #token: string
  readonly #fetch: typeof fetch
  constructor(config: PrivateRuntimeClientConfig) {
    this.#origin = validOrigin(config.origin)
    if (config.serviceToken.length < 32) throw new SiteRuntimeClientError('authority-unavailable', 'Private runtime service token is invalid.')
    this.#token = config.serviceToken
    this.#fetch = config.fetchImpl ?? globalThis.fetch
  }

  async resolve(input: RuntimeResolveInput): Promise<ResolveResponse> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#origin}/_fuma/private/site-runtime/v1/resolve`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#token}`,
          'content-type': 'application/json',
          'x-fuma-audience': 'fuma-site-runtime',
          'x-fuma-request-id': crypto.randomUUID(),
        },
        body: JSON.stringify(input),
        cache: 'no-store',
        redirect: 'error',
      })
    } catch { throw new SiteRuntimeClientError('authority-unavailable', 'Private runtime authority is unavailable.') }
    if (response.status === 409) throw new SiteRuntimeClientError('runtime-conflict', 'Runtime deployment or active release changed.')
    if (!response.ok) throw new SiteRuntimeClientError('authority-unavailable', 'Private runtime authority denied the request.')
    let value: unknown
    try { value = await response.json() as unknown } catch { throw new SiteRuntimeClientError('invalid-response', 'Private runtime response is not JSON.') }
    const result = parseContract(ResolveResponseSchema, value, 'private runtime response') as ResolveResponse
    const identity = result.cacheIdentity
    if (identity.host !== input.host || identity.route !== input.route || identity.canonicalQuery !== input.canonicalQuery
      || identity.runtimeDeploymentVersion !== input.runtimeDeploymentVersion
      || result.routeArtifact.releaseId !== identity.releaseId
      || result.routeArtifact.siteId !== identity.siteId
      || result.routeArtifact.ownerKey !== identity.ownerKey
      || result.routeArtifact.ownerGeneration !== identity.ownerGeneration
      || result.routeArtifact.route.route !== identity.route
      || result.routeArtifact.componentRegistryVersion !== identity.componentRegistryVersion
      || JSON.stringify(result.application.cacheIdentity) !== JSON.stringify(identity)
      || result.delivery.policy.route !== identity.route
      || result.delivery.policy.version !== identity.rolloutPolicyVersion
      || (result.delivery.selected === 'legacy' && result.delivery.legacy === null)) {
      throw new SiteRuntimeClientError('invalid-response', 'Private runtime response changed exact request authority.')
    }
    return result
  }

  async mutate(input: Readonly<{ host: string; memberSessionToken: string | null; command: SiteApplicationMutationCommand }>): Promise<SiteApplicationMutationResponse> {
    const command = parseContract(SiteApplicationMutationCommandSchema, input.command, 'site application mutation command') as SiteApplicationMutationCommand
    if (command.context.cacheIdentity.host !== input.host) throw new SiteRuntimeClientError('invalid-request', 'Mutation host does not match its immutable context.')
    let response: Response
    try {
      response = await this.#fetch(`${this.#origin}/_fuma/private/site-runtime/v1/mutate`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#token}`,
          'content-type': 'application/json',
          'x-fuma-audience': 'fuma-site-runtime',
          'x-fuma-request-id': crypto.randomUUID(),
        },
        body: JSON.stringify({ host: input.host, memberSessionToken: input.memberSessionToken, ...command }),
        cache: 'no-store',
        redirect: 'error',
      })
    } catch { throw new SiteRuntimeClientError('authority-unavailable', 'Private mutation authority is unavailable.') }
    if (response.status === 409) throw new SiteRuntimeClientError('runtime-conflict', 'Mutation state, replay evidence, or active release changed.')
    if (!response.ok) throw new SiteRuntimeClientError('authority-unavailable', 'Private mutation authority denied the request.')
    let value: unknown
    try { value = await response.json() as unknown } catch { throw new SiteRuntimeClientError('invalid-response', 'Private mutation response is not JSON.') }
    const result = parseContract(SiteApplicationMutationResponseSchema, value, 'private mutation response') as SiteApplicationMutationResponse
    if (result.mutationId !== command.operation.mutationId || result.snapshot.version <= command.operation.expectedVersion) {
      throw new SiteRuntimeClientError('invalid-response', 'Mutation response changed identity or did not advance state.')
    }
    return result
  }
}

export function privateRuntimeClientFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): PrivateRuntimeClient {
  const origin = env.FUMA_SITE_RUNTIME_PRIVATE_ORIGIN
  const serviceToken = env.FUMA_SITE_RUNTIME_SERVICE_TOKEN
  if (!origin || !serviceToken) throw new SiteRuntimeClientError('authority-unavailable', 'Private runtime client configuration is missing.')
  return new PrivateRuntimeClient({ origin, serviceToken })
}
