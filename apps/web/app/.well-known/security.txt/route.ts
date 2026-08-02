import { FUMA_WEB_DEPLOYMENT } from '@/lib/deployment-profile'

const SECURITY_TEXT = [
  `Contact: ${FUMA_WEB_DEPLOYMENT.origins.public}/security`,
  'Expires: 2026-10-26T00:00:00Z',
  'Preferred-Languages: en',
  `Canonical: ${FUMA_WEB_DEPLOYMENT.origins.public}/.well-known/security.txt`,
  `Policy: ${FUMA_WEB_DEPLOYMENT.origins.public}/security`,
  '',
].join('\n')

export function GET(): Response {
  return new Response(SECURITY_TEXT, {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=3600, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  })
}
