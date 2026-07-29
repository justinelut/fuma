import { describe, expect, it } from 'bun:test'
import {
  createSiteAiFixture,
  prepareSiteAiTurn,
  siteAiAuthority,
} from './siteAiTestFixture'

describe('FUMA-065 site AI adversarial security', () => {
  it('rejects foreign organization, workspace, site, owner, generation, profile, actor, session, conversation, and snapshot IDs', async () => {
    const fixture = createSiteAiFixture()
    const authorityA = siteAiAuthority('a')
    const authorityB = siteAiAuthority('b')
    await prepareSiteAiTurn(fixture, authorityA, 'a')
    await prepareSiteAiTurn(fixture, authorityB, 'b')

    await expect(fixture.service.beginTurn({
      jobId: 'foreign-bindings',
      conversationId: 'conversation-a',
      snapshotId: 'snapshot-b',
      providerId: 'provider-a', modelId: 'model-a', requiredCapability: 'ai.chat',
      estimatedInputTokens: 1, estimatedOutputTokens: 1, attempt: 1,
      authority: authorityA,
    })).rejects.toMatchObject({ code: 'denied' })

    const substitutions: SiteMutation[] = [
      (value) => ({ ...value, scope: { ...value.scope, organizationId: 'organization-b' } }),
      (value) => ({ ...value, scope: { ...value.scope, workspaceId: 'workspace-b' } }),
      (value) => ({ ...value, scope: { ...value.scope, siteId: 'site-b' } }),
      (value) => ({ ...value, scope: { ...value.scope, ownerKey: 'owner-b' } }),
      (value) => ({ ...value, scope: { ...value.scope, ownerGeneration: 4 } }),
      (value) => ({ ...value, scope: { ...value.scope, profileId: 'publication' as const } }),
      (value) => ({ ...value, actor: { ...value.actor, actorId: 'actor-b' } }),
      (value) => ({ ...value, actor: { ...value.actor, sessionId: 'session-b' } }),
      (value) => ({ ...value, actor: { ...value.actor, editorSessionId: 'editor-b' } }),
    ]
    for (const [index, mutate] of substitutions.entries()) {
      const injected = mutate(authorityA)
      fixture.liveAuthority.set(injected)
      await expect(fixture.service.beginTurn({
        jobId: `foreign-${index}`,
        conversationId: 'conversation-a', snapshotId: 'snapshot-a',
        providerId: 'provider-a', modelId: 'model-a', requiredCapability: 'ai.chat',
        estimatedInputTokens: 1, estimatedOutputTokens: 1, attempt: 1,
        authority: injected,
      })).rejects.toMatchObject({ code: 'denied' })
    }
  })

  it('fails closed when live access or a required capability is revoked mid-turn', async () => {
    const fixture = createSiteAiFixture()
    const authority = siteAiAuthority('a')
    const turn = await prepareSiteAiTurn(fixture, authority, 'a')
    await expect(turn.authority.verifySnapshot({ siteId: 'site-b' }))
      .rejects.toMatchObject({ code: 'denied' })
    await turn.authority.revalidate({ phase: 'provider' })
    fixture.liveAuthority.set({
      ...authority,
      capabilities: ['ai.chat'],
      revision: 2,
    })
    await expect(turn.authority.revalidate({
      phase: 'tool-dispatch', toolCallId: 'write-a', toolName: 'site_write', mutates: true,
    })).rejects.toMatchObject({ code: 'denied' })
    fixture.liveAuthority.revoke({ ...authority, revision: 2 })
    await expect(turn.authority.revalidate({ phase: 'persistence' }))
      .rejects.toMatchObject({ code: 'denied' })
    expect((await fixture.repository.auditForConversation('conversation-a'))
      .filter(({ action }) => action === 'site.ai.turn.denied')).toHaveLength(3)
  })
})

type SiteAuthority = ReturnType<typeof siteAiAuthority>
type SiteMutation = (value: SiteAuthority) => SiteAuthority
