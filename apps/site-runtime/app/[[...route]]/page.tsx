import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { RuntimeDocument } from '../../components/runtime-document'
import { SiteRuntimeClientError } from '../../lib/contracts'
import { privateRuntimeClientFromEnv } from '../../lib/private-runtime-client'
import { authorizeRoutedHost, canonicalQuery, canonicalRoute, siteMemberSessionToken } from '../../lib/request-authority'
import { assertServing } from '../../lib/drain'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PageProps = Readonly<{
  params: Promise<{ route?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}>

export default async function TenantPage({ params, searchParams }: PageProps) {
  const requestHeaders = await headers()
  let response: Awaited<ReturnType<ReturnType<typeof privateRuntimeClientFromEnv>['resolve']>>
  try {
    assertServing()
    const routingToken = process.env.FUMA_SITE_RUNTIME_ROUTING_TOKEN ?? ''
    const host = authorizeRoutedHost(requestHeaders, routingToken)
    const route = canonicalRoute((await params).route)
    const query = canonicalQuery(await searchParams)
    const runtimeDeploymentVersion = process.env.FUMA_SITE_RUNTIME_DEPLOYMENT_VERSION ?? ''
    response = await privateRuntimeClientFromEnv().resolve({
      host,
      route,
      canonicalQuery: query,
      runtimeDeploymentVersion,
      memberSessionToken: siteMemberSessionToken(requestHeaders.get('cookie')),
    })
  } catch (error) {
    if (error instanceof SiteRuntimeClientError && (error.code === 'invalid-request' || error.code === 'direct-origin' || error.code === 'authority-unavailable')) notFound()
    throw error
  }
  return <RuntimeDocument response={response} />
}
