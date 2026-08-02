import Link from 'next/link'

import { ContactForm } from '@/components/contact-form'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Privacy request',
  'Prepare and send a minimized Fuma privacy request through the bounded public route.',
  '/privacy-request',
  true,
)

const requestPath = [
  {
    stage: 'Choose',
    title: 'Name the request.',
    body: 'Start with access, correction, deletion, or another privacy concern so the request has one clear purpose.',
  },
  {
    stage: 'Minimize',
    title: 'Add one useful locator.',
    body: 'Use the least information that identifies the account, site, or interaction you mean. Do not send identity documents in advance.',
  },
  {
    stage: 'Route',
    title: 'Read the result literally.',
    body: 'The form checks the required details before accepting your request. An accepted result confirms submission, not eligibility or completion.',
  },
] as const

const requestTypes = [
  {
    label: 'Access',
    prompt: 'Ask for access to personal information associated with a Fuma account or interaction you can identify.',
  },
  {
    label: 'Correction',
    prompt: 'Name the information you believe is inaccurate and state the correction you are requesting.',
  },
  {
    label: 'Deletion',
    prompt: 'Identify the information or interaction you want considered for deletion and keep the scope specific.',
  },
  {
    label: 'Clarification or another concern',
    prompt: 'Ask a focused question about how information connected to your Fuma interaction is handled.',
  },
] as const

const evidenceSignature = [
  {
    term: 'Request',
    detail: 'Use one label: access, correction, deletion, or another privacy concern.',
  },
  {
    term: 'Locator',
    detail: 'Use one account, site, reply address, or interaction detail you already recognize—whichever reveals the least.',
  },
  {
    term: 'Scope',
    detail: 'Name the record, field, date range, or interaction the request is about and the outcome you are asking Fuma to consider.',
  },
] as const

const keepOut = [
  'Passwords, recovery codes, secret keys, or session details',
  'Government identity documents or identity numbers',
  'Payment details, financial records, or unrelated sensitive information',
  'Another person’s information or complete message histories when one reference is enough',
] as const

export default function Page() {
  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="privacy-request-title" className="section pt-16 sm:pt-24">
      <p className="eyebrow">Privacy request</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(19rem,0.6fr)] lg:items-end lg:gap-20">
        <h1 className="max-w-[15ch] font-display text-display-xl text-balance" id="privacy-request-title">
          Ask about your information. Share only what locates it.
        </h1>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Choose the narrowest request, identify the Fuma account or interaction with the least
            detail that may be useful, and keep identity documents and sensitive records out of
            this public form.
          </p>
          <nav aria-label="Privacy request entry points" className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            <a className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="#send-privacy-request">Go to the request form</a>
            <Link className="min-h-11 py-2 text-sm font-medium underline decoration-signal decoration-2 underline-offset-4" href="/legal/privacy">Read the privacy notice</Link>
          </nav>
        </div>
      </div>

      <figure className="mt-14 border-y border-line-strong sm:mt-16" data-privacy-request-path>
        <ol aria-label="Privacy request path" className="grid lg:grid-cols-3">
          {requestPath.map((item, index) => <li
            className="grid content-start border-b border-line-soft py-7 last:border-b-0 lg:border-b-0 lg:border-r lg:px-8 lg:last:border-r-0 lg:first:pl-0 lg:last:pr-0"
            key={item.stage}
          >
            <div className="flex items-center gap-3 font-mono text-eyebrow uppercase text-muted-foreground">
              <span>{item.stage}</span>
              {index < requestPath.length - 1 && <span aria-hidden="true" className="h-px flex-1 bg-line-strong" />}
            </div>
            <h2 className="mt-8 max-w-[16ch] font-display text-display-md">{item.title}</h2>
            <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">{item.body}</p>
          </li>)}
        </ol>
        <figcaption className="border-t border-line-soft py-4 font-mono text-xs leading-6 text-muted-foreground">
          Your request <span aria-hidden="true">→</span> bounded public form <span aria-hidden="true">→</span> private routing attempt. Identity verification, eligibility, legal determination, and completion remain separate.
        </figcaption>
      </figure>
    </section>

    <section aria-labelledby="request-type-title" className="section">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.6fr)_minmax(0,1.12fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Choose one path</p>
          <h2 className="max-w-[13ch] font-display text-display-lg text-balance" id="request-type-title">
            Put the request type first.
          </h2>
          <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
            Begin the message with one of these labels. If more than one applies, explain the
            relationship briefly rather than copying the same evidence several times.
          </p>
        </div>
        <dl className="border-t border-line-soft">
          {requestTypes.map((item) => <div className="grid gap-2 border-b border-line-soft py-6 sm:grid-cols-[minmax(10rem,0.48fr)_minmax(0,1fr)] sm:gap-10" key={item.label}>
            <dt className="font-display text-xl">{item.label}</dt>
            <dd className="max-w-2xl text-sm leading-7 text-muted-foreground">{item.prompt}</dd>
          </div>)}
        </dl>
      </div>
    </section>

    <section aria-labelledby="minimum-evidence-title" className="section border-y border-border" data-minimum-evidence-signature>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.58fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Minimum evidence signature</p>
          <h2 className="max-w-[15ch] font-display text-display-lg text-balance" id="minimum-evidence-title">
            Three lines are usually a better starting point than a file of evidence.
          </h2>
          <p className="mt-6 max-w-2xl text-lede text-muted-foreground text-pretty">
            Write the message as a request, one locator, and a narrow scope. Fuma may require a
            separate verification step; do not try to complete that step in advance through this form.
          </p>

          <dl className="mt-10 border-y border-line-soft">
            {evidenceSignature.map((item) => <div className="grid gap-3 border-b border-line-soft py-6 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-8" key={item.term}>
              <dt className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">{item.term}</dt>
              <dd className="max-w-2xl text-sm leading-7">{item.detail}</dd>
            </div>)}
          </dl>
        </div>

        <aside aria-labelledby="keep-out-title" className="border-t border-line-strong pt-6 lg:mt-2">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground">Keep outside the envelope</p>
          <h3 className="mt-3 font-display text-display-md" id="keep-out-title">Do not paste these into the form.</h3>
          <ul className="mt-7 grid gap-4 text-sm leading-7 text-muted-foreground">
            {keepOut.map((item) => <li className="border-l border-line-strong pl-4" key={item}>{item}</li>)}
          </ul>
          <p className="mt-7 border-t border-line-soft pt-6 text-sm leading-7 text-muted-foreground">
            If one locator is not enough, a separate follow-up may ask for another verification
            step. This public page does not confirm identity or decide what information may be available.
          </p>
        </aside>
      </div>
    </section>

    <section aria-labelledby="send-privacy-request" className="section">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1.12fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Send</p>
          <h2 className="max-w-[13ch] font-display text-display-lg text-balance" id="send-privacy-request">
            Send the minimized request.
          </h2>
          <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
            The form requires a name and reply address, validates a bounded message, and attempts
            private routing without publishing or letting you choose a recipient.
          </p>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
            Submission does not confirm identity, delivery, eligibility, a legal outcome,
            completion, or a response schedule. Keep a local copy until the form reports that the
            request was accepted for routing.
          </p>
          <nav aria-label="Privacy and legal resources" className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link className="min-h-11 py-2 underline decoration-signal decoration-2 underline-offset-4" href="/legal/privacy">Current privacy notice</Link>
            <Link className="min-h-11 py-2 underline decoration-signal decoration-2 underline-offset-4" href="/legal">Legal and policies</Link>
            <Link className="min-h-11 py-2 underline decoration-signal decoration-2 underline-offset-4" href="/trust">Trust centre</Link>
            <Link className="min-h-11 py-2 underline decoration-signal decoration-2 underline-offset-4" href="/contact">Other contact routes</Link>
          </nav>
        </div>
        <div className="min-w-0 lg:-mt-8">
          <ContactForm kind="privacy" />
        </div>
      </div>
    </section>
  </PageMain>
}
