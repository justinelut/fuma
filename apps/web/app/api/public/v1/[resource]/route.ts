import { handlePublicProjectionBff } from '@/lib/public-projections'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return handlePublicProjectionBff(request)
}
