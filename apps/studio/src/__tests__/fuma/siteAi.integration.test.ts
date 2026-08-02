import { describe, expect, it } from 'bun:test'
import { runChat } from '../../../server/ai/runtime/runner'
import type { AiProvider, AiStreamRequest } from '../../../server/ai/drivers/types'
import type { ConversationsPersister } from '../../../server/ai/runtime/persister'
import type { AiStreamEvent } from '../../../server/ai/runtime/types'
import {
  createSiteAiFixture,
  prepareSiteAiTurn,
  siteAiAuthority,
} from './siteAiTestFixture'

const provider: AiProvider = {
  id: 'anthropic',
  label: 'Deterministic fake',
  supportedAuthModes: ['apiKey'],
  capabilities() {
    return { toolCalling: true, visionInput: false, toolResultImages: false, promptCache: false, streaming: true }
  },
  async listModels() { return [] },
  async *stream() {
    yield { type: 'text' as const, text: 'done' }
    yield { type: 'usage' as const, promptTokens: 40, completionTokens: 10 }
  },
}

function persister(events: string[]): ConversationsPersister {
  return {
    async appendAssistantText(text) { events.push(`text:${text}`) },
    async appendToolCall() {},
    async appendToolResult() {},
    async recordUsage(usage) {
      events.push(`usage:${usage.promptTokens}:${usage.completionTokens}`)
      return 0
    },
    recordContext() {},
  }
}

describe('FUMA-065 native runner integration', () => {
  it('uses the sole runner and settles scoped usage before completing the turn job', async () => {
    const fixture = createSiteAiFixture()
    const turn = await prepareSiteAiTurn(fixture, siteAiAuthority('a'), 'a')
    const emitted: AiStreamEvent[] = []
    const persisted: string[] = []
    const request: AiStreamRequest = {
      systemPrompt: ['test'],
      messages: [],
      tools: [],
      modelId: 'model-a',
      modelCapabilities: provider.capabilities('model-a'),
      credentials: { id: 'opaque', providerId: 'anthropic', authMode: 'apiKey', apiKey: 'unused', baseUrl: null },
      signal: new AbortController().signal,
      bridge: { async callBrowser() { return { ok: false, error: 'unused' } } },
      toolContextBase: {
        db: {} as never,
        userId: 'actor-a',
        capabilities: ['ai.chat'],
        scope: 'site',
        conversationId: 'conversation-a',
        snapshot: turn.snapshot,
        authority: turn.authority,
      },
    }
    await runChat({
      driver: provider,
      request,
      persister: persister(persisted),
      emit: (event) => emitted.push(event),
    })
    expect(persisted).toEqual(['text:done', 'usage:40:10'])
    expect(emitted.at(-1)).toEqual({ type: 'done' })
    expect(await fixture.repository.job('job-a')).toMatchObject({
      state: 'succeeded', promptTokens: 40, completionTokens: 10,
    })
    expect(fixture.creditEvents.map(({ kind }) => kind)).toEqual(['reserve', 'settle'])
  })
})
