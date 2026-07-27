import { ContactForm } from '@/components/contact-form'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Contact',
  'Send a bounded general or abuse request through the Fuma public server boundary.',
  '/contact',
)

export default function Page() {
  return <PageMain className="max-w-4xl">
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Contact</p>
    <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Choose the narrowest route</h1>
    <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">The public Web service validates requests and attempts private routing. It does not expose a recipient, send directly to a provider, or promise delivery or response time. Security and privacy concerns have dedicated routes.</p>
    <nav aria-label="Specialist contact routes" className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
      <a className="min-h-11 py-2 underline underline-offset-4" href="/security">Security concern</a>
      <a className="min-h-11 py-2 underline underline-offset-4" href="/privacy-request">Privacy request</a>
    </nav>
    <section aria-labelledby="general-contact" className="mt-10">
      <h2 id="general-contact" className="text-2xl font-semibold">General question</h2>
      <ContactForm kind="general" />
    </section>
    <section aria-labelledby="abuse-contact" className="mt-14">
      <h2 id="abuse-contact" className="text-2xl font-semibold">Abuse report</h2>
      <p className="mt-3 leading-7 text-muted-foreground">Include only the public URL or identifier and a concise reason. Do not copy harmful content or unrelated personal data.</p>
      <ContactForm kind="abuse" />
    </section>
  </PageMain>
}
