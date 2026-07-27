import { Value } from '@sinclair/typebox/value'
import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import budgetsSource from '../public-web-budgets.json'
import { PublicWebBudgetsSchema } from '../lib/public-web-contracts'

if (!Value.Check(PublicWebBudgetsSchema, budgetsSource)) {
  throw new Error('The public Web budget manifest is invalid.')
}

const budgets = budgetsSource

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NEXT = path.join(ROOT, '.next')
const ROUTES = ['/', '/website', '/publication', '/features', '/solutions', '/about'] as const
const IMAGE_PATTERN = /(?:src|href)=["']([^"']+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^"']*)?)["']/gi
const FONT_PATTERN = /\.(?:otf|ttf|woff2?)$/i

type RouteStat = {
  route: string
  firstLoadChunkPaths: string[]
}

type Measurement = {
  route: string
  javascriptGzipBytes: number
  imageBytes: number
}

async function filesBelow(directory: string): Promise<string[]> {
  const output: string[] = []
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return output
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await filesBelow(absolute))
    else output.push(absolute)
  }
  return output
}

function htmlPath(route: string): string {
  return path.join(NEXT, 'server', 'app', route === '/' ? 'index.html' : `${route.slice(1)}.html`)
}

async function imageBytesForRoute(route: string): Promise<number> {
  const html = await fs.readFile(htmlPath(route), 'utf8')
  const assets = new Set(Array.from(html.matchAll(IMAGE_PATTERN), (match) => match[1]!.split('?')[0]!))
  let total = 0
  for (const asset of assets) {
    if (asset.startsWith('data:') || /^https?:\/\//.test(asset)) continue
    const relative = asset.startsWith('/_next/')
      ? path.join('.next', asset.slice('/_next/'.length))
      : path.join('public', asset.replace(/^\//, ''))
    const info = await fs.stat(path.join(ROOT, relative)).catch(() => null)
    if (info?.isFile()) total += info.size
  }
  return total
}

export async function measurePublicWebBudgets() {
  const stats = JSON.parse(await fs.readFile(path.join(NEXT, 'diagnostics', 'route-bundle-stats.json'), 'utf8')) as RouteStat[]
  const byRoute = new Map(stats.map((entry) => [entry.route, entry]))
  const measurements: Measurement[] = []

  for (const route of ROUTES) {
    const stat = byRoute.get(route)
    if (!stat) throw new Error(`Missing production bundle diagnostics for ${route}.`)
    const javascriptGzipBytes = stat.firstLoadChunkPaths.reduce((sum, chunk) => {
      return sum + gzipSync(readFileSync(path.join(ROOT, chunk))).byteLength
    }, 0)
    measurements.push({ route, javascriptGzipBytes, imageBytes: await imageBytesForRoute(route) })
  }

  const fontFiles = (await filesBelow(path.join(NEXT, 'static')))
    .concat(await filesBelow(path.join(ROOT, 'public')))
    .filter((file) => FONT_PATTERN.test(file))
  const fontBytes = (await Promise.all(fontFiles.map(async (file) => (await fs.stat(file)).size)))
    .reduce((sum, size) => sum + size, 0)

  const report = {
    generatedBy: 'scripts/check-public-web-budgets.ts',
    semantics: {
      javascript: 'gzip-compressed first-load chunks emitted by the production Next build',
      images: 'unique emitted image assets referenced by each prerendered route',
      fonts: 'emitted local font files shared by public routes',
    },
    budgets,
    routes: measurements,
    fontBytes,
  }

  await fs.writeFile(
    path.join(NEXT, 'diagnostics', 'public-web-budget-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )

  const failures = measurements.flatMap((measurement) => [
    ...(measurement.javascriptGzipBytes > budgets.javascriptBytes
      ? [`${measurement.route} JavaScript ${measurement.javascriptGzipBytes} > ${budgets.javascriptBytes}`]
      : []),
    ...(measurement.imageBytes > budgets.imageBytesPerRoute
      ? [`${measurement.route} images ${measurement.imageBytes} > ${budgets.imageBytesPerRoute}`]
      : []),
  ])
  if (fontBytes > budgets.fontBytes) failures.push(`fonts ${fontBytes} > ${budgets.fontBytes}`)
  if (failures.length > 0) throw new Error(`Public Web budget exceeded:\n${failures.join('\n')}`)

  return report
}

if (import.meta.main) {
  const report = await measurePublicWebBudgets()
  for (const route of report.routes) {
    console.log(`${route.route}: ${route.javascriptGzipBytes} B gzip JS, ${route.imageBytes} B images`)
  }
  console.log(`shared fonts: ${report.fontBytes} B`)
}
