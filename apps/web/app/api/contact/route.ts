import { createContactPost } from '@/lib/contact-boundary'
import { forwardContact } from '@/lib/private-bridge'
import { NO_STORE_HEADERS } from '@/lib/public-request'

const post = createContactPost({ forward: forwardContact })

export async function POST(request: Request): Promise<Response> {
  const response = await post(request)
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(name, value)
  return response
}
