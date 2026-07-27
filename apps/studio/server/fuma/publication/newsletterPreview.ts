import {
  NewsletterFixtureKindSchema,
  NewsletterVersionComparisonSchema,
  parsePublicationContract,
  type NewsletterFixtureKind,
  type NewsletterVersion,
  type NewsletterVersionComparison,
} from '@core/fuma/publication'

const FIXTURES: Readonly<Record<NewsletterFixtureKind, Readonly<{ label: string; values: Readonly<Record<string, string>> }>>> = Object.freeze({
  public: Object.freeze({ label: 'Public visitor', values: Object.freeze({ 'member.displayName': 'Public visitor', 'member.email': 'public-preview@example.invalid', 'unsubscribe.url': 'https://preview.fuma.invalid/public/unsubscribe' }) }),
  'free-member': Object.freeze({ label: 'Free member', values: Object.freeze({ 'member.displayName': 'Amina Free', 'member.email': 'free-member@example.invalid', 'unsubscribe.url': 'https://preview.fuma.invalid/free/unsubscribe' }) }),
  'paid-member': Object.freeze({ label: 'Paid member', values: Object.freeze({ 'member.displayName': 'Kamau Paid', 'member.email': 'paid-member@example.invalid', 'unsubscribe.url': 'https://preview.fuma.invalid/paid/unsubscribe' }) }),
})

function interpolate(value: unknown, variables: Readonly<Record<string, string>>): unknown {
  if (typeof value === 'string') return Object.entries(variables).reduce((result, [name, replacement]) => result.replaceAll(`{{${name}}}`, replacement), value)
  if (Array.isArray(value)) return value.map((item) => interpolate(item, variables))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, interpolate(child, variables)]))
  return value
}

export function renderNewsletterFixture(version: NewsletterVersion, newsletterName: string, fixtureInput: NewsletterFixtureKind): Readonly<{ fixture: NewsletterFixtureKind; fixtureLabel: string; subject: string; document: unknown }> {
  const fixture = parsePublicationContract('newsletter fixture', NewsletterFixtureKindSchema, fixtureInput)
  const selected = FIXTURES[fixture]
  const variables = Object.freeze({ ...selected.values, 'newsletter.name': newsletterName, 'campaign.subject': version.subject })
  return Object.freeze({ fixture, fixtureLabel: selected.label, subject: interpolate(version.subject, variables) as string, document: interpolate(version.document, variables) })
}

export function compareNewsletterVersions(newsletterId: string, from: NewsletterVersion, to: NewsletterVersion): NewsletterVersionComparison {
  const changed: Array<'subject' | 'previewText' | 'document'> = []
  if (from.subject !== to.subject) changed.push('subject')
  if (from.previewText !== to.previewText) changed.push('previewText')
  if (JSON.stringify(from.document) !== JSON.stringify(to.document)) changed.push('document')
  return parsePublicationContract('newsletter version comparison', NewsletterVersionComparisonSchema, { newsletterId, fromVersionId: from.versionId, toVersionId: to.versionId, fromOrdinal: from.ordinal, toOrdinal: to.ordinal, changed })
}

export class NewsletterTestSendLimiter {
  readonly #attempts = new Map<string, Map<string, number>>()
  assertAllowed(key: string, idempotencyKey: string, now: number): void {
    const attempts = this.#attempts.get(key) ?? new Map<string, number>()
    for (const [attemptKey, timestamp] of attempts) if (now - timestamp >= 600_000) attempts.delete(attemptKey)
    if (!attempts.has(idempotencyKey) && attempts.size >= 5) throw Object.assign(new Error('Newsletter test-send rate limit exceeded.'), { code: 'rate-limited' })
    attempts.set(idempotencyKey, now)
    this.#attempts.set(key, attempts)
  }
}
