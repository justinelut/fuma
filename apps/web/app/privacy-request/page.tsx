import { ContactForm } from '@/components/contact-form'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Privacy request',
  'Send a minimized privacy request through the Fuma public server boundary.',
  '/privacy-request',
  true,
)

export default function Page() {
  return <PageMain className="max-w-4xl">
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Privacy request</p>
    <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Ask about your information</h1>
    <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">Use this route to request access, correction, deletion, or clarification. State the request and the account or interaction you can identify without sending passwords, identity documents, payment data, or sensitive records.</p>
    <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">A separate verification process may be required. Submission does not confirm identity, eligibility, completion, deletion, a legal deadline, or a response time. See the <a className="underline underline-offset-4" href="/legal/privacy">current privacy notice</a> for this public website.</p>
    <ContactForm kind="privacy" />
  </PageMain>
}
