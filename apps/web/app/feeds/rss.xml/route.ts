import { generateRss, readEditorial } from '@/lib/editorial'
import { CANONICAL_ORIGIN } from '@/lib/seo'

export async function GET() {
  const entries = (await readEditorial()).filter((entry) => ['blog', 'changelog', 'guides'].includes(entry.meta.collection))
  return new Response(generateRss(entries, CANONICAL_ORIGIN), {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
