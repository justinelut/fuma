import type { ReactElement } from 'react'
import { FUMA_WEB_DEPLOYMENT } from './deployment-profile'

export const SOCIAL_CARD = Object.freeze({
  version: 'fuma-social-v1',
  pathname: '/social/fuma-social-v1.png',
  width: 1_200,
  height: 630,
  contentType: 'image/png',
  alt: 'Fuma — own your publishing',
  headline: 'Own your publishing.',
  description: 'Websites and publications, built with craft.',
})

export function SocialCard(): ReactElement {
  return <div style={{
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    justifyContent: 'space-between', background: '#101212', color: '#f5f5ef',
    padding: '72px', fontFamily: 'sans-serif',
  }}>
    <div style={{ fontSize: 42, fontWeight: 700, display: 'flex' }}>
      Fuma<span style={{ color: '#8ef2c6' }}>.</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 84, fontWeight: 700, letterSpacing: '-4px' }}>{SOCIAL_CARD.headline}</span>
      <span style={{ fontSize: 28, color: '#b8b9b4', marginTop: 22 }}>{SOCIAL_CARD.description}</span>
    </div>
    <div style={{ fontSize: 22, color: '#8ef2c6' }}>{FUMA_WEB_DEPLOYMENT.rootDomain}</div>
  </div>
}
