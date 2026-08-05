import { useEffect, useRef, useState } from 'react'
import type { PublicMarketingRange, PublicMarketingReport } from '@core/fuma/publicAnalytics/contracts'
import { Button } from '@ui/components/Button'
import { DataTable } from '@ui/components/DataTable'
import { FormField } from '@ui/components/FormField'
import { Input } from '@ui/components/Input'
import type { PublicMarketingAnalyticsHttpClient } from './client'
import styles from './PublicMarketingAnalyticsDashboard.module.css'

const DAY_MS = 86_400_000

type Props = Readonly<{ client: Pick<PublicMarketingAnalyticsHttpClient, 'report'> }>

function initialRange(): PublicMarketingRange {
  const now = new Date()
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Object.freeze({
    from: new Date(end - 30 * DAY_MS).toISOString().slice(0, 10),
    to: new Date(end).toISOString().slice(0, 10),
  })
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return <article className={styles.metric}><h3>{label}</h3><strong>{value.toLocaleString()}</strong></article>
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`
}

export function PublicMarketingAnalyticsDashboard({ client }: Props) {
  const [range, setRange] = useState<PublicMarketingRange>(initialRange)
  const initialRangeRef = useRef(range)
  const [report, setReport] = useState<PublicMarketingReport | null>(null)
  const [message, setMessage] = useState('Loading privacy-preserving marketing analytics…')
  const [busy, setBusy] = useState(true)

  const load = async (value: PublicMarketingRange) => {
    setBusy(true)
    try {
      setReport(await client.report(value))
      setMessage(`Loaded ${value.from} through ${value.to} (end-exclusive).`)
    } catch {
      setMessage('Marketing analytics are temporarily unavailable.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let active = true
    const value = initialRangeRef.current
    queueMicrotask(async () => {
      try {
        const next = await client.report(value)
        if (!active) return
        setReport(next)
        setMessage(`Loaded ${value.from} through ${value.to} (end-exclusive).`)
      } catch {
        if (active) setMessage('Marketing analytics are temporarily unavailable.')
      } finally {
        if (active) setBusy(false)
      }
    })
    return () => { active = false }
  }, [client])

  return <section aria-labelledby="marketing-analytics-title" className={styles.root}>
    <header className={styles.header}><p className={styles.eyebrow}>Platform acquisition</p><h2 id="marketing-analytics-title" className={styles.title}>Privacy-preserving funnel</h2><p className={styles.description}>Aggregate first-party measurement only. No IP, URL, referrer, identity, tenant, member, payment, staff, session, or fingerprint data is retained.</p></header>
    <form aria-label="Marketing analytics date range" className={styles.rangeForm} onSubmit={(event) => { event.preventDefault(); void load(range) }}>
      <FormField label="From (UTC)" htmlFor="marketing-analytics-from"><Input id="marketing-analytics-from" type="date" required value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} /></FormField>
      <FormField label="To, end-exclusive (UTC)" htmlFor="marketing-analytics-to"><Input id="marketing-analytics-to" type="date" required value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} /></FormField>
      <Button type="submit" variant="primary" disabled={busy}>Refresh report</Button>
    </form>
    <p className={styles.status} role="status" aria-live="polite">{message}</p>
    {report ? <>
      <div aria-label="Marketing event totals" className={styles.metricGrid}><Metric label="Cookieless page views" value={report.totals.pageViews} /><Metric label="Consented handoffs" value={report.totals.handoffs} /><Metric label="First publishes" value={report.totals.publishes} /><Metric label="Paid conversions" value={report.totals.paid} /></div>
      <DataTable><caption className={styles.caption}>Opaque handoff cohort funnel</caption><thead><tr><th scope="col">Stage</th><th scope="col">Reached</th><th scope="col">Previous-stage conversion</th></tr></thead><tbody>
        <tr><th scope="row">Visit / handoff</th><td>{report.funnel.visits}</td><td>—</td></tr>
        <tr><th scope="row">Signup</th><td>{report.funnel.signups}</td><td>{percent(report.conversionBasisPoints.visitToSignup)}</td></tr>
        <tr><th scope="row">Site created</th><td>{report.funnel.sites}</td><td>{percent(report.conversionBasisPoints.signupToSite)}</td></tr>
        <tr><th scope="row">First publish</th><td>{report.funnel.publishes}</td><td>{percent(report.conversionBasisPoints.siteToPublish)}</td></tr>
        <tr><th scope="row">Paid</th><td>{report.funnel.paid}</td><td>{percent(report.conversionBasisPoints.publishToPaid)}</td></tr>
      </tbody></DataTable>
      <DataTable><caption className={styles.caption}>Coarse route classes</caption><thead><tr><th scope="col">Route class</th><th scope="col">Page views</th><th scope="col">Handoffs</th></tr></thead><tbody>
        {report.routes.map((row) => <tr key={row.routeClass}><th scope="row">{row.routeClass}</th><td>{row.pageViews}</td><td>{row.handoffs}</td></tr>)}
      </tbody></DataTable>
      <DataTable><caption className={styles.caption}>Coarse campaign classes</caption><thead><tr><th scope="col">Campaign class</th><th scope="col">Page views</th><th scope="col">Handoffs</th></tr></thead><tbody>
        {report.campaigns.map((row) => <tr key={row.campaignSource}><th scope="row">{row.campaignSource}</th><td>{row.pageViews}</td><td>{row.handoffs}</td></tr>)}
      </tbody></DataTable>
      <p className={styles.retention}>Raw minimized events and opaque joins expire after {report.retention.rawEventDays} days. Coarse daily aggregates expire after {report.retention.aggregateDays} days. GPC, DNT, bot/internal traffic, and optional events without explicit consent are not stored.</p>
    </> : null}
  </section>
}
