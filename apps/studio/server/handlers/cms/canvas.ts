/**
 * Canvas stylesheet endpoint.
 *
 *   POST /admin/api/cms/canvas/tailwind — compile the utilities a canvas frame needs
 *
 * The canvas cannot compile Tailwind itself: resolving `@import "tailwindcss"` needs the
 * package on disk, and the browser has no disk. So the frame sends the theme and the class
 * tokens its tree carries, and gets back real CSS produced by the same compiler that will
 * build the published site. That identity is the whole point — an approximation that
 * differs from production is worse than no preview, because it is confidently wrong.
 *
 * POST rather than GET despite being a read: the candidate list for a real page is far
 * longer than a URL may safely be, and putting a site's entire class inventory in a query
 * string would also put it in every access log. Being state-changing by method also means
 * the origin check in `index.ts` applies.
 *
 * Gated by `site.style.edit`. Compiling a stylesheet is design work, and the response
 * discloses the site's design tokens, so it belongs with the styling capability rather
 * than with content reads.
 */

import type { DbClient } from '../../db/client'
import { requireCapability } from '../../auth/authz'
import { badRequest, jsonResponse, readValidatedBody } from '../../http'
import { Type } from '@core/utils/typeboxHelpers'
import { compileCanvasCss } from '../../fuma/canvas/tailwindCompile'
import { CMS_API_PREFIX } from './shared'
import { runRouteTable, type Route, type RouteParams } from './routeTable'

/**
 * Bounds on the request.
 *
 * A compile is CPU work, so an unbounded candidate list is a way to make the server do
 * arbitrary work on request. These limits are far above any real page — a large site
 * carries a few thousand distinct utilities — and exist to refuse abuse, not to constrain
 * authors.
 */
const MAX_CANDIDATES = 20_000
const MAX_CANDIDATE_LENGTH = 512
const MAX_THEME_LENGTH = 200_000
/**
 * Byte ceiling on the request.
 *
 * The schema limits alone permit a body far larger than any real page, because they bound
 * each field independently. This bounds the whole thing, so the server stops reading
 * before it buffers something enormous rather than after.
 */
const MAX_BODY_BYTES = 2_000_000

const CanvasCssBodySchema = Type.Object({
  /** The site's `@theme` block, as produced by the Tailwind theme generator. */
  theme: Type.String({ maxLength: MAX_THEME_LENGTH }),
  candidates: Type.Array(
    Type.String({ minLength: 1, maxLength: MAX_CANDIDATE_LENGTH }),
    { maxItems: MAX_CANDIDATES },
  ),
})

async function handleCompileCanvasCss(
  req: Request,
  db: DbClient,
  _params: RouteParams,
): Promise<Response> {
  const user = await requireCapability(req, db, 'site.style.edit')
  if (user instanceof Response) return user

  const body = await readValidatedBody(req, CanvasCssBodySchema, {
    maxBytes: MAX_BODY_BYTES,
  })
  if (body === null) {
    return badRequest(
      'Expected a theme string and an array of class candidates within the accepted limits.',
    )
  }

  try {
    const compiled = await compileCanvasCss(body.theme, body.candidates)
    return jsonResponse({
      css: compiled.css,
      // Returned so the canvas can mark the offending elements. Tailwind emits nothing
      // and says nothing for a class that does not exist, so without this the element
      // simply renders unstyled and the author has no way to find out why.
      unknownCandidates: compiled.unknownCandidates,
    })
  } catch (error) {
    // A malformed theme block is an author mistake, not a server fault, and the message
    // is the only thing that will let them fix it.
    return badRequest(
      error instanceof Error
        ? `The theme could not be compiled: ${error.message}`
        : 'The theme could not be compiled.',
    )
  }
}

const routes: readonly Route<[]>[] = [
  { method: 'POST', pattern: `${CMS_API_PREFIX}/canvas/tailwind`, handler: handleCompileCanvasCss },
]

export function handleCanvasRoutes(req: Request, db: DbClient): Promise<Response | null> {
  return runRouteTable(req, db, routes)
}
