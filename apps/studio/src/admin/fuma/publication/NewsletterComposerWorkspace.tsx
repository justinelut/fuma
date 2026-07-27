import { useEffect, useMemo, useState } from 'react'
import type { PublicationMemberSegment } from '@core/fuma/publication'
import type {
  NewsletterComposerDraft,
  NewsletterDraftAutosaveCommand,
  NewsletterProfileCommand,
  PublicationNewsletterProfile,
} from '@core/fuma/publication/newsletterComposerContracts'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { PublicationHttpClient } from './client'
import { NewsletterComposerHttpClient, type NewsletterComposerDetail } from './newsletterComposerClient'
import { NewsletterComposerSurface } from './NewsletterComposerSurface'

export function NewsletterComposerWorkspace({ client, canWrite, canSend }: Readonly<{
  client: PublicationHttpClient
  canWrite: boolean
  canSend: boolean
}>) {
  const composer = useMemo(() => new NewsletterComposerHttpClient(client.target), [client])
  const [newsletters, setNewsletters] = useState<readonly PublicationNewsletterProfile[]>([])
  const [segments, setSegments] = useState<readonly PublicationMemberSegment[]>([])
  const [detail, setDetail] = useState<NewsletterComposerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const select = async (newsletterId: string) => {
    setError('')
    try { setDetail(await composer.detail(newsletterId)) }
    catch (reason) { setError(getErrorMessage(reason, 'Newsletter could not be loaded.')) }
  }

  useEffect(() => {
    let active = true
    void Promise.all([composer.list(), client.memberSegments(200, null)])
      .then(async ([items, memberSegments]) => {
        if (!active) return
        setNewsletters(items)
        setSegments(memberSegments)
        if (items[0]) setDetail(await composer.detail(items[0].newsletterId))
      })
      .catch((reason) => { if (active) setError(getErrorMessage(reason, 'Newsletter composer failed to load.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [client, composer])

  const saveProfile = async (command: NewsletterProfileCommand) => {
    const saved = await composer.saveProfile(command)
    setNewsletters((current) => [...current.filter((item) => item.newsletterId !== saved.newsletterId), saved].toSorted((a, b) => a.name.localeCompare(b.name)))
    setDetail(await composer.detail(saved.newsletterId))
    return saved
  }

  const autosave = async (command: NewsletterDraftAutosaveCommand): Promise<NewsletterComposerDraft> => {
    const saved = await composer.autosave(command)
    setDetail((current) => current && current.newsletter.newsletterId === saved.newsletterId ? { ...current, draft: saved } : current)
    return saved
  }

  if (loading) return <p role="status">Loading newsletter composer…</p>
  if (error) return <p role="alert">{error}</p>

  return <NewsletterComposerSurface
    key={detail?.newsletter.newsletterId ?? 'new-newsletter'}
    newsletters={newsletters}
    newsletter={detail?.newsletter ?? null}
    draft={detail?.draft ?? null}
    segments={segments}
    settings={detail?.settings ?? null}
    senderVerification={detail?.senderVerification ?? null}
    canRead
    canWrite={canWrite}
    canSend={canSend}
    onSelect={(newsletterId) => { void select(newsletterId) }}
    onSaveProfile={saveProfile}
    onAutosave={autosave}
    onEstimate={(newsletterId, audience) => composer.estimate(newsletterId, audience)}
    onReadiness={(newsletterId) => composer.readiness(newsletterId)}
    onEditSettings={() => globalThis.location.assign('/admin/settings')}
  />
}
