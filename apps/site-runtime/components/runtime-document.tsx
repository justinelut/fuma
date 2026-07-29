import { createHash } from 'node:crypto'
import type { ResolveResponse } from '../lib/contracts'
import { ApplicationStateSeed } from './application-state'
import { LegacyCompatibilityFrame } from './legacy-compatibility-frame'
import { RuntimeTree, runtimeStyleCss } from './runtime-tree'

function verifiedStylesheets(response: ResolveResponse): readonly Readonly<{ logicalPath: string; cssText: string }>[] {
  return response.routeArtifact.stylesheets.map((stylesheet) => {
    const hash = createHash('sha256').update(stylesheet.cssText, 'utf8').digest('hex')
    if (hash !== stylesheet.contentHashSha256 || /<\/style/i.test(stylesheet.cssText)) {
      throw new TypeError(`Immutable runtime stylesheet ${stylesheet.logicalPath} failed integrity validation.`)
    }
    return stylesheet
  })
}

export function RuntimeDocument({ response }: Readonly<{ response: ResolveResponse }>) {
  const { cacheIdentity, routeArtifact } = response
  const generatedCss = runtimeStyleCss(routeArtifact)
  const stylesheets = verifiedStylesheets(response)
  return (
    <>
      {generatedCss ? <style data-fuma-release-styles="manifest">{generatedCss}</style> : null}
      {stylesheets.map((stylesheet) => <style key={stylesheet.logicalPath} data-fuma-release-styles={stylesheet.logicalPath}>{stylesheet.cssText}</style>)}
      <ApplicationStateSeed context={response.application} />
      <output
        hidden
        data-fuma-host={cacheIdentity.host}
        data-fuma-site={cacheIdentity.siteId}
        data-fuma-release={cacheIdentity.releaseId}
        data-fuma-release-hash={cacheIdentity.releaseHashSha256}
        data-fuma-audience={cacheIdentity.audience.kind}
        data-fuma-delivery={response.delivery.selected}
        data-fuma-rollout-version={cacheIdentity.rolloutPolicyVersion}
        data-fuma-shadow-parity={response.delivery.shadowParity}
      >{routeArtifact.page.title}</output>
      {response.delivery.selected === 'legacy'
        ? response.delivery.legacy
          ? <LegacyCompatibilityFrame document={response.delivery.legacy} title={routeArtifact.page.title} />
          : null
        : <RuntimeTree route={routeArtifact} host={cacheIdentity.host} ownerKey={cacheIdentity.ownerKey} siteId={cacheIdentity.siteId} />}
    </>
  )
}
