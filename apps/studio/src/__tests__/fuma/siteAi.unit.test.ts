import { describe, expect, it } from 'bun:test'
import {
  BeginSiteAiTurnCommandSchema,
  SiteAiAuditFactSchema,
  SiteAiConversationBindingSchema,
  SiteAiSnapshotBindingSchema,
  SiteAiToolReceiptSchema,
  SiteAiTurnJobSchema,
  createSiteAiAuthoritySnapshot,
  parseSiteAiContract,
} from '../../../server/fuma/siteAi'
import { freezeFumaRequestContext } from '../../../server/fuma/context'
import {
  createSiteAiFixture,
  prepareSiteAiTurn,
  siteAiAuthority,
} from './siteAiTestFixture'

describe('FUMA-065 site AI unit', () => {
  it('strictly validates every persisted boundary and rejects extra authority claims', () => {
    for (const [schema, value] of [
      [SiteAiConversationBindingSchema, {}],
      [SiteAiSnapshotBindingSchema, {}],
      [BeginSiteAiTurnCommandSchema, {}],
      [SiteAiTurnJobSchema, {}],
      [SiteAiToolReceiptSchema, {}],
      [SiteAiAuditFactSchema, {}],
    ] as const) {
      expect(() => parseSiteAiContract(schema, value, 'test')).toThrow('TypeBox')
    }
    const authority = siteAiAuthority('a')
    expect(() => parseSiteAiContract(BeginSiteAiTurnCommandSchema, {
      jobId: 'job-a', conversationId: 'conversation-a', snapshotId: 'snapshot-a',
      providerId: 'provider-a', modelId: 'model-a', requiredCapability: 'ai.chat',
      estimatedInputTokens: 1, estimatedOutputTokens: 1, attempt: 1, authority,
      injectedOrganizationId: 'organization-b',
    }, 'test')).toThrow('TypeBox')
  })

  it('derives authority only from immutable request context and exact editor owner generation', () => {
    const context = freezeFumaRequestContext({
      requestId: 'request-a',
      source: { kind: 'staff-session', correlationId: 'request-a', userId: 'actor-a', sessionId: 'session-a', impersonatedBy: null },
      actor: { kind: 'staff', userId: 'actor-a', sessionId: 'session-a', impersonator: null },
      scope: {
        platform: { id: 'fuma', status: 'active' },
        organization: { id: 'organization-a', platformId: 'fuma', status: 'active' },
        workspace: { id: 'workspace-a', platformId: 'fuma', organizationId: 'organization-a', status: 'active' },
        site: { id: 'site-a', platformId: 'fuma', organizationId: 'organization-a', workspaceId: 'workspace-a', profileId: 'website', status: 'active' },
      },
      profile: { id: 'website', status: 'active' },
      capabilities: ['ai.chat', 'ai.tools.write'],
      permissions: { subjectId: 'actor-a', allow: [], deny: [] },
    })
    const editor = {
      platformId: 'fuma', organizationId: 'organization-a', workspaceId: 'workspace-a',
      siteId: 'site-a', ownerKey: 'owner-a', generation: 3, state: 'active' as const,
      transferFence: null, profileId: 'website', editorSessionId: 'editor-a',
    }
    expect(createSiteAiAuthoritySnapshot({
      context, editor, revision: 1, observedAt: '2026-07-28T15:00:00.000Z',
    })).toMatchObject({
      scope: { siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 3 },
      actor: { actorId: 'actor-a', sessionId: 'session-a', editorSessionId: 'editor-a' },
    })
    expect(() => createSiteAiAuthoritySnapshot({
      context,
      editor: { ...editor, siteId: 'site-b', generation: 4 },
      revision: 1,
      observedAt: '2026-07-28T15:00:00.000Z',
    })).toThrow('ancestry')
  })

  it('binds only hashes around the native conversation authority and settles terminal usage', async () => {
    const fixture = createSiteAiFixture()
    const authority = siteAiAuthority('a')
    const turn = await prepareSiteAiTurn(fixture, authority, 'a')
    expect(turn.job).toMatchObject({
      conversationId: 'conversation-a',
      snapshotId: 'snapshot-a',
      state: 'running',
      reservationId: 'site-ai:job-a',
    })
    await turn.authority.recordUsage({ promptTokens: 123, completionTokens: 45 })
    await turn.authority.finish('succeeded')
    expect(await fixture.repository.job('job-a')).toMatchObject({
      state: 'succeeded', promptTokens: 123, completionTokens: 45,
    })
    expect(fixture.creditEvents.map(({ kind }) => kind)).toEqual(['reserve', 'settle'])
    const serialized = JSON.stringify({
      audits: await fixture.repository.auditForConversation('conversation-a'),
      snapshot: await fixture.repository.snapshot('snapshot-a'),
    })
    expect(serialized).not.toMatch(/prompt|message|api.?key|credential|secret|ciphertext|envelope/i)
    expect(serialized).toMatch(/snapshotHashSha256/)
  })

  it('replays an identical running turn command but rejects changed job evidence', async () => {
    const fixture = createSiteAiFixture()
    const authority = siteAiAuthority('a')
    await prepareSiteAiTurn(fixture, authority, 'a')
    const replay = await fixture.service.beginTurn({
      jobId: 'job-a', conversationId: 'conversation-a', snapshotId: 'snapshot-a',
      providerId: 'provider-a', modelId: 'model-a', requiredCapability: 'ai.chat',
      estimatedInputTokens: 100, estimatedOutputTokens: 50, attempt: 1, authority,
    })
    expect(replay.job.jobId).toBe('job-a')
    await expect(fixture.service.beginTurn({
      jobId: 'job-a', conversationId: 'conversation-a', snapshotId: 'snapshot-a',
      providerId: 'provider-a', modelId: 'foreign-model', requiredCapability: 'ai.chat',
      estimatedInputTokens: 100, estimatedOutputTokens: 50, attempt: 1, authority,
    })).rejects.toMatchObject({ code: 'conflict' })
  })
})
