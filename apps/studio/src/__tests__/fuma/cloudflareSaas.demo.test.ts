import { describe, expect, it } from 'bun:test'
import { CloudflareReconcileError } from '../../../server/fuma/cloudflare/reconciler'
import {
  cloudflareDomain, cloudflareScope, createCloudflareFixture, subdomainCapability,
} from './cloudflareSaasTestFixture'

describe('FUMA-060 deterministic Cloudflare SaaS demo', () => {
  it('onboards www by records only, activates TLS, diagnoses and rolls back, then blocks unsupported apex', async () => {
    const fixture = createCloudflareFixture()
    const initial = cloudflareDomain()
    const prevalidation = await fixture.reconciler.prevalidate(cloudflareScope, initial, subdomainCapability)
    fixture.adapter.activate(prevalidation.binding.providerHostnameId)
    const ready = await fixture.reconciler.reconcile(cloudflareScope, cloudflareDomain({
      desired: 'validating', observed: 'dns-pending', certificate: 'provisioning', version: 2, operationFence: 2,
    }))
    const active = await fixture.reconciler.cutover(cloudflareScope, cloudflareDomain({
      desired: 'validating', observed: 'dns-valid', certificate: 'active', version: 3, operationFence: 3,
    }))
    const activeDomain = cloudflareDomain({ desired: 'active', observed: 'active', certificate: 'active', version: 4, operationFence: 4 })
    const diagnosis = await fixture.reconciler.diagnose(cloudflareScope, activeDomain, [prevalidation.records[0]!])
    const rollback = await fixture.reconciler.rollback(cloudflareScope, activeDomain)
    let apex: CloudflareReconcileError | null = null
    try { fixture.reconciler.assertApex('customer.co.ke', subdomainCapability) } catch (error) { apex = error as CloudflareReconcileError }

    const evidence = {
      hostname: initial.hostname, generatedRecordTypes: prevalidation.records.map(({ type }) => type),
      customerAccountRequired: prevalidation.customerAccountRequired, customerTokenRequired: prevalidation.customerTokenRequired,
      tlsReady: ready.sslStatus === 'active', activated: active.lifecycle === 'active',
      diagnosedCodes: diagnosis.diagnostics.map(({ code }) => code), rolledBack: rollback.lifecycle === 'detached',
      purgeCount: fixture.adapter.purged.length, apexBlocked: apex?.code === 'unsupported-apex',
      apexAlternatives: apex?.alternatives.length ?? 0, quoteRequired: apex?.message.includes('actual quote') ?? false,
    }
    expect(evidence).toEqual({
      hostname: 'www.customer.example', generatedRecordTypes: ['CNAME', 'TXT', 'TXT'],
      customerAccountRequired: false, customerTokenRequired: false, tlsReady: true, activated: true,
      diagnosedCodes: ['ownership-missing', 'tls-validation-missing'], rolledBack: true, purgeCount: 1,
      apexBlocked: true, apexAlternatives: 2, quoteRequired: true,
    })
    process.stdout.write(`[FUMA-060 demo] host=${evidence.hostname} records=${evidence.generatedRecordTypes.join('/')} tls=${evidence.tlsReady} active=${evidence.activated} diagnostics=${evidence.diagnosedCodes.join('/')} rollback=${evidence.rolledBack} apexBlocked=${evidence.apexBlocked} alternatives=${evidence.apexAlternatives} quoteRequired=${evidence.quoteRequired}\n`)
  })
})
