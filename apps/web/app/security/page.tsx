import { ContactForm } from '@/components/contact-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageMain } from '@/components/site-shell'
import { publicMetadata } from '@/lib/seo'

export const metadata = publicMetadata(
  'Security reporting',
  'Guidance and a bounded route for reporting a Fuma security concern without a certification or response-time claim.',
  '/security',
)

export default function Page() {
  return <PageMain className="max-w-4xl">
    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Security reporting</p>
    <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Report a security concern carefully</h1>
    <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">Use the minimum information needed to describe the affected public behavior. The form being available does not confirm delivery, acknowledgement, eligibility, safe harbour, remediation, disclosure timing, or a reward.</p>
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      <Card className="border"><CardHeader><CardTitle>Do</CardTitle></CardHeader><CardContent><ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground"><li>Use your own account and data.</li><li>Stop if another person’s data appears.</li><li>Describe impact and repeatable steps in plain text.</li><li>Keep credentials and sensitive evidence out of the form.</li></ul></CardContent></Card>
      <Card className="border"><CardHeader><CardTitle>Do not</CardTitle></CardHeader><CardContent><ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground"><li>Disrupt service or bypass access controls.</li><li>Run destructive, automated, or high-volume tests.</li><li>Access, retain, or publish other people’s data.</li><li>Send live secrets, malware, or exploit payloads.</li></ul></CardContent></Card>
    </div>
    <ContactForm kind="security" />
  </PageMain>
}
