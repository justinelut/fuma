import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../..')
const STUDIO = join(ROOT, 'apps/studio')
const SERVER = join(STUDIO, 'server/fuma/aiPaymentSetup')
function source(path: string): string { return readFileSync(path, 'utf8') }
function files(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const value = join(path, name)
    return statSync(value).isDirectory() ? files(value) : [value]
  })
}

describe('FUMA-070 AI-confirmed payment setup architecture', () => {
  test('uses strict TypeBox contracts with fixed reviewed identity and no AI secret/code/amount selectors', () => {
    const contracts = source(join(SERVER, 'contracts.ts'))
    const tool = source(join(STUDIO, 'server/ai/tools/site/paymentSetupTool.ts'))
    const port = source(join(STUDIO, 'server/ai/tools/site/paymentSetupPort.ts'))
    const all = files(SERVER).map(source).join('\n')
    expect(contracts).toContain("AI_PAYMENT_PLUGIN_PACKAGE_ID = 'fuma.customer-payments'")
    expect(contracts).toContain("AI_PAYMENT_PLUGIN_EXACT_VERSION = '1.0.0'")
    expect(contracts).toContain('AI_PAYMENT_PREVIEW_AMOUNT_MINOR = 100')
    expect(contracts).toContain('additionalProperties: false')
    expect(tool).toContain("name: 'site_propose_payment_setup'")
    expect(tool).toContain("execution: 'server'")
    expect(tool).toContain('mutates: true')
    expect(tool).toContain("requiredCapabilities: ['plugins.install'] as const")
    expect(tool).toContain("securePaymentPath: '/secure-payment'")
    expect(tool).toContain("SiteProposePaymentSetupInputSchema } from '@core/ai'")
    expect(tool).not.toContain('Type.Object')
    expect(port).toContain("from '../../../fuma/aiPaymentSetup/contracts'")
    expect(port).not.toContain("from '../../../fuma/aiPaymentSetup'")
    expect(tool).not.toMatch(/inputSchema[\s\S]{0,400}(?:amountMinor|artifactId|packageId|permissions|secretKey|publicKey|code|jsx)/i)
    expect(all).not.toMatch(/\b(?:zod|z\.object|z\.string)\b/i)
  })

  test('reuses site AI, review/install, merchant credential, and FUMA-069 payment authorities', () => {
    const service = source(join(SERVER, 'service.ts'))
    const runtime = source(join(SERVER, 'runtime.ts'))
    expect(service).toContain("from '../siteAi/repository'")
    expect(service).toContain("from '../artifactReviews'")
    expect(service).toContain("from '../artifacts'")
    expect(service).toContain("from '../customerPayments/service'")
    expect(service).toContain('this.#payments.attachCredential')
    expect(service).toContain('this.#reviews.install')
    expect(service).toContain('this.#artifacts.readInstallation')
    expect(runtime).toContain('CustomerMerchantPluginPaymentService')
    expect(runtime).toContain('this.#payments.create')
    expect(runtime).toContain('this.#payments.receipt')
    expect(runtime).not.toMatch(/new (?:ScopedPaystackTransport|MemoryPaystackLedger|PaystackPurposeRegistry)/)
  })

  test('requires fresh explicit confirmation and keeps nonce, handoff, and credentials out of public proposal state', () => {
    const contracts = source(join(SERVER, 'contracts.ts'))
    const service = source(join(SERVER, 'service.ts'))
    const routes = source(join(SERVER, 'routes.ts'))
    expect(service).toContain("authority.session.impersonatedBy !== null")
    expect(service).toContain('sessionAgeMs >= authority.freshSessionMs')
    expect(service).toContain('sha256(command.confirmationNonce)')
    expect(service).toContain('this.#assertCurrentReview(proposal)')
    expect(routes).toContain("'__Host-fuma_ai_payment_setup'")
    expect(routes).toContain('Secure; HttpOnly; SameSite=Strict')
    expect(routes).toContain("'/ai/payment-setup/proposals/:proposalId/confirm', 'plugins.install'")
    expect(routes).toContain("'/ai/payment-setup/proposals/:proposalId/credentials', 'plugins.configure'")
    expect(contracts).toContain('proposalView(value: AiPaymentSetupProposal)')
    const publicView = contracts.slice(contracts.indexOf('export function proposalView'))
    expect(publicView).not.toContain('confirmationNonce')
    expect(publicView).not.toContain('tokenHashSha256')
    expect(publicView).not.toContain('secretKey')
  })

  test('persists only hash-bound handoffs and credential/receipt identifiers in canonical migration 000074', () => {
    const migration = source(join(STUDIO, 'server/fuma/db/migrations/000074_ai_payment_setup.ts'))
    const postgres = source(join(SERVER, 'postgres.ts'))
    expect(migration).toContain("id: '000074_ai_payment_setup'")
    expect(migration).toContain('fuma_ai_payment_setup_proposals_v1')
    expect(migration).toContain('fuma_ai_payment_setup_handoffs_v1')
    expect(migration).toContain("package_id='fuma.customer-payments'")
    expect(migration).toContain("exact_version='1.0.0'")
    expect(migration).toContain('token_hash_sha256')
    expect(migration).toContain('preview_receipt_fingerprint_sha256')
    expect(migration).toContain("array['publicKey','secretKey','confirmationNonce','handoffToken'")
    expect(postgres).not.toMatch(/(?:publicKey|secretKey|confirmationNonce|handoffToken)\s*[:=]/)
  })

  test('removes the phase-local parallel confirmation authority', () => {
    const contracts = source(join(ROOT, 'packages/fuma-governance-launch/src/contracts.ts'))
    const plugins = source(join(ROOT, 'packages/fuma-governance-launch/src/plugins.ts'))
    expect(contracts).not.toContain('AiPaymentProposalSchema')
    expect(plugins).not.toContain('confirmAiPaymentProposal')
    expect(plugins).not.toContain('paymentToolResult')
    expect(plugins).not.toContain('SecureSecretEntryHandoff')
  })

  test('contributes routes only through the existing hosted scoped API boundary', () => {
    const hosted = source(join(STUDIO, 'server/auth/hosted/runtime.ts'))
    expect(hosted).toContain('aiPaymentSetupRoutes?: readonly FumaScopedRouteDeclaration[]')
    expect(hosted).toContain('...(input.aiPaymentSetupRoutes ?? [])')
    expect(hosted.match(/createPostgresFumaScopedRouteBoundaryFactory\(/g)).toHaveLength(1)
  })
})
