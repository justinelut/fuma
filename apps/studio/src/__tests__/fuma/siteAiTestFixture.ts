import {
  MemorySiteAiLiveAuthority,
  MemorySiteAiRepository,
  SiteAiService,
  hashSiteAiSnapshot,
  type SiteAiAuthoritySnapshot,
  type SiteAiCreditAuthorityPort,
  type SiteAiModelAuthorityPort,
} from '../../../server/fuma/siteAi'

export const SITE_AI_NOW = '2026-07-28T15:00:00.000Z'
export const HASH_A = 'a'.repeat(64)

export function siteAiAuthority(
  site: 'a' | 'b',
  overrides: Readonly<Record<string, unknown>> = {},
): SiteAiAuthoritySnapshot {
  return {
    scope: {
      platformId: 'fuma',
      organizationId: `organization-${site}`,
      workspaceId: `workspace-${site}`,
      siteId: `site-${site}`,
      ownerKey: `owner-${site}`,
      ownerGeneration: 3,
      profileId: 'website',
    },
    actor: {
      actorId: `actor-${site}`,
      sessionId: `session-${site}`,
      editorSessionId: `editor-${site}`,
    },
    capabilities: ['ai.chat', 'ai.tools.write', 'site.structure.edit'],
    state: 'active',
    revision: 1,
    observedAt: SITE_AI_NOW,
    ...overrides,
  } as SiteAiAuthoritySnapshot
}

export function createSiteAiFixture() {
  const repository = new MemorySiteAiRepository()
  const liveAuthority = new MemorySiteAiLiveAuthority()
  const modelEvents: unknown[] = []
  const creditEvents: Array<Readonly<Record<string, unknown>>> = []
  const models: SiteAiModelAuthorityPort = {
    async authorize(input) { modelEvents.push(structuredClone(input)) },
  }
  const credits: SiteAiCreditAuthorityPort = {
    async reserve(input) { creditEvents.push({ kind: 'reserve', ...structuredClone(input) }) },
    async settle(input) { creditEvents.push({ kind: 'settle', ...structuredClone(input) }) },
    async release(input) { creditEvents.push({ kind: 'release', ...structuredClone(input) }) },
  }
  let auditSequence = 0
  const service = new SiteAiService({
    repository,
    liveAuthority,
    models,
    credits,
    now: () => new Date(SITE_AI_NOW),
    generateAuditId: () => `audit-${++auditSequence}`,
  })
  return { repository, liveAuthority, models, modelEvents, credits, creditEvents, service }
}

export async function prepareSiteAiTurn(
  fixture: ReturnType<typeof createSiteAiFixture>,
  authority: SiteAiAuthoritySnapshot,
  suffix: string,
) {
  fixture.liveAuthority.set(authority)
  await fixture.service.bindConversation({
    conversationId: `conversation-${suffix}`,
    authority,
  })
  const snapshot = Object.freeze({ siteId: authority.scope.siteId })
  await fixture.service.bindSnapshot({
    snapshotId: `snapshot-${suffix}`,
    conversationId: `conversation-${suffix}`,
    sequence: 0,
    snapshotHashSha256: await hashSiteAiSnapshot(snapshot),
    authority,
  })
  const turn = await fixture.service.beginTurn({
    jobId: `job-${suffix}`,
    conversationId: `conversation-${suffix}`,
    snapshotId: `snapshot-${suffix}`,
    providerId: 'provider-a',
    modelId: 'model-a',
    requiredCapability: 'ai.chat',
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    attempt: 1,
    authority,
  })
  return { ...turn, snapshot }
}
