import { describe, expect, it } from 'bun:test'
import { Type } from '@core/utils/typeboxHelpers'
import { executeAiTool } from '../../../server/ai/drivers/http/execTool'
import {
  MemorySiteAiLiveAuthority,
  MemorySiteAiRepository,
  SiteAiService,
  type SiteAiTurnJob,
} from '../../../server/fuma/siteAi'
import { siteAiAuthority, SITE_AI_NOW } from './siteAiTestFixture'

class FailingJobRepository extends MemorySiteAiRepository {
  failJobs = false
  override async putJob(job: SiteAiTurnJob): Promise<SiteAiTurnJob> {
    if (this.failJobs) throw new Error('injected-job-write')
    return super.putJob(job)
  }
}

describe('FUMA-065 site AI fault containment', () => {
  it('releases a credit reservation when durable job creation fails', async () => {
    const repository = new FailingJobRepository()
    const liveAuthority = new MemorySiteAiLiveAuthority()
    const releases: unknown[] = []
    const service = new SiteAiService({
      repository,
      liveAuthority,
      models: { async authorize() {} },
      credits: {
        async reserve() {},
        async settle() {},
        async release(input) { releases.push(structuredClone(input)) },
      },
      now: () => new Date(SITE_AI_NOW),
      generateAuditId: (() => { let n = 0; return () => `audit-${++n}` })(),
    })
    const authority = siteAiAuthority('a')
    liveAuthority.set(authority)
    await service.bindConversation({ conversationId: 'conversation-a', authority })
    await service.bindSnapshot({
      snapshotId: 'snapshot-a', conversationId: 'conversation-a', sequence: 0,
      snapshotHashSha256: 'a'.repeat(64), authority,
    })
    repository.failJobs = true
    await expect(service.beginTurn({
      jobId: 'job-a', conversationId: 'conversation-a', snapshotId: 'snapshot-a',
      providerId: 'provider-a', modelId: 'model-a', requiredCapability: 'ai.chat',
      estimatedInputTokens: 1, estimatedOutputTokens: 1, attempt: 1, authority,
    })).rejects.toThrow('injected-job-write')
    expect(releases).toEqual([{
      reservationId: 'site-ai:job-a', jobId: 'job-a', reasonCode: 'job-persistence-failed',
    }])
  })

  it('does not execute a tool when receipt claiming fails', async () => {
    const repository = new MemorySiteAiRepository()
    const liveAuthority = new MemorySiteAiLiveAuthority()
    let writes = 0
    const service = new SiteAiService({
      repository,
      liveAuthority,
      models: { async authorize() {} },
      now: () => new Date(SITE_AI_NOW),
      generateAuditId: (() => { let n = 0; return () => `audit-${++n}` })(),
    })
    const authority = siteAiAuthority('a')
    liveAuthority.set(authority)
    await service.bindConversation({ conversationId: 'conversation-a', authority })
    await service.bindSnapshot({ snapshotId: 'snapshot-a', conversationId: 'conversation-a', sequence: 0, snapshotHashSha256: 'a'.repeat(64), authority })
    const turn = await service.beginTurn({ jobId: 'job-a', conversationId: 'conversation-a', snapshotId: 'snapshot-a', providerId: 'provider-a', modelId: 'model-a', requiredCapability: 'ai.chat', estimatedInputTokens: 1, estimatedOutputTokens: 1, attempt: 1, authority })
    repository.failNext = new Error('injected-tool-claim')
    await expect(executeAiTool({
      name: 'site_fault_write', description: 'test', scope: 'site', execution: 'server',
      mutates: true, inputSchema: Type.Object({}), async handler() { writes += 1; return {} },
    }, {}, { async callBrowser() { return { ok: true } } }, new AbortController().signal, {
      db: {} as never, userId: 'actor-a', capabilities: ['ai.chat', 'ai.tools.write'],
      scope: 'site', conversationId: 'conversation-a', snapshot: {}, authority: turn.authority,
    }, 'tool-a')).rejects.toThrow('injected-tool-claim')
    expect(writes).toBe(0)
  })
})
