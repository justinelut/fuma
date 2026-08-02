import { ImageResponse } from 'next/og'
import { SOCIAL_CARD, SocialCard } from '@/lib/social-card'

export const dynamic = 'force-static'

export function GET() {
  return new ImageResponse(SocialCard(), {
    width: SOCIAL_CARD.width,
    height: SOCIAL_CARD.height,
    headers: {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  })
}
