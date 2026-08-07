import type { AiCreditsLedgerEntryWire, AiCreditsLedgerWire } from './client'

const credits = new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatCredits(value: number): string { return credits.format(value / 1_000_000) }
function entryTitle(entry: AiCreditsLedgerEntryWire): string {
  if (entry.entryType === 'grant') return 'Credit grant'
  if (entry.entryType === 'purchase') return 'Credit purchase'
  return entry.mode === 'byok' ? 'BYOK model usage' : 'Platform model usage'
}
function entryAmount(entry: AiCreditsLedgerEntryWire): string {
  if (entry.entryType !== 'usage') return `+${formatCredits(entry.amountMicros)}`
  if (entry.state === 'refunded') return `+${formatCredits(entry.amountMicros)}`
  if (entry.state === 'released' || entry.state === 'expired') return formatCredits(0)
  return `−${formatCredits(entry.amountMicros)}`
}

function LedgerRow({ entry }: Readonly<{ entry: AiCreditsLedgerEntryWire }>) {
  const tokenTotal = entry.inputTokens === null || entry.outputTokens === null
    ? null
    : entry.inputTokens + entry.outputTokens
  return (
    <li className="relative grid grid-cols-[1.25rem_1fr] gap-3 px-6 py-4" data-state={entry.state}>
      <span className="z-10 mt-1 size-3 rounded-full border-2 border-card bg-primary ring-1 ring-border" aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex justify-between gap-4">
          <strong>{entryTitle(entry)}</strong>
          <span className="flex-none font-mono tabular-nums">{entryAmount(entry)}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="font-bold capitalize text-foreground">{entry.state.replace('-', ' ')}</span>
          {entry.providerId && entry.modelId ? <span>{entry.providerId} / {entry.modelId}</span> : null}
          {tokenTotal !== null ? <span>{integer.format(tokenTotal)} tokens</span> : null}
          <time dateTime={entry.occurredAt}>{date.format(new Date(entry.occurredAt))}</time>
        </div>
      </div>
    </li>
  )
}

export function CreditsLedger({ model }: Readonly<{ model: AiCreditsLedgerWire }>) {
  const { account } = model
  const committed = Math.min(account.budgetMicros, account.spentMicros + account.reservedMicros)
  const budgetPercent = account.budgetMicros === 0 ? 0 : Math.round((committed / account.budgetMicros) * 100)
  return (
    <section className="grid gap-10 p-6 text-foreground sm:p-8" aria-labelledby="credits-ledger-title">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-8 border-b border-border pb-10 [&_p]:text-muted-foreground">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Site AI account</p>
          <h2 id="credits-ledger-title">Credits, without guesswork.</h2>
          <p>Every grant, purchase, reservation, and settled turn stays attached to this site.</p>
        </div>
        <div className="grid justify-items-end [&_strong]:text-5xl [&_strong]:font-medium [&_strong]:tabular-nums [&_strong]:leading-none [&_span]:mt-3 [&_span]:text-sm [&_span]:text-muted-foreground" aria-label={`${formatCredits(account.availableMicros)} credits available`}>
          <strong>{formatCredits(account.availableMicros)}</strong>
          <span>available credits</span>
        </div>
      </header>

      <dl className="m-0 grid grid-cols-2 border-y border-border sm:grid-cols-4 [&>div]:border-l [&>div]:border-border [&>div]:px-6 [&>div]:py-4 [&>div:first-child]:border-l-0 [&_dt]:text-xs [&_dt]:uppercase [&_dt]:tracking-wide [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-lg [&_dd]:tabular-nums">
        <div><dt>Balance</dt><dd>{formatCredits(account.balanceMicros)}</dd></div>
        <div><dt>Reserved</dt><dd>{formatCredits(account.reservedMicros)}</dd></div>
        <div><dt>Spent</dt><dd>{formatCredits(account.spentMicros)}</dd></div>
        <div><dt>Budget</dt><dd>{formatCredits(account.budgetMicros)}</dd></div>
      </dl>

      <section className="grid gap-3 [&>div]:flex [&>div]:items-baseline [&>div]:justify-between [&>div]:gap-4 [&>div_span]:font-bold [&>div_span]:tabular-nums [&_progress]:h-2 [&_progress]:w-full [&_p]:text-sm [&_p]:text-muted-foreground" aria-labelledby="credit-budget-title">
        <div><h3 id="credit-budget-title">Budget committed</h3><span>{budgetPercent}%</span></div>
        <progress max={100} value={budgetPercent}>{budgetPercent}%</progress>
        <p>Settled and active reservations count against the site budget. Released reservations do not.</p>
      </section>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,0.75fr)]">
        <section className="rounded-md border border-border bg-card" aria-labelledby="credit-activity-title">
          <div className="flex justify-between gap-4 border-b border-border p-6 [&>span]:text-sm [&>span]:tabular-nums [&>span]:text-muted-foreground [&_p]:mb-1 [&_p]:text-xs [&_p]:font-bold [&_p]:uppercase [&_p]:tracking-wider [&_p]:text-muted-foreground">
            <div><p>Chronology</p><h3 id="credit-activity-title">Ledger activity</h3></div>
            <span>{model.entries.length} entries</span>
          </div>
          {model.entries.length === 0 ? (
            <p className="m-0 p-6 text-sm text-muted-foreground">No credit activity yet. Grants and model turns will appear here.</p>
          ) : (
            <ol className="m-0 list-none p-0">{model.entries.map((entry) => <LedgerRow key={entry.entryId} entry={entry} />)}</ol>
          )}
        </section>

        <aside className="rounded-md border border-border bg-card" aria-labelledby="credit-keys-title">
          <div className="flex justify-between gap-4 border-b border-border p-6 [&>span]:text-sm [&>span]:tabular-nums [&>span]:text-muted-foreground [&_p]:mb-1 [&_p]:text-xs [&_p]:font-bold [&_p]:uppercase [&_p]:tracking-wider [&_p]:text-muted-foreground"><div><p>Provider payment</p><h3 id="credit-keys-title">Connected keys</h3></div></div>
          {account.credentials.length === 0 ? (
            <p className="m-0 p-6 text-sm text-muted-foreground">No BYOK connection. Platform-paid model turns use this credit balance.</p>
          ) : (
            <ul>{account.credentials.map((credential) => (
              <li key={credential.credentialId}>
                <div><strong>{credential.displayLabel}</strong><span>{credential.providerId}</span></div>
                <span className="self-start rounded-full bg-muted px-3 py-1 text-xs font-bold capitalize data-[state=rekey-required]:text-destructive data-[state=detached]:text-destructive" data-state={credential.state}>{credential.state.replace('-', ' ')}</span>
              </li>
            ))}</ul>
          )}
          <p className="m-0 p-6 text-sm text-muted-foreground">Provider secrets stay in native credential custody. This ledger receives only an opaque connection status.</p>
        </aside>
      </div>
    </section>
  )
}
