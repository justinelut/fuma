import { ContactForm } from '@/components/contact-form'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'
import Link from 'next/link'

export const metadata = publicMetadata(
  'Security reporting',
  'Report a Fuma security concern and review the safe-reporting guidelines.',
  '/security',
)

const reportPath = [
  {
    step: 'Prepare',
    title: 'Reduce the report to what matters.',
    body: 'Name the affected public behavior, impact, and repeatable steps in plain text. Redact credentials and sensitive evidence before sending.',
  },
  {
    step: 'Report',
    title: 'Use the form on this page.',
    body: 'Send the concern through the security form. Keep passwords, secret keys, personal data, and live exploit payloads out of the message.',
  },
  {
    step: 'Confirm',
    title: 'Check the result.',
    body: 'An accepted form confirms that your message passed validation. It does not promise a response time, remediation, disclosure date, or reward.',
  },
] as const

const safePractice = [
  'Use your own account and data.',
  'Stop if another person’s data appears.',
  'Describe impact and repeatable steps in plain text.',
  'Keep credentials and sensitive evidence out of the form.',
] as const

const stopConditions = [
  'Do not disrupt service or bypass access controls.',
  'Do not run destructive, automated, or high-volume tests.',
  'Do not access, retain, or publish other people’s data.',
  'Do not send live secrets, malware, or exploit payloads.',
] as const

export default function Page() {
  return <PageMain className="!max-w-none !px-0 !py-0">
    <section aria-labelledby="security-title" className="section pt-16 sm:pt-24">
      <p className="eyebrow">Security reporting</p>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.58fr)] lg:items-end lg:gap-20">
        <h1 className="max-w-[16ch] font-display text-display-xl text-balance" id="security-title">
          A clear path for a serious report.
        </h1>
        <div className="lg:pb-1">
          <p className="max-w-xl text-lede text-muted-foreground text-pretty">
            Send only the information needed to explain the concern. This page shows what to include,
            what to leave out, and what to expect after submitting the form.
          </p>
          <a
            className="control-primary mt-8 inline-flex min-h-11 items-center rounded-control bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors"
            href="#report-security-concern"
          >Go to the reporting form</a>
        </div>
      </div>

      <figure className="mt-14 border-y border-line-strong sm:mt-16">
        <ol className="grid lg:grid-cols-3" aria-label="Security report path">
          {reportPath.map((item, index) => <li
            className="grid content-start border-b border-line-soft py-7 last:border-b-0 lg:border-b-0 lg:border-r lg:px-8 lg:last:border-r-0 lg:first:pl-0 lg:last:pr-0"
            key={item.step}
          >
            <div className="flex items-center gap-3 font-mono text-eyebrow uppercase text-muted-foreground">
              <span>{item.step}</span>
              {index < reportPath.length - 1 && <span aria-hidden="true" className="h-px flex-1 bg-line-strong" />}
            </div>
            <h2 className="mt-8 max-w-[18ch] font-display text-display-md">{item.title}</h2>
            <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">{item.body}</p>
          </li>)}
        </ol>
        <figcaption className="border-t border-line-soft py-4 font-mono text-xs leading-6 text-muted-foreground">
          Describe the concern <span aria-hidden="true">→</span> remove sensitive data <span aria-hidden="true">→</span> send the report
        </figcaption>
      </figure>
    </section>

    <section aria-labelledby="before-reporting" className="section">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1.12fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Before reporting</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="before-reporting">
            Keep the investigation safe.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
            A useful report is specific without creating more exposure. Preserve only the minimum
            context needed to explain the concern.
          </p>
        </div>
        <div className="grid border-y border-line-soft sm:grid-cols-2">
          <section aria-labelledby="safe-practice-title" className="py-7 sm:pr-8">
            <p className="font-mono text-eyebrow uppercase text-muted-foreground">Keep</p>
            <h3 className="mt-3 font-display text-display-md" id="safe-practice-title">Safe reporting practice</h3>
            <ul className="mt-6 grid gap-4 text-sm leading-6 text-muted-foreground">
              {safePractice.map((item) => <li className="border-l border-line-strong pl-4" key={item}>{item}</li>)}
            </ul>
          </section>
          <section aria-labelledby="stop-conditions-title" className="border-t border-line-soft py-7 sm:border-l sm:border-t-0 sm:pl-8">
            <p className="font-mono text-eyebrow uppercase text-muted-foreground">Stop</p>
            <h3 className="mt-3 font-display text-display-md" id="stop-conditions-title">Disclosure limits</h3>
            <ul className="mt-6 grid gap-4 text-sm leading-6 text-muted-foreground">
              {stopConditions.map((item) => <li className="border-l border-line-strong pl-4" key={item}>{item}</li>)}
            </ul>
          </section>
        </div>
      </div>
    </section>

    <section aria-labelledby="boundary-title" className="section">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.52fr)] lg:items-end lg:gap-20">
        <div>
          <p className="eyebrow">How to report</p>
          <h2 className="max-w-[17ch] font-display text-display-lg text-balance" id="boundary-title">
            Use the published form. Protect private contact details.
          </h2>
        </div>
        <p className="max-w-xl text-lede text-muted-foreground text-pretty lg:pb-1">
          Fuma provides a standard security.txt record for security tools and this page for people.
          Private recipient details are not published.
        </p>
      </div>

      <dl className="mt-12 border-y border-line-soft">
        <div className="grid gap-3 border-b border-line-soft py-7 sm:grid-cols-[minmax(12rem,0.48fr)_minmax(0,1fr)] sm:gap-12">
          <dt className="font-display text-display-md">Machine-readable route</dt>
          <dd className="max-w-2xl text-sm leading-7 text-muted-foreground sm:pt-1">
            <Link
              className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4"
              href="/.well-known/security.txt"
            >/.well-known/security.txt</Link>{' '}
            names this page as both the contact and policy location and declares English as the
            preferred language.
          </dd>
        </div>
        <div className="grid gap-3 border-b border-line-soft py-7 sm:grid-cols-[minmax(12rem,0.48fr)_minmax(0,1fr)] sm:gap-12">
          <dt className="font-display text-display-md">Human-readable route</dt>
          <dd className="max-w-2xl text-sm leading-7 text-muted-foreground sm:pt-1">
            This page provides reporting guidance and the maintained security contact form.
            The form checks required fields before accepting the message.
          </dd>
        </div>
        <div className="grid gap-3 py-7 sm:grid-cols-[minmax(12rem,0.48fr)_minmax(0,1fr)] sm:gap-12">
          <dt className="font-display text-display-md">Claims not made here</dt>
          <dd className="max-w-2xl text-sm leading-7 text-muted-foreground sm:pt-1">
            This route is not a certification, audit statement, safe-harbour programme, bounty,
            service-level agreement, or promise of delivery, response, remediation, or disclosure timing.
          </dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="report-security-concern" className="section border-t border-border">
      <div className="grid gap-10 lg:grid-cols-[minmax(18rem,0.58fr)_minmax(0,1.12fr)] lg:gap-20">
        <div>
          <p className="eyebrow">Report</p>
          <h2 className="max-w-[14ch] font-display text-display-lg text-balance" id="report-security-concern">
            Send the minimum useful detail.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
            Keep a local copy. If the route reports that it is unavailable, the message was not
            confirmed as accepted and should be tried again later.
          </p>
          <nav aria-label="Related trust routes" className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link className="min-h-11 py-2 underline decoration-signal decoration-2 underline-offset-4" href="/trust">Trust centre</Link>
            <Link className="min-h-11 py-2 underline decoration-signal decoration-2 underline-offset-4" href="/legal/privacy">Privacy notice</Link>
            <Link className="min-h-11 py-2 underline decoration-signal decoration-2 underline-offset-4" href="/contact">Other contact routes</Link>
          </nav>
        </div>
        <div className="min-w-0 lg:-mt-8">
          <ContactForm kind="security" />
        </div>
      </div>
    </section>
  </PageMain>
}
