import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Trust centre',
  'Inspect Fuma public-site security, privacy, policy, contact, and status boundaries without compliance or uptime claims.',
  '/trust',
)

const boundaries = [
  ['Host and session boundary', 'The public site does not issue product, identity, administration, member, or tenant sessions. Public submissions use same-origin server routes.'],
  ['Contact boundary', 'Contact bodies are size-limited and strictly validated. Process-local replay, rate, timing, and honeypot checks run before a private routing attempt.'],
  ['Status boundary', 'Only fresh, schema-valid authority data is shown. Missing, stale, redirected, oversized, or malformed data becomes an explicit unavailable state.'],
  ['Measurement choice', 'Optional public-site measurement remains off until chosen and is suppressed by Global Privacy Control or Do Not Track.'],
  ['Policy maintenance', 'Each current notice displays its version, effective date, review date, and responsible review role. The history page does not invent superseded versions.'],
  ['Launch approval', 'Repository controls are not a certification. Legal, privacy, security, accessibility, operations, and production launch approvals remain separate gates.'],
] as const

export default function Page() {
  return <PageMain>
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Trust centre</p>
    <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">Inspect the boundary, not a badge.</h1>
    <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">These pages describe repository-backed public-site behavior. Fuma does not claim a certification, compliance outcome, service-level agreement, uptime history, incident record, provider relationship, or guaranteed contact delivery here.</p>
    <div className="mt-10 grid gap-4 md:grid-cols-2">
      {boundaries.map(([title, body]) => <Card className="border" key={title}>
        <CardHeader><CardTitle className="text-xl">{title}</CardTitle></CardHeader>
        <CardContent><p className="leading-7 text-muted-foreground">{body}</p></CardContent>
      </Card>)}
    </div>
    <nav aria-label="Trust and policy resources" className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
      <a className="min-h-11 py-2 underline underline-offset-4" href="/security">Security reporting</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/status">Service status</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/contact">Contact</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/privacy-request">Privacy request</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/legal/privacy">Privacy notice</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/legal/terms">Website terms</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/legal/cookies">Cookies and storage</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/legal/acceptable-use">Acceptable use</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/legal/history">Policy history</a>
    </nav>
  </PageMain>
}
