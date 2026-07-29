import { describe, expect, it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { siteAiScopeAuthorityMigration } from '../../../server/fuma/db/migrations/000068_site_ai_scope_authority'
import {
  MemorySiteAiLiveAuthority,
  PostgresSiteAiRepository,
  SiteAiService,
  hashSiteAiSnapshot,
  type SiteAiCreditAuthorityPort,
  type SiteAiModelAuthorityPort,
} from '../../../server/fuma/siteAi'
import { SITE_AI_NOW, siteAiAuthority } from './siteAiTestFixture'

const postgresUrl = process.env.FUMA_TEST_POSTGRES_URL

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unsafe PostgreSQL schema identifier.')
  return `"${value}"`
}

function scopedPostgresUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

describe('FUMA-065 optional live PostgreSQL acceptance', () => {
  it.skipIf(postgresUrl === undefined)(
    'binds native conversation and snapshot authority with replay-safe tools and actual usage',
    async () => {
      if (!postgresUrl) throw new Error('FUMA_TEST_POSTGRES_URL is required.')
      const admin = createPostgresClient(postgresUrl)
      const schema = `fuma_site_ai_${process.pid}_${Date.now()}`
      await admin.unsafe(`create schema ${quotedIdentifier(schema)}`)
      const db = createPostgresClient(scopedPostgresUrl(postgresUrl, schema))
      try {
        await db.unsafe('create table ai_conversations(id text primary key)')
        await db.unsafe(siteAiScopeAuthorityMigration.sql)
        await db.unsafe("insert into ai_conversations(id) values ('conversation-postgres')")

        const repository = new PostgresSiteAiRepository(db)
        const liveAuthority = new MemorySiteAiLiveAuthority()
        const modelEvents: unknown[] = []
        const creditEvents: unknown[] = []
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
          generateAuditId: () => `postgres-audit-${++auditSequence}`,
        })
        const authority = siteAiAuthority('a')
        liveAuthority.set(authority)
        await service.bindConversation({ conversationId: 'conversation-postgres', authority })
        const snapshot = Object.freeze({ siteId: authority.scope.siteId, pageId: 'page-a' })
        await service.bindSnapshot({
          snapshotId: 'snapshot-postgres',
          conversationId: 'conversation-postgres',
          sequence: 0,
          snapshotHashSha256: await hashSiteAiSnapshot(snapshot),
          authority,
        })
        const turn = await service.beginTurn({
          jobId: 'job-postgres',
          conversationId: 'conversation-postgres',
          snapshotId: 'snapshot-postgres',
          providerId: 'provider-a',
          modelId: 'model-a',
          requiredCapability: 'ai.chat',
          estimatedInputTokens: 100,
          estimatedOutputTokens: 50,
          attempt: 1,
          authority,
        })
        await turn.authority.verifySnapshot(snapshot)
        expect(await turn.authority.authorizeTool({
          toolCallId: 'tool-postgres',
          toolName: 'replace-node',
          mutates: true,
          input: { nodeId: 'node-a' },
        })).toEqual({ replay: null })
        await turn.authority.recordToolResult({
          toolCallId: 'tool-postgres',
          toolName: 'replace-node',
          mutates: true,
          input: { nodeId: 'node-a' },
          output: { ok: true, result: { updated: true } },
        })
        expect(await turn.authority.authorizeTool({
          toolCallId: 'tool-postgres',
          toolName: 'replace-node',
          mutates: true,
          input: { nodeId: 'node-a' },
        })).toEqual({ replay: { ok: true, result: { updated: true } } })
        await turn.authority.recordUsage({ promptTokens: 40, completionTokens: 20 })
        await turn.authority.finish('succeeded')

        expect(await repository.job('job-postgres')).toMatchObject({
          state: 'succeeded',
          promptTokens: 40,
          completionTokens: 20,
        })
        expect(modelEvents).toHaveLength(1)
        expect(creditEvents).toEqual([
          expect.objectContaining({ kind: 'reserve' }),
          expect.objectContaining({ kind: 'settle', promptTokens: 40, completionTokens: 20 }),
        ])
        expect(await repository.auditForConversation('conversation-postgres'))
          .toHaveLength(6)
      } finally {
        await admin.unsafe(`drop schema if exists ${quotedIdentifier(schema)} cascade`)
      }
    },
    30_000,
  )
})
