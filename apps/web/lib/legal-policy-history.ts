import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const LegalPolicyVersionSchema = Type.Object({
  slug: Type.Union([
    Type.Literal('privacy'),
    Type.Literal('terms'),
    Type.Literal('cookies'),
    Type.Literal('acceptable-use'),
  ]),
  version: Type.String({ minLength: 1, maxLength: 40, pattern: '^[0-9A-Za-z._-]+$' }),
  effectiveAt: Type.String({
    minLength: 20,
    maxLength: 20,
    pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$',
  }),
  reviewAt: Type.String({
    minLength: 20,
    maxLength: 20,
    pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$',
  }),
  owner: Type.String({ minLength: 1, maxLength: 100, pattern: '^[^\\u0000-\\u001F\\u007F]+$' }),
  content: Type.String({ minLength: 20, maxLength: 100_000 }),
  current: Type.Boolean(),
}, { additionalProperties: false })

export type LegalPolicyVersion = Readonly<Static<typeof LegalPolicyVersionSchema>>

function validTimestamp(value: string): boolean {
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) && new Date(epoch).toISOString().replace('.000Z', 'Z') === value
}

export function validatePolicyHistory(history: readonly LegalPolicyVersion[], now: Date): void {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid policy clock')
  const keys = new Set<string>()
  const current = new Map<string, number>()
  for (const version of history) {
    if (!Value.Check(LegalPolicyVersionSchema, version)) throw new Error('Invalid policy version')
    if (!validTimestamp(version.effectiveAt) || !validTimestamp(version.reviewAt)) throw new Error('Invalid policy timestamp')
    if (Date.parse(version.reviewAt) < Date.parse(version.effectiveAt)) throw new Error('Invalid policy review window')
    const key = `${version.slug}:${version.version}`
    if (keys.has(key)) throw new Error('Duplicate policy version')
    keys.add(key)
    if (version.current) current.set(version.slug, (current.get(version.slug) ?? 0) + 1)
    if (version.current && Date.parse(version.reviewAt) < now.getTime()) throw new Error('Policy review overdue')
  }
  for (const count of current.values()) if (count !== 1) throw new Error('Invalid current policy count')
}

export function publishPolicyVersion(
  history: readonly LegalPolicyVersion[],
  candidate: Omit<LegalPolicyVersion, 'current'>,
  now: Date,
): readonly LegalPolicyVersion[] {
  if (!Value.Check(Type.Omit(LegalPolicyVersionSchema, ['current']), candidate)) throw new Error('Invalid policy candidate')
  const previous = history.filter((version) => version.slug === candidate.slug)
  const current = previous.find((version) => version.current)
  if (!current) throw new Error('Missing current policy version')
  if (candidate.version === current.version || Date.parse(candidate.effectiveAt) <= Date.parse(current.effectiveAt)) {
    throw new Error('Policy version must move forward')
  }
  const next = Object.freeze([
    ...history.map((version) => version.slug === candidate.slug && version.current
      ? Object.freeze({ ...version, current: false })
      : version),
    Object.freeze({ ...candidate, current: true }),
  ])
  validatePolicyHistory(next, now)
  return next
}
