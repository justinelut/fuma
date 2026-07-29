import { describe, expect, it } from 'bun:test'
import { Type } from '@core/utils/typeboxHelpers'
import { executeAiTool } from '../../../server/ai/drivers/http/execTool'
import type { AiBrowserBridge, AiTool } from '../../../server/ai/runtime/types'
import {
  createSiteAiFixture,
  prepareSiteAiTurn,
  siteAiAuthority,
} from './siteAiTestFixture'

const noBrowser: AiBrowserBridge = {
  async callBrowser() { throw new Error('browser bridge was not expected') },
}

describe('FUMA-065 concurrent native runtime demo', () => {
  it('edits two sites concurrently, revokes one actor mid-turn, and replays a tool without a second write', async () => {
    const fixture = createSiteAiFixture()
    const authorityA = siteAiAuthority('a')
    const authorityB = siteAiAuthority('b')
    const [turnA, turnB] = await Promise.all([
      prepareSiteAiTurn(fixture, authorityA, 'a'),
      prepareSiteAiTurn(fixture, authorityB, 'b'),
    ])
    await Promise.all([
      turnA.authority.revalidate({ phase: 'provider' }),
      turnB.authority.revalidate({ phase: 'provider' }),
    ])

    const writes = new Map<string, string[]>()
    const tool: AiTool = {
      name: 'site_demo_insert',
      description: 'deterministic scoped demo write',
      scope: 'site',
      execution: 'server',
      mutates: true,
      inputSchema: Type.Object({ siteId: Type.String(), value: Type.String() }, {
        additionalProperties: false,
      }),
      async handler(input) {
        const value = input as { siteId: string; value: string }
        const current = writes.get(value.siteId) ?? []
        current.push(value.value)
        writes.set(value.siteId, current)
        return { siteId: value.siteId, writes: current.length }
      },
    }
    const context = (suffix: 'a' | 'b', authority: typeof turnA.authority) => ({
      db: {} as never,
      userId: `actor-${suffix}`,
      capabilities: ['ai.chat', 'ai.tools.write', 'site.structure.edit'] as const,
      scope: 'site' as const,
      conversationId: `conversation-${suffix}`,
      snapshot: { siteId: `site-${suffix}` },
      authority,
    })

    fixture.liveAuthority.revoke(authorityA)
    const [resultA, resultB] = await Promise.allSettled([
      executeAiTool(tool, { siteId: 'site-a', value: 'blocked' }, noBrowser,
        new AbortController().signal, context('a', turnA.authority), 'tool-a'),
      executeAiTool(tool, { siteId: 'site-b', value: 'allowed' }, noBrowser,
        new AbortController().signal, context('b', turnB.authority), 'tool-b'),
    ])
    expect(resultA.status).toBe('rejected')
    expect(resultB).toMatchObject({ status: 'fulfilled', value: { ok: true } })
    expect(writes.get('site-a')).toBeUndefined()
    expect(writes.get('site-b')).toEqual(['allowed'])

    const replay = await executeAiTool(
      tool,
      { siteId: 'site-b', value: 'allowed' },
      noBrowser,
      new AbortController().signal,
      context('b', turnB.authority),
      'tool-b',
    )
    expect(replay).toMatchObject({ ok: true, data: { siteId: 'site-b', writes: 1 } })
    expect(writes.get('site-b')).toEqual(['allowed'])

    await turnA.authority.finish('failed', 'authority-revoked')
    await turnB.authority.recordUsage({ promptTokens: 120, completionTokens: 30 })
    await turnB.authority.finish('succeeded')
    const evidence = {
      siteAWrites: writes.get('site-a')?.length ?? 0,
      siteBWrites: writes.get('site-b')?.length ?? 0,
      actorAState: (await fixture.repository.job('job-a'))?.state,
      actorBState: (await fixture.repository.job('job-b'))?.state,
      retryDeduplicated: writes.get('site-b')?.length === 1,
    }
    expect(evidence).toEqual({
      siteAWrites: 0,
      siteBWrites: 1,
      actorAState: 'failed',
      actorBState: 'succeeded',
      retryDeduplicated: true,
    })
    process.stdout.write(
      `[FUMA-065 demo] siteA=${evidence.siteAWrites} siteB=${evidence.siteBWrites} revoked=${evidence.actorAState} active=${evidence.actorBState} retryDeduplicated=${evidence.retryDeduplicated}\n`,
    )
  })
})
