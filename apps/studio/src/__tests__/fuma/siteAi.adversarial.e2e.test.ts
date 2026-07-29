import { describe, expect, it } from 'bun:test'
import { Type } from '@core/utils/typeboxHelpers'
import { executeAiTool } from '../../../server/ai/drivers/http/execTool'
import type { AiBrowserBridge, AiTool } from '../../../server/ai/runtime/types'
import {
  createSiteAiFixture,
  prepareSiteAiTurn,
  siteAiAuthority,
} from './siteAiTestFixture'

describe('FUMA-065 adversarial native browser-tool E2E', () => {
  it('cannot dispatch into a foreign active editor after revocation and deduplicates delivered retries', async () => {
    const fixture = createSiteAiFixture()
    const authorityA = siteAiAuthority('a')
    const authorityB = siteAiAuthority('b')
    const [turnA, turnB] = await Promise.all([
      prepareSiteAiTurn(fixture, authorityA, 'a'),
      prepareSiteAiTurn(fixture, authorityB, 'b'),
    ])
    const writes = new Map<string, number>()
    const bridge = (boundSiteId: string): AiBrowserBridge => ({
      async callBrowser() {
        writes.set(boundSiteId, (writes.get(boundSiteId) ?? 0) + 1)
        return { ok: true, data: { siteId: boundSiteId } }
      },
    })
    const tool: AiTool = {
      name: 'site_browser_write', description: 'test', scope: 'site',
      execution: 'browser', mutates: true,
      inputSchema: Type.Object({ requestedSiteId: Type.String() }, { additionalProperties: false }),
    }
    const context = (site: 'a' | 'b', authority: typeof turnA.authority) => ({
      db: {} as never,
      userId: `actor-${site}`,
      capabilities: ['ai.chat', 'ai.tools.write'] as const,
      scope: 'site' as const,
      conversationId: `conversation-${site}`,
      snapshot: { siteId: `site-${site}` },
      authority,
    })

    fixture.liveAuthority.revoke(authorityA)
    await expect(executeAiTool(
      tool,
      { requestedSiteId: 'site-b' },
      bridge('site-a'),
      new AbortController().signal,
      context('a', turnA.authority),
      'browser-a',
    )).rejects.toMatchObject({ code: 'denied' })
    expect(writes.size).toBe(0)

    const first = await executeAiTool(
      tool,
      { requestedSiteId: 'site-a' },
      bridge('site-b'),
      new AbortController().signal,
      context('b', turnB.authority),
      'browser-b',
    )
    const replay = await executeAiTool(
      tool,
      { requestedSiteId: 'site-a' },
      bridge('site-b'),
      new AbortController().signal,
      context('b', turnB.authority),
      'browser-b',
    )
    expect(first).toEqual({ ok: true, data: { siteId: 'site-b' } })
    expect(replay).toEqual(first)
    expect(writes).toEqual(new Map([['site-b', 1]]))
  })
})
