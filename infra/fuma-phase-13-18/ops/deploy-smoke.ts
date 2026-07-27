import { readFile } from 'node:fs/promises'

if (!process.argv.includes('--dry-run') && process.env.FUMA_SMOKE_APPROVED !== 'true') throw new Error('Deploy smoke requires --dry-run planning or explicit FUMA_SMOKE_APPROVED=true.')
const configPath = process.argv.find((value) => value.startsWith('--config='))?.slice('--config='.length)
if (!configPath) throw new Error('--config=<targets.json> is required.')
const config = JSON.parse(await readFile(configPath, 'utf8')) as { targets: readonly { name: string; url: string; expectedStatus: number; mustContain: string; cookiesAllowed: boolean }[] }
for (const target of config.targets) {
  const url = new URL(target.url)
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error(`Smoke target ${target.name} must use approved public HTTPS.`)
}
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ mode: 'dry-run', targets: config.targets.map(({ name, url }) => ({ name, origin: new URL(url).origin })), networkRequests: 0 }))
  process.exit(0)
}
const results = []
for (const target of config.targets) {
  const started = performance.now()
  const response = await fetch(target.url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'fuma-deploy-smoke/1' } })
  const body = await response.text()
  const setCookie = response.headers.get('set-cookie') ?? ''
  if (response.status !== target.expectedStatus || !body.includes(target.mustContain)) throw new Error(`${target.name} status/content smoke failed.`)
  if (/\bdomain=/i.test(setCookie) || (!target.cookiesAllowed && setCookie)) throw new Error(`${target.name} emitted a forbidden or parent-domain cookie.`)
  results.push({ name: target.name, status: response.status, durationMilliseconds: Math.round(performance.now() - started), bodyHashSha256: new Bun.CryptoHasher('sha256').update(body).digest('hex'), setCookiePresent: Boolean(setCookie) })
}
console.log(JSON.stringify({ mode: 'approved-network-smoke', browserAcceptance: false, results }))
