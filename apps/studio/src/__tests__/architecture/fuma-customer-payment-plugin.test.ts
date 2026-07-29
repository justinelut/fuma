import { describe, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePluginManifest } from '@core/plugins/manifest'
import { CUSTOMER_PAYMENT_PLUGIN_PERMISSIONS } from '../../../server/fuma/customerPayments/pluginContracts'
import { hostedMigrations } from '../../../server/fuma/db/migrations'

const ROOT = join(import.meta.dir, '../../../../..')
const PLUGIN = join(ROOT, 'packages/fuma-governance-launch/plugins/customer-payments')
const STUDIO = join(ROOT, 'apps/studio')

async function source(path: string): Promise<string> { return await readFile(path, 'utf8') }

describe('FUMA-069 reviewed customer-payment plugin architecture', () => {
  test('ships one valid exact first-party package with only reviewed host grants', async () => {
    const raw = JSON.parse(await source(join(PLUGIN, 'plugin.json'))) as unknown
    const manifest = parsePluginManifest(raw)
    expect(manifest).toMatchObject({ id: 'fuma.customer-payments', version: '1.0.0', apiVersion: 1 })
    expect([...manifest.permissions].sort()).toEqual([...CUSTOMER_PAYMENT_PLUGIN_PERMISSIONS].sort())
    expect(manifest.networkAllowedHosts).toEqual([])
    expect(manifest.entrypoints).toEqual({ server: 'server/index.js', modules: 'editor/index.js' })
    expect(JSON.stringify(raw)).not.toMatch(/pending-(?:review|build)|secretKey|publicKey|signature/)
  })

  test('uses the host bridge and never owns provider, webhook, ledger, network, or secret authority', async () => {
    const server = await source(join(PLUGIN, 'server/index.js'))
    const modules = await source(join(PLUGIN, 'editor/index.js'))
    expect(server).toContain('api.payments.customer.create')
    expect(server).toContain('api.payments.customer.receipt')
    expect(server).toContain('api.payments.customer.refund')
    expect(server).not.toMatch(/fetch\(|webhook|paystack|secret|credential|ledger/i)
    expect(modules).toContain("paymentBlock('deposit'")
    expect(modules).toContain("paymentBlock('donation'")
    expect(modules).toContain("paymentBlock('checkout'")
    expect(modules).not.toMatch(/fetch\(|payment[s]?\.customer|webhook|secret|credential|ledger/i)
  })

  test('defines strict TypeBox SDK and RPC boundaries with separate refund authority', async () => {
    const permissions = await source(join(STUDIO, 'src/core/plugin-sdk/types/permissions.ts'))
    const capabilities = await source(join(STUDIO, 'src/core/plugin-sdk/capabilities.ts'))
    const schemas = await source(join(STUDIO, 'src/core/plugin-sdk/paymentSchemas.ts'))
    const targets = await source(join(STUDIO, 'server/plugins/protocol/targets.ts'))
    const api = await source(join(STUDIO, 'server/plugins/quickjs/bootstrap/src/buildApi.ts'))
    for (const permission of ['payments.customer.create', 'payments.customer.refund']) {
      expect(permissions).toContain(`'${permission}'`)
      expect(capabilities).toContain(`permission: '${permission}'`)
      expect(targets).toContain(`'${permission}'`)
    }
    expect(targets).toContain("'payments.customer.receipt': 'payments.customer.create'")
    expect(api).toContain("assertTargetPermission('payments.customer.create')")
    expect(api).toContain("assertTargetPermission('payments.customer.refund')")
    expect(schemas).toContain("{ additionalProperties: false }")
    expect(schemas).not.toMatch(/\bzod\b|from ['"]zod/i)
  })

  test('extends the existing customer-payment composition and keeps one credential/transport authority', async () => {
    const runtime = await source(join(STUDIO, 'server/fuma/customerPayments/runtime.ts'))
    const service = await source(join(STUDIO, 'server/fuma/customerPayments/plugin.ts'))
    expect(runtime).toContain('new PostgresCustomerPaymentRepository(input.db)')
    expect(runtime).toContain('new PostgresCustomerPluginPaymentRepository(input.db)')
    expect(runtime).toContain('credentials: repository')
    expect(runtime).toContain('transports: input.transports')
    expect(runtime).toContain('createCustomerPluginPaymentPurposes(pluginRepository, now)')
    expect(service).toContain("transport.scope !== 'customer_merchant'")
    expect(service).toContain('decryptSecret(cipher, credential)')
    const legacyGovernance = await source(join(ROOT, 'packages/fuma-governance-launch/src/plugins.ts'))
    expect(legacyGovernance).not.toContain('class ReviewedCustomerPaymentBinding')
    expect(legacyGovernance).not.toContain('interface CustomerMerchantPort')
    expect(service).not.toMatch(/new ScopedPaystackTransport|class .*Ledger|ingestWebhook\(/)
  })

  test('registers one additive migration at the canonical high-water mark', () => {
    const ids = hostedMigrations.map(({ id }) => id)
    expect(ids.slice(-5)).toEqual([
      '000071_artifact_review_marketplace',
      '000072_site_runtime_application',
      '000073_customer_payment_plugin',
      '000074_ai_payment_setup',
      '000075_component_catalog_authority',
    ])
    expect(ids.filter((id) => id === '000073_customer_payment_plugin')).toHaveLength(1)
  })

  test('keeps the implementation bounded and server-local', async () => {
    const files = (await readdir(join(STUDIO, 'server/fuma/customerPayments'))).filter((name) => name.endsWith('.ts'))
    for (const file of files) {
      const text = await source(join(STUDIO, 'server/fuma/customerPayments', file))
      expect({ file, zod: /\bzod\b|from ['"]zod/i.test(text), appImport: /apps\/(?:web|site-runtime|control-surfaces)\//.test(text) }).toEqual({ file, zod: false, appImport: false })
    }
  })
})
