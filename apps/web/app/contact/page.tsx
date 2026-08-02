import { ContactForm } from '@/components/contact-form'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'
import Link from 'next/link'

export const metadata = publicMetadata(
  'Contact',
  'Choose the right Fuma contact form and send only the details needed to help.',
  '/contact',
)

const intakeSignature = [
  {
    term: 'Route',
    detail: 'Choose one concern class. General and abuse intake stay separate; security and privacy use dedicated pages.',
  },
  {
    term: 'Expectation',
    detail: 'Send the minimum useful context, a reply address, and no passwords, secret keys, identity documents, or payment details.',
  },
  {
    term: 'Privacy',
    detail: 'The form asks only for the details needed to understand your message and reply.',
  },
] as const

const resultKey = [
  {
    term: 'Consent',
    detail: 'Each form states what Fuma processes for the request and links the effective privacy notice before the send action.',
  },
  {
    term: 'Accepted',
    detail: 'Your form was accepted. Keep a copy of your message because this does not promise a response time.',
  },
  {
    term: 'Error or unavailable',
    detail: 'Acceptance is not confirmed. Follow the form guidance, keep a local copy, and retry only when the route permits it.',
  },
] as const

export default function Page() {
  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="contact-title" className="section pt-16 sm:pt-24">
      <p className="eyebrow">Contact intake</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(19rem,0.58fr)] lg:items-end lg:gap-20">
        <h1 className="max-w-[15ch] font-display text-display-xl text-balance" id="contact-title">
          Start with the route. Keep the message narrow.
        </h1>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Choose the topic that best matches your question, then send only the details needed to help.
          </p>
          <a
            className="control-primary mt-8 inline-flex min-h-11 items-center rounded-control bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors"
            href="#choose-contact-route"
          >Choose a contact route</a>
        </div>
      </div>

      <figure className="mt-14 border-y border-line-strong sm:mt-16">
        <dl className="grid lg:grid-cols-3">
          {intakeSignature.map((item) => <div
            className="border-b border-line-soft py-7 last:border-b-0 lg:border-b-0 lg:border-r lg:px-8 lg:last:border-r-0 lg:first:pl-0 lg:last:pr-0"
            key={item.term}
          >
            <dt className="font-mono text-eyebrow uppercase text-muted-foreground">{item.term}</dt>
            <dd className="mt-5 max-w-md text-sm leading-7">{item.detail}</dd>
          </div>)}
        </dl>
        <figcaption className="border-t border-line-soft py-4 font-mono text-xs leading-6 text-muted-foreground">
          Choose a topic <span aria-hidden="true">→</span> write your message <span aria-hidden="true">→</span> send
        </figcaption>
      </figure>
    </section>

    <section aria-labelledby="choose-contact-route" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Route directory</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="choose-contact-route">
            One concern, one intake path.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
            Do not duplicate a request across routes. The specialist paths carry guidance specific
            to security disclosure and privacy rights.
          </p>
        </div>

        <nav aria-label="Contact routes">
          <ul className="border-t border-line-soft">
            <li className="border-b border-line-soft">
              <a className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(9rem,0.48fr)_minmax(0,1fr)_auto] sm:items-baseline sm:gap-8" href="#general-contact">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">General</span>
                <span className="text-sm leading-6 text-muted-foreground">A product or general question that is not a specialist concern.</span>
                <span className="font-mono text-xs uppercase text-muted-foreground">Form below</span>
              </a>
            </li>
            <li className="border-b border-line-soft">
              <a className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(9rem,0.48fr)_minmax(0,1fr)_auto] sm:items-baseline sm:gap-8" href="#abuse-contact">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Abuse</span>
                <span className="text-sm leading-6 text-muted-foreground">Suspected abuse identified by a public URL or stable identifier.</span>
                <span className="font-mono text-xs uppercase text-muted-foreground">Form below</span>
              </a>
            </li>
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(9rem,0.48fr)_minmax(0,1fr)_auto] sm:items-baseline sm:gap-8" href="/security">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Security</span>
                <span className="text-sm leading-6 text-muted-foreground">A possible vulnerability or security concern requiring safe reporting guidance.</span>
                <span className="font-mono text-xs uppercase text-muted-foreground">Dedicated route</span>
              </Link>
            </li>
            <li className="border-b border-line-soft">
              <Link className="group grid min-h-11 gap-2 py-5 sm:grid-cols-[minmax(9rem,0.48fr)_minmax(0,1fr)_auto] sm:items-baseline sm:gap-8" href="/privacy-request">
                <span className="font-display text-xl underline-offset-4 group-hover:underline">Privacy</span>
                <span className="text-sm leading-6 text-muted-foreground">Access, correction, deletion, or another privacy concern.</span>
                <span className="font-mono text-xs uppercase text-muted-foreground">Dedicated route</span>
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </section>

    <section aria-labelledby="result-key-title" className="section">
      <div className="grid gap-8 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Before sending</p>
          <h2 className="max-w-[13ch] font-display text-display-lg text-balance" id="result-key-title">
            Read the result literally.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
            The forms explain what information is needed and show whether your message was accepted.
            Acceptance does not promise a response time.
          </p>
        </div>
        <dl className="border-y border-line-soft">
          {resultKey.map((item) => <div
            className="grid gap-3 border-b border-line-soft py-6 last:border-b-0 sm:grid-cols-[minmax(9rem,0.42fr)_minmax(0,1fr)] sm:gap-10"
            key={item.term}
          >
            <dt className="font-display text-xl">{item.term}</dt>
            <dd className="max-w-2xl text-sm leading-7 text-muted-foreground">{item.detail}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <section aria-labelledby="general-contact" className="section border-t border-border">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1.12fr)] lg:gap-20">
        <div>
          <p className="eyebrow">General route</p>
          <h2 className="max-w-[13ch] font-display text-display-lg text-balance" id="general-contact">
            General question
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
            Ask one clear product or general question. Include only the context needed to understand
            the request, and keep a local copy before sending.
          </p>
          <p className="mt-5 max-w-md border-l border-line-strong pl-4 text-sm leading-7 text-muted-foreground">
            Security disclosures and privacy requests belong on their dedicated routes above.
          </p>
        </div>
        <div className="min-w-0 lg:-mt-8">
          <ContactForm kind="general" />
        </div>
      </div>
    </section>

    <section aria-labelledby="abuse-contact" className="section border-t border-border">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1.12fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Abuse route</p>
          <h2 className="max-w-[13ch] font-display text-display-lg text-balance" id="abuse-contact">
            Abuse report
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
            Include only the public URL or identifier and a concise reason. Do not copy harmful
            content or unrelated personal data into the report.
          </p>
          <p className="mt-5 max-w-md border-l border-line-strong pl-4 text-sm leading-7 text-muted-foreground">
            One precise reference is safer and more useful than reproducing the material.
          </p>
        </div>
        <div className="min-w-0 lg:-mt-8">
          <ContactForm kind="abuse" />
        </div>
      </div>
    </section>
  </PageMain>
}
