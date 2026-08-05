import type { AiCreditsLedgerEntryWire, AiCreditsLedgerWire } from './client'
import styles from './CreditsLedger.module.css'

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
    <li className={styles.entry} data-state={entry.state}>
      <span className={styles.railMark} aria-hidden="true" />
      <div className={styles.entryMain}>
        <div className={styles.entryHeading}>
          <strong>{entryTitle(entry)}</strong>
          <span className={styles.amount}>{entryAmount(entry)}</span>
        </div>
        <div className={styles.entryMeta}>
          <span className={styles.state}>{entry.state.replace('-', ' ')}</span>
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
    <section className={styles.root} aria-labelledby="credits-ledger-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Site AI account</p>
          <h2 id="credits-ledger-title">Credits, without guesswork.</h2>
          <p>Every grant, purchase, reservation, and settled turn stays attached to this site.</p>
        </div>
        <div className={styles.balance} aria-label={`${formatCredits(account.availableMicros)} credits available`}>
          <strong>{formatCredits(account.availableMicros)}</strong>
          <span>available credits</span>
        </div>
      </header>

      <dl className={styles.summary}>
        <div><dt>Balance</dt><dd>{formatCredits(account.balanceMicros)}</dd></div>
        <div><dt>Reserved</dt><dd>{formatCredits(account.reservedMicros)}</dd></div>
        <div><dt>Spent</dt><dd>{formatCredits(account.spentMicros)}</dd></div>
        <div><dt>Budget</dt><dd>{formatCredits(account.budgetMicros)}</dd></div>
      </dl>

      <section className={styles.budget} aria-labelledby="credit-budget-title">
        <div><h3 id="credit-budget-title">Budget committed</h3><span>{budgetPercent}%</span></div>
        <progress max={100} value={budgetPercent}>{budgetPercent}%</progress>
        <p>Settled and active reservations count against the site budget. Released reservations do not.</p>
      </section>

      <div className={styles.columns}>
        <section className={styles.ledger} aria-labelledby="credit-activity-title">
          <div className={styles.sectionHeading}>
            <div><p>Chronology</p><h3 id="credit-activity-title">Ledger activity</h3></div>
            <span>{model.entries.length} entries</span>
          </div>
          {model.entries.length === 0 ? (
            <p className={styles.empty}>No credit activity yet. Grants and model turns will appear here.</p>
          ) : (
            <ol className={styles.entries}>{model.entries.map((entry) => <LedgerRow key={entry.entryId} entry={entry} />)}</ol>
          )}
        </section>

        <aside className={styles.credentials} aria-labelledby="credit-keys-title">
          <div className={styles.sectionHeading}><div><p>Provider payment</p><h3 id="credit-keys-title">Connected keys</h3></div></div>
          {account.credentials.length === 0 ? (
            <p className={styles.empty}>No BYOK connection. Platform-paid model turns use this credit balance.</p>
          ) : (
            <ul>{account.credentials.map((credential) => (
              <li key={credential.credentialId}>
                <div><strong>{credential.displayLabel}</strong><span>{credential.providerId}</span></div>
                <span className={styles.credentialState} data-state={credential.state}>{credential.state.replace('-', ' ')}</span>
              </li>
            ))}</ul>
          )}
          <p className={styles.custodyNote}>Provider secrets stay in native credential custody. This ledger receives only an opaque connection status.</p>
        </aside>
      </div>
    </section>
  )
}
