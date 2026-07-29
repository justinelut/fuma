import { createHash } from 'node:crypto'
import type { SiteRuntimeLegacyDocument } from '../lib/contracts'

function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
function attribute(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') }
function scriptSource(value: string): string { return value.replace(/<\/script/gi, '<\\/script') }

function srcDocument(document: SiteRuntimeLegacyDocument): string {
  if (hash(document.html) !== document.contentHashSha256) throw new TypeError('Legacy HTML integrity changed in transit.')
  for (const script of document.scripts) if (hash(script.source) !== script.contentHashSha256) throw new TypeError('Legacy script integrity changed in transit.')
  const policy = `<meta http-equiv="Content-Security-Policy" content="${attribute(document.csp)}">`
  const scripts = document.scripts.map((script) => `<script data-fuma-legacy-script="${attribute(script.logicalPath)}">${scriptSource(script.source)}</script>`).join('')
  if (/<html[\s>]/i.test(document.html)) {
    let html = /<head[\s>]/i.test(document.html)
      ? document.html.replace(/(<head[^>]*>)/i, `$1${policy}`)
      : document.html.replace(/(<html[^>]*>)/i, `$1<head>${policy}</head>`)
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${scripts}</body>`) : `${html}${scripts}`
    return html
  }
  return `<!doctype html><html><head>${policy}<meta name="referrer" content="no-referrer"></head><body>${document.html}${scripts}</body></html>`
}

export function LegacyCompatibilityFrame({ document, title }: Readonly<{ document: SiteRuntimeLegacyDocument; title: string }>) {
  return (
    <iframe
      data-fuma-legacy-release={document.releaseId}
      data-fuma-legacy-route={document.route}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      title={`${title} (legacy compatibility)`}
      srcDoc={srcDocument(document)}
      style={{ border: 0, display: 'block', minHeight: '100vh', width: '100%' }}
    />
  )
}
