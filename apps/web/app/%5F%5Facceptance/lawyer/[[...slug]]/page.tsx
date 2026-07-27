import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import manifest from '../../../../../../packages/fuma-governance-launch/fixtures/lawyer/design-conversion.json'

type LawyerAcceptancePageProps = Readonly<{
  params: Promise<{ slug?: string[] }>
}>

export default async function LawyerAcceptancePage({ params }: LawyerAcceptancePageProps) {
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')?.split(':')[0]?.toLowerCase()
  const attestedAcceptanceProxy = process.env.FUMA_BLYSS_ACCEPTANCE_PROXY === '1'
    && host === '127.0.0.1'
    && requestHeaders.get('x-forwarded-proto') === 'https'
    && requestHeaders.get('cdn-loop')?.split(';', 1)[0]?.trim().toLowerCase() === 'cloudflare'
    && /^[a-f0-9]{16,32}-[A-Z]{3}$/.test(requestHeaders.get('cf-ray') ?? '')
    && requestHeaders.get('cf-visitor') === '{"scheme":"https"}'
  if (host !== '3002.blyss.co.ke' && !attestedAcceptanceProxy) notFound()

  const { slug = [] } = await params
  const route = slug.length === 0 ? '/' : `/${slug.join('/')}`
  const binding = manifest.routeBindings.find((candidate) => candidate.route === route)
  if (!binding) notFound()

  const gated = binding.accessBinding !== 'public'
  return (
    <main
      id="main-content"
      className="mx-auto grid min-h-svh w-full max-w-5xl content-center gap-8 px-6 py-16"
      data-fuma-template={binding.templateId}
      data-fuma-access={binding.accessBinding}
    >
      <header className="grid gap-3">
        <p className="font-mono text-sm uppercase tracking-[0.18em] text-muted-foreground">Lawyer conversion acceptance</p>
        <h1 className="text-fuma-display font-semibold leading-tight">{route === '/' ? 'The Lawyer' : route.slice(1).replaceAll('-', ' ')}</h1>
      </header>
      {gated && <p role="status">Sign in to continue with your membership or subscription.</p>}
      {binding.loopIds.map((loopId) => (
        <section key={loopId} data-fuma-loop={loopId} aria-label={loopId.replaceAll('-', ' ')}>
          <h2 className="text-xl font-semibold">{loopId.replaceAll('-', ' ')}</h2>
        </section>
      ))}
    </main>
  )
}
