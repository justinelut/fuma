import { useMemo, useState, type FormEvent } from 'react'
import type {
  EmailSettingKey,
  EmailSettingsChangeCommand,
  EmailSettingsLevel,
  ResolvedEmailSettingsV2,
} from '@core/fuma/publication/emailSettingsContracts'
import { Button } from '@ui/components/Button'
import styles from './EmailSettingsSurface.module.css'

export type EmailSettingsSurfaceProps = Readonly<{
  resolved: ResolvedEmailSettingsV2
  targetIds: Readonly<Record<EmailSettingsLevel, string>>
  canWrite: boolean
  onChange(command: EmailSettingsChangeCommand): Promise<void>
}>

const LEVELS: readonly EmailSettingsLevel[] = ['platform', 'organization', 'workspace', 'site', 'newsletter']
const RESETTABLE: readonly Readonly<{ key: EmailSettingKey; label: string }>[] = [
  { key: 'senderName', label: 'Sender name' },
  { key: 'senderEmail', label: 'Sender email' },
  { key: 'replyToEmail', label: 'Reply-to email' },
  { key: 'physicalAddress', label: 'Physical address' },
  { key: 'brandColor', label: 'Brand colour' },
  { key: 'footerText', label: 'Footer text' },
]

export function EmailSettingsSurface({ resolved, targetIds, canWrite, onChange }: EmailSettingsSurfaceProps) {
  const [level, setLevel] = useState<EmailSettingsLevel>('newsletter')
  const [senderName, setSenderName] = useState(resolved.values.senderName)
  const [brandColor, setBrandColor] = useState(resolved.values.brandColor)
  const [status, setStatus] = useState('')
  const current = useMemo(() => resolved.layerVersions.find((item) => item.level === level) ?? null, [level, resolved.layerVersions])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('Saving overrides…')
    try {
      await onChange({ target: { level, levelId: targetIds[level] }, expectedVersionId: current?.versionId ?? null, mutation: { kind: 'set', overrides: [{ key: 'senderName', value: senderName }, { key: 'brandColor', value: brandColor }] } })
      setStatus('Overrides saved as a new immutable version.')
    } catch {
      setStatus('Overrides could not be saved. Reload the resolved settings and try again.')
    }
  }

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const keys = RESETTABLE.filter(({ key }) => form.get(key) === 'on').map(({ key }) => key)
    if (keys.length === 0) { setStatus('Select at least one field to reset.'); return }
    setStatus('Resetting selected overrides…')
    try {
      await onChange({ target: { level, levelId: targetIds[level] }, expectedVersionId: current?.versionId ?? null, mutation: { kind: 'reset', keys } })
      setStatus('Selected fields now inherit from the next available level.')
    } catch {
      setStatus('Overrides could not be reset. Reload the resolved settings and try again.')
    }
  }

  return <section className={styles.surface} aria-labelledby="email-settings-title">
    <header>
      <div><p>Email delivery</p><h2 id="email-settings-title">Inherited settings</h2></div>
      <span className={styles.provider}>OCI Email Delivery</span>
    </header>

    <div className={styles.grid}>
      <section aria-labelledby="resolved-settings-title">
        <h3 id="resolved-settings-title">Resolved values and provenance</h3>
        <dl className={styles.provenance}>
          {RESETTABLE.map(({ key, label }) => <div key={key}>
            <dt>{label}</dt><dd>{resolved.values[key]}</dd>
            <dd className={styles.meta}>From {resolved.provenance[key].level} · version {resolved.provenance[key].ordinal}{resolved.provenance[key].inherited ? ' · inherited' : ' · direct'}</dd>
          </div>)}
        </dl>
      </section>

      <section aria-labelledby="override-settings-title">
        <h3 id="override-settings-title">Create an override version</h3>
        <label>Inheritance level<select value={level} onChange={(event) => setLevel(event.target.value as EmailSettingsLevel)} disabled={!canWrite}>{LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <form onSubmit={save}>
          <fieldset disabled={!canWrite}>
            <legend>Sender and theme overrides</legend>
            <label>Sender name<input required maxLength={160} value={senderName} onChange={(event) => setSenderName(event.target.value)} /></label>
            <label>Brand colour<input required pattern="#[0-9a-fA-F]{6}" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} /></label>
            <Button type="submit" variant="secondary" size="sm">
              Save immutable version
            </Button>
          </fieldset>
        </form>
        <form onSubmit={reset}>
          <fieldset disabled={!canWrite}>
            <legend>Reset to inherited</legend>
            <div className={styles.checks}>{RESETTABLE.map(({ key, label }) => <label key={key}><input type="checkbox" name={key} />{label}</label>)}</div>
            <Button type="submit" variant="secondary" size="sm">
              Reset selected overrides
            </Button>
          </fieldset>
        </form>
      </section>
    </div>
    <p className={styles.status} role="status" aria-live="polite">{status}</p>
  </section>
}
