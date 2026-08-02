import type { NextSourceRoute } from './nextSourceContracts'

const ROUTE_SOURCE_EXTENSION = '(?:js|jsx|ts|tsx|mjs|cjs|mdx)'
const APP_ROUTE_FILE = new RegExp(`/(page|route)\\.${ROUTE_SOURCE_EXTENSION}$`)
const APP_METADATA_FILE = new RegExp(`/(robots|sitemap|manifest)\\.${ROUTE_SOURCE_EXTENSION}$`)
const APP_FILE_METADATA = new RegExp(`/(favicon|icon|apple-icon|opengraph-image|twitter-image)\\.(?:ico|jpe?g|png|svg|${ROUTE_SOURCE_EXTENSION})$`)
const APP_SYSTEM_FILE = new RegExp(`/(not-found|error|global-error|forbidden|unauthorized)\\.${ROUTE_SOURCE_EXTENSION}$`)
const PAGES_ROUTE_FILE = new RegExp(`\\.${ROUTE_SOURCE_EXTENSION}$`)

function routeFromSegments(segments: string[]): string {
  const retained = segments.filter((segment) => {
    if (!segment || segment.startsWith('@')) return false
    if (segment.startsWith('(') && segment.endsWith(')')) return false
    return true
  })
  return retained.length === 0 ? '/' : `/${retained.join('/')}`
}

function routeBelow(segments: string[], leaf: string): string {
  const parent = routeFromSegments(segments)
  return parent === '/' ? `/${leaf}` : `${parent}/${leaf}`
}

function appRootIndex(path: string): number | null {
  const segments = path.split('/')
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== 'app') continue
    if (index === 0 || segments[index - 1] === 'src') return index
  }
  return null
}

function pagesRootIndex(path: string): number | null {
  const segments = path.split('/')
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== 'pages') continue
    if (index === 0 || segments[index - 1] === 'src') return index
  }
  return null
}

function discoverAppRoute(path: string): NextSourceRoute | null {
  const rootIndex = appRootIndex(path)
  if (rootIndex === null) return null
  const segments = path.split('/')
  const relative = segments.slice(rootIndex + 1).join('/')
  const match = `/${relative}`.match(APP_ROUTE_FILE)
  if (!match) return null

  const routeSegments = segments.slice(rootIndex + 1, -1)
  if (routeSegments.some((segment) => segment.startsWith('_'))) return null
  return {
    router: 'app',
    kind: match[1] === 'route' ? 'route-handler' : 'page',
    route: routeFromSegments(routeSegments),
    sourcePath: path,
  }
}

function discoverAppConventionRoute(path: string): NextSourceRoute | null {
  const rootIndex = appRootIndex(path)
  if (rootIndex === null) return null
  const segments = path.split('/')
  const relative = segments.slice(rootIndex + 1).join('/')
  const routeSegments = segments.slice(rootIndex + 1, -1)
  if (routeSegments.some((segment) => segment.startsWith('_'))) return null

  const metadata = `/${relative}`.match(APP_METADATA_FILE)
  if (metadata) {
    const leaf = metadata[1] === 'robots'
      ? 'robots.txt'
      : metadata[1] === 'sitemap'
        ? 'sitemap.xml'
        : 'manifest.webmanifest'
    return { router: 'app', kind: 'metadata', route: routeBelow(routeSegments, leaf), sourcePath: path }
  }

  const fileMetadata = `/${relative}`.match(APP_FILE_METADATA)
  if (fileMetadata) {
    const sourceFile = segments.at(-1)!
    const extension = sourceFile.slice(sourceFile.lastIndexOf('.'))
    const staticAsset = /^(?:\.ico|\.jpe?g|\.png|\.svg)$/i.test(extension)
    const leaf = staticAsset ? sourceFile : fileMetadata[1]!
    return { router: 'app', kind: 'metadata', route: routeBelow(routeSegments, leaf), sourcePath: path }
  }

  const system = `/${relative}`.match(APP_SYSTEM_FILE)
  if (system) {
    return { router: 'app', kind: 'system', route: routeBelow(routeSegments, `_${system[1]}`), sourcePath: path }
  }
  return null
}

function discoverPagesRoute(path: string): NextSourceRoute | null {
  const rootIndex = pagesRootIndex(path)
  if (rootIndex === null || !PAGES_ROUTE_FILE.test(path)) return null
  const segments = path.split('/')
  const relativeSegments = segments.slice(rootIndex + 1)
  const file = relativeSegments.pop()
  if (!file) return null
  const basename = file.replace(PAGES_ROUTE_FILE, '')
  if (['_app', '_document', '_error'].includes(basename)) return null

  const isApi = relativeSegments[0] === 'api'
  if (basename !== 'index') relativeSegments.push(basename)
  return {
    router: 'pages',
    kind: isApi ? 'route-handler' : 'page',
    route: routeFromSegments(relativeSegments),
    sourcePath: path,
  }
}

export function discoverNextSourceRoutes(paths: string[]): NextSourceRoute[] {
  const routes: NextSourceRoute[] = []
  for (const path of [...paths].sort()) {
    const appRoute = discoverAppRoute(path)
    if (appRoute) routes.push(appRoute)
    const conventionRoute = discoverAppConventionRoute(path)
    if (conventionRoute) routes.push(conventionRoute)
    const pagesRoute = discoverPagesRoute(path)
    if (pagesRoute) routes.push(pagesRoute)
  }
  return routes.sort((left, right) =>
    left.route.localeCompare(right.route) ||
    left.router.localeCompare(right.router) ||
    left.sourcePath.localeCompare(right.sourcePath),
  )
}
