import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describeSiteAiIntegration } from '../../../server/fuma/siteAi'
import { HOSTED_MIGRATION_CHECKSUMS } from '../../../server/fuma/db/migrations'
import { siteAiScopeAuthorityMigration } from '../../../server/fuma/db/migrations/000068_site_ai_scope_authority'
import { hostedMigrationChecksum } from '../../../server/fuma/db/migrationPolicy'

const ROOT = join(import.meta.dir, '../../..')
const DIRECTORY = join(ROOT, 'server/fuma/siteAi')
const source = (file: string) => readFileSync(join(DIRECTORY, file), 'utf8')
const files = readdirSync(DIRECTORY).filter((file) => file.endsWith('.ts'))
const all = files.map(source).join('\n')
const native = (path: string) => readFileSync(join(ROOT, 'server/ai', path), 'utf8')

describe('FUMA-065 site AI architecture', () => {
  it('uses strict TypeBox without Zod, UI imports, network calls, or parallel runtime/store/provider/bridge authorities', () => {
    expect(source('contracts.ts')).toContain('@core/utils/typeboxHelpers')
    expect(source('contracts.ts').match(/additionalProperties: false/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(10)
    expect(all).not.toMatch(/\b(?:zod|z\.object)\b/i)
    expect(all).not.toMatch(/@ui\/|shared-ui|components\/ui|tailwind/i)
    expect(all).not.toMatch(/\bfetch\s*\(|@anthropic|openrouter\.ai|ollama/i)
    expect(all).not.toMatch(/class\s+(?:AiRunner|ConversationStore|ProviderDriver|BrowserBridge)/)
    expect(source('repository.ts')).toContain('never stores prompts, messages, or snapshots')
    expect(describeSiteAiIntegration()).toMatchObject({
      ticket: 'FUMA-065',
      reusesNativeAiRuntime: true,
      conversationAuthority: 'server/ai/conversations/store.ts',
      providerAuthority: 'server/ai/drivers',
      browserBridgeAuthority: 'server/ai/runtime/transport.ts',
      schemaMigrationId: '000068_site_ai_scope_authority',
      schemaMigrationChecksum: '0c0368622abc603c03cd46e2c37107c2efc61c38f1bb3335539efcffa1e77bd5',
    })
  })

  it('extends the sole native tool loop, persister, and runner with optional authority hooks', () => {
    expect(native('runtime/types.ts')).toContain('interface AiRuntimeExecutionAuthority')
    expect(native('drivers/http/execTool.ts')).toContain('authority.authorizeTool')
    expect(native('drivers/http/toolLoop.ts')).toContain('call.id')
    expect(native('runtime/persister.ts')).toContain("phase: 'persistence'")
    expect(native('runtime/runner.ts')).toContain("phase: 'provider'")
    expect(native('runtime/runner.ts')).toContain('authority?.recordUsage')
  })

  it('registers the additive site-AI migration without prompt, message, credential, or secret material', () => {
    const schema = siteAiScopeAuthorityMigration.sql
    expect(siteAiScopeAuthorityMigration.id).toBe('000068_site_ai_scope_authority')
    expect(schema).toContain('create table fuma_site_ai_conversation_bindings')
    expect(schema).toContain('references ai_conversations(id)')
    expect(schema).toContain('create table fuma_site_ai_tool_receipts')
    expect(schema).not.toMatch(/\b(?:prompt_json|message_json|api_key|credential|secret|ciphertext|envelope)\b/i)
    expect(schema).not.toMatch(/drop\s+(?:table|column)|truncate/i)
    expect(hostedMigrationChecksum(schema)).toBe(
      '0c0368622abc603c03cd46e2c37107c2efc61c38f1bb3335539efcffa1e77bd5',
    )
    expect(HOSTED_MIGRATION_CHECKSUMS[siteAiScopeAuthorityMigration.id]).toBe(
      hostedMigrationChecksum(schema),
    )
  })

  it('keeps every ticket production file below the repository ceiling', () => {
    for (const file of files) {
      expect(source(file).split('\n').length - 1, file).toBeLessThanOrEqual(700)
    }
  })
})
