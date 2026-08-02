import { ImageResponse } from 'next/og'
import { SOCIAL_CARD, SocialCard } from '@/lib/social-card'

export const alt = SOCIAL_CARD.alt
export const size = { width: SOCIAL_CARD.width, height: SOCIAL_CARD.height }
export const contentType = SOCIAL_CARD.contentType

export default function Image() {
  return new ImageResponse(<SocialCard />, size)
}
