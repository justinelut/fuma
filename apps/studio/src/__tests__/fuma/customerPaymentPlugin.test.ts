import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { parsePluginManifest } from '@core/plugins/manifest'
import type { PluginManifest } from '@core/plugin-sdk'
import type { DbClient, DbResult } from '../../../server/db/client'
import {
  ArtifactInstallationAuthority,
  type ArtifactAuthorityRepository,
  type ArtifactCrash,
  type ArtifactInstallation,
  type ArtifactRelease,
  type ArtifactSchedule,
  type ArtifactStorageUsage,
  type ArtifactTransferReceipt,
  type SharedArtifactObjectStore,
} from '../../../server/fuma/artifacts'
import {
  ArtifactReviewService,
  ArtifactScannerRegistry,
  Ed25519ArtifactReviewSigner,
  reviewHash,
  type ApprovedArtifactReview,
  type ArtifactReviewDecision,
  type ArtifactReviewRepository,
  type ArtifactReviewRevocation,
  type ArtifactReviewSubmission,
  type ArtifactScanReport,
  type ReviewPackageMetadata,
} from '../../../server/fuma/artifactReviews'
import { MemoryPaystackLedger } from '../../../server/fuma/paystack/memoryLedger'
import {
  PaystackPurposeRegistry,
  ScopedPaystackTransport,
  signPaystackWebhook,
  type PaystackHttp,
} from '../../../server/fuma/paystack/transport'
import { MemoryCustomerPaymentRepository } from '../../../server/fuma/customerPayments/service'
import { DeterministicCustomerPaymentCipher } from '../../../server/fuma/customerPayments/fakes'
import {
  CustomerMerchantPluginPaymentService,
  MemoryCustomerPluginPaymentRepository,
  ReviewedCustomerPaymentPluginBinding,
  createCustomerPluginPaymentPurposes,
} from '../../../server/fuma/customerPayments/plugin'
import { sha256Hex } from '../../../server/fuma/objectStorage'
import { bindHostCustomerPayments, resetHostCustomerPaymentBindingsForTesting } from '../../../server/plugins/host/paymentBindings'
import { loadPluginInWorker, runLifecycleInWorker, runRouteInWorker, unloadPluginInWorker } from '../../../server/plugins/host/rpc'
import { setPluginWorkerDbClient } from '../../../server/plugins/runtime'
import { createModulePackVm } from '../../../server/plugins/modulePackVm'

const ROOT = join(import.meta.dir, '../../../../..')
const PACKAGE = join(ROOT, 'packages/fuma-governance-launch/plugins/customer-payments')
const NOW = '2026-07-31T08:00:00.000Z'
const REVIEWED = '2026-07-31T08:05:00.000Z'
const PLUGIN_ID = 'fuma.customer-payments'
const scope = Object.freeze({
  platformId: 'platform-fuma', organizationId: 'organization-a', workspaceId: 'workspace-a',
  siteId: 'site-a', ownerKey: 'owner-a', ownerGeneration: 4,
})

function db(): DbClient {
  const query = (async <Row>(): Promise<DbResult<Row>> => ({ rows: [], rowCount: 0 })) as DbClient
  query.unsafe = async () => ({ rows: [], rowCount: 0 })
  query.transaction = async (work) => work(query)
  return Object.assign(query, { dialect: 'postgres' as const })
}

function pluginBytes(): Uint8Array {
  return zipSync({
    'plugin.json': strToU8(readFileSync(join(PACKAGE, 'plugin.json'), 'utf8')),
    'server/index.js': strToU8(readFileSync(join(PACKAGE, 'server/index.js'), 'utf8')),
    'editor/index.js': strToU8(readFileSync(join(PACKAGE, 'editor/index.js'), 'utf8')),
  })
}

class MemoryArtifacts implements ArtifactAuthorityRepository, SharedArtifactObjectStore {
  releases = new Map<string, ArtifactRelease>()
  bytes = new Map<string, Uint8Array>()
  installations = new Map<string, ArtifactInstallation>()
  key(value: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId'>) { return `${value.platformId}:${value.ownerKey}:${value.installationId}` }
  async readArtifact(id: string) { return structuredClone(this.releases.get(id) ?? null) }
  async insertArtifact(value: ArtifactRelease) { if (this.releases.has(value.artifactId)) return false; this.releases.set(value.artifactId, structuredClone(value)); return true }
  async readInstallation(value: Pick<ArtifactInstallation, 'platformId' | 'ownerKey' | 'installationId'>) { return structuredClone(this.installations.get(this.key(value)) ?? null) }
  async insertInstallation(value: ArtifactInstallation) { const key = this.key(value); if (this.installations.has(key)) return false; this.installations.set(key, structuredClone(value)); return true }
  async replaceInstallation(current: ArtifactInstallation, next: ArtifactInstallation) { const key = this.key(current); const stored = this.installations.get(key); if (!stored || stored.version !== current.version) return false; this.installations.delete(key); this.installations.set(this.key(next), structuredClone(next)); return true }
  async transferInstallation(current: ArtifactInstallation, next: ArtifactInstallation, _receipt: ArtifactTransferReceipt) { return this.replaceInstallation(current, next) }
  async countSchedules(_installation: ArtifactInstallation) { return 0 }
  async putScheduleIfAbsent(_schedule: ArtifactSchedule) { return true }
  async putStorageUsage(_installation: ArtifactInstallation, _usage: ArtifactStorageUsage) { return true }
  async recordCrashAndContain(installation: ArtifactInstallation, _crash: ArtifactCrash, next: ArtifactInstallation) { return this.replaceInstallation(installation, next) }
  async consumeCalls(_installation: ArtifactInstallation, _window: string, _units: number) { return true }
  async putIfAbsent(artifact: ArtifactRelease, bytes: Uint8Array) { if (this.bytes.has(artifact.artifactId)) return 'exists' as const; this.bytes.set(artifact.artifactId, bytes.slice()); return 'inserted' as const }
  async get(artifact: ArtifactRelease) { const value = this.bytes.get(artifact.artifactId); if (!value) throw new Error('artifact bytes missing'); return value.slice() }
}

class MemoryReviews implements ArtifactReviewRepository {
  submissions = new Map<string, { submission: ArtifactReviewSubmission; scans: readonly ArtifactScanReport[] }>()
  decisions = new Map<string, ArtifactReviewDecision>()
  revocations = new Map<string, ArtifactReviewRevocation>()
  async readSubmission(id: string) { return structuredClone(this.submissions.get(id) ?? null) }
  async insertSubmission(submission: ArtifactReviewSubmission, scans: readonly ArtifactScanReport[]) { if (this.submissions.has(submission.submissionId)) return false; this.submissions.set(submission.submissionId, structuredClone({ submission, scans })); return true }
  async readDecision(id: string) { return structuredClone(this.decisions.get(id) ?? null) }
  async insertDecision(value: ArtifactReviewDecision) { if (this.decisions.has(value.submissionId)) return false; this.decisions.set(value.submissionId, structuredClone(value)); return true }
  async readRevocation(id: string) { return structuredClone(this.revocations.get(id) ?? null) }
  async insertRevocation(value: ArtifactReviewRevocation) { if (this.revocations.has(value.decisionId)) return false; this.revocations.set(value.decisionId, structuredClone(value)); return true }
  async listApproved() {
    const output: ApprovedArtifactReview[] = []
    for (const [submissionId, decision] of this.decisions) {
      const record = this.submissions.get(submissionId)
      if (record && decision.decision === 'approved' && !this.revocations.has(decision.decisionId)) output.push({ ...structuredClone(record), decision: structuredClone(decision), revocation: null })
    }
    return output
  }
}

class CustomerProvider implements PaystackHttp {
  requests: Array<Readonly<{ method: string; authorization: string; body?: string }>> = []
  transactions = new Map<string, Record<string, unknown>>()
  async request(input: Readonly<{ url: string; method: 'GET' | 'POST'; headers: Readonly<Record<string, string>>; body?: string }>) {
    this.requests.push({ method: input.method, authorization: input.headers.authorization ?? '', ...(input.body ? { body: input.body } : {}) })
    if (input.method === 'POST') {
      const body = JSON.parse(input.body ?? '{}') as { reference: string; amount: number; currency: string; metadata: Record<string, string> }
      this.transactions.set(body.reference, {
        id: `transaction-${this.transactions.size + 1}`, reference: body.reference, status: 'success',
        amount: body.amount, currency: body.currency, channel: 'card', metadata: body.metadata,
      })
      return { status: 200, body: { status: true, data: { reference: body.reference, authorization_url: `https://checkout.example.test/${body.reference}` } } }
    }
    const reference = decodeURIComponent(input.url.split('/').at(-1) ?? '')
    const transaction = this.transactions.get(reference)
    return transaction ? { status: 200, body: { status: true, data: transaction } } : { status: 404, body: { status: false } }
  }
}

function release(bytes: Uint8Array, permissions: readonly string[]): ArtifactRelease {
  return {
    schemaVersion: 1, artifactId: 'artifact-customer-payments-1', kind: 'plugin', packageId: PLUGIN_ID,
    exactVersion: '1.0.0', executionPolicy: 'plugin-sandbox-worker',
    objectKey: 'artifacts/plugin/fuma.customer-payments/1.0.0.zip', mimeType: 'application/zip',
    contentHashSha256: sha256Hex(bytes), sizeBytes: bytes.byteLength, permissions: [...permissions],
    provenance: { sourceHashSha256: 'a'.repeat(64), lockHashSha256: 'b'.repeat(64), builderId: 'fuma-first-party-builder' }, createdAt: NOW,
  }
}
function reviewMetadata(artifact: ArtifactRelease): ReviewPackageMetadata {
  return {
    dependencies: [],
    schemas: [
      { schemaId: 'customer-payment-create-v1', schemaHashSha256: 'c'.repeat(64) },
      { schemaId: 'customer-payment-receipt-v1', schemaHashSha256: 'd'.repeat(64) },
      { schemaId: 'customer-payment-refund-v1', schemaHashSha256: 'e'.repeat(64) },
    ],
    evidence: {
      provenanceHashSha256: reviewHash(artifact.provenance),
      license: { spdx: 'MIT', evidenceHashSha256: 'f'.repeat(64) },
      accessibility: { standard: 'WCAG2.2-AA', evidenceHashSha256: '1'.repeat(64) },
      runtimeCompatibility: { runtime: 'fuma-site-runtime', minimumVersion: '1.0.0', evidenceHashSha256: '2'.repeat(64) },
    },
    public: { id: PLUGIN_ID, slug: 'customer-payments', name: 'Fuma Customer Payments', summary: 'Reviewed host-bound KES payment blocks.', categories: ['payments'], publisherName: 'Fuma', publisherVerified: true, permissionLabels: [...artifact.permissions], imageUrl: null },
  }
}
function installation(artifact: ArtifactRelease): ArtifactInstallation {
  return { ...scope, installationId: 'installation-customer-payments', artifactId: artifact.artifactId, artifactKind: 'plugin', packageId: artifact.packageId, exactVersion: artifact.exactVersion, contentHashSha256: artifact.contentHashSha256, executionPolicy: 'plugin-sandbox-worker', settingsObjectKey: null, secret: null, state: 'active', workerGeneration: 1, quota: { storageBytes: 1024, scheduledJobs: 0, callsPerMinute: 100 }, previousArtifactId: null, version: 1, installedAt: REVIEWED, updatedAt: REVIEWED }
}

async function pluginRoute(path: string, body: unknown): Promise<Response> {
  return await runRouteInWorker({
    pluginId: PLUGIN_ID, method: 'POST', path,
    request: new Request(`https://app.example.test/admin/api/cms/plugins/${PLUGIN_ID}/runtime${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    user: { id: 'staff-a', email: 'staff@example.test', capabilities: ['plugins.read'] },
  })
}

async function fixture() {
  const bytes = pluginBytes()
  const manifest = parsePluginManifest(JSON.parse(readFileSync(join(PACKAGE, 'plugin.json'), 'utf8'))) as PluginManifest
  const artifact = release(bytes, manifest.permissions)
  const memory = new MemoryArtifacts()
  const artifacts = new ArtifactInstallationAuthority({ repository: memory, objects: memory, workers: { async dispatch() { throw new Error('worker dispatch is not used') } }, now: () => new Date(REVIEWED) })
  await artifacts.register(artifact, bytes)
  const reviewRepository = new MemoryReviews()
  const keys = generateKeyPairSync('ed25519')
  const reviews = new ArtifactReviewService({
    repository: reviewRepository, artifacts, scanners: new ArtifactScannerRegistry(),
    signer: new Ed25519ArtifactReviewSigner({ keyId: 'review-key-a', privateKeyPem: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString() }),
  })
  await reviews.submit({ submissionId: 'submission-customer-payments', artifactId: artifact.artifactId, contentHashSha256: artifact.contentHashSha256, submitterId: 'publisher-a', baselineSubmissionId: null, metadata: reviewMetadata(artifact), submittedAt: NOW })
  const decision = await reviews.decide({ decisionId: 'decision-customer-payments', submissionId: 'submission-customer-payments', reviewerId: 'reviewer-a', decision: 'approved', reason: 'First-party payment package passed deterministic review.', decidedAt: REVIEWED })
  const installed = await reviews.install({ submissionId: 'submission-customer-payments', installation: installation(artifact), grantedPermissions: artifact.permissions })

  const credentials = new MemoryCustomerPaymentRepository()
  const cipher = new DeterministicCustomerPaymentCipher()
  const provider = new CustomerProvider()
  const ledger = new MemoryPaystackLedger(() => `claim-${crypto.randomUUID()}`)
  const registry = new PaystackPurposeRegistry()
  const payments = new MemoryCustomerPluginPaymentRepository()
  for (const purpose of createCustomerPluginPaymentPurposes(payments, () => new Date(REVIEWED))) registry.register(purpose)
  const transport = new ScopedPaystackTransport({ scope: 'customer_merchant', publicKey: 'fixture-public', secretKey: 'fixture-secret' }, provider, ledger, registry, { providerBaseUrl: 'https://provider.example.test' })
  const service = new CustomerMerchantPluginPaymentService({
    credentials, repository: payments, cipher,
    transports: { forCredential: () => transport },
    refunds: { forCredential: () => ({ async refund(input) { return { providerRefundId: `provider-${input.refundId}` } } }) },
    now: () => new Date(REVIEWED),
  })
  await credentials.saveCredential({ credentialId: 'credential-a', scope: 'customer_merchant', merchantScope: scope, version: 1, envelope: await cipher.encrypt(`customer_merchant:${Object.values(scope).join(':')}:credential-a:1`, new TextEncoder().encode(JSON.stringify({ scope: 'customer_merchant', publicKey: 'pk_customer', secretKey: 'sk_customer' }))), state: 'active', createdAt: NOW, updatedAt: NOW })

  const binding = new ReviewedCustomerPaymentPluginBinding({ submissionId: 'submission-customer-payments', installation: installed, siteOrigin: 'https://site.example.test', reviews, installations: artifacts, payments: service })
  setPluginWorkerDbClient(db())
  const loaded = await loadPluginInWorker({ manifest: { ...manifest, grantedPermissions: [...manifest.permissions] }, entryFileUrl: join(PACKAGE, 'server/index.js'), settings: {} })
  expect(loaded.ok).toBe(true)
  bindHostCustomerPayments(binding)
  await runLifecycleInWorker(PLUGIN_ID, 'activate')
  return { artifact, artifacts, binding, decision, installed, ledger, manifest, payments, provider, reviewRepository, reviews, transport }
}

afterEach(async () => {
  try { await unloadPluginInWorker(PLUGIN_ID) } catch { /* worker may already be absent */ }
  resetHostCustomerPaymentBindingsForTesting()
})

describe('FUMA-069 reviewed customer-payment plugin sandbox E2E', () => {
  test('reviews, installs, and settles deposit, donation, and checkout through one shared ledger', async () => {
    const value = await fixture()
    const pack = await createModulePackVm({ pluginId: PLUGIN_ID, packSource: readFileSync(join(PACKAGE, 'editor/index.js'), 'utf8') })
    try {
      expect(pack.modules.map(({ id }) => id).sort()).toEqual([
        'fuma.customer-payments.checkout',
        'fuma.customer-payments.deposit',
        'fuma.customer-payments.donation',
      ])
      expect(pack.render('fuma.customer-payments.deposit', { label: '<Deposit>', amountMinor: 12_500, returnPath: '/complete' }, []).html)
        .toContain('&lt;Deposit&gt; — KES 125.00')
    } finally {
      pack.dispose()
    }
    const outputs: unknown[] = []
    for (const [index, purpose] of ['deposit', 'donation', 'checkout'].entries()) {
      const created = await pluginRoute('/checkout', { requestId: `request-${purpose}`, purpose, amountMinor: (index + 1) * 10_000, currency: 'KES', payerEmail: `${purpose}@example.test`, returnPath: '/complete' })
      expect(created.status).toBe(200)
      const initialization = await created.json() as { paymentId: string; reference: string }
      const settled = await pluginRoute('/receipt', { paymentId: initialization.paymentId, reference: initialization.reference })
      expect(settled.status).toBe(200)
      outputs.push(initialization, await settled.json())
    }
    expect(value.payments.receipts.size).toBe(3)
    expect(value.ledger.reconciliations.size).toBe(3)
    expect([...value.ledger.reconciliations.keys()].map((key) => key.split(':').at(-1)).sort()).toEqual(['fuma-plugin-checkout', 'fuma-plugin-deposit', 'fuma-plugin-donation'])

    const checkout = [...value.payments.receipts.values()].find(({ purpose }) => purpose === 'checkout')!
    const refunded = await pluginRoute('/refund', { receiptId: checkout.receiptId, requestId: 'refund-checkout', reason: 'Customer requested a complete checkout refund.' })
    expect(refunded.status).toBe(200)
    expect(await refunded.json()).toMatchObject({ receiptId: checkout.receiptId, state: 'refunded', amountMinor: 30_000 })
    const refundReplay = await pluginRoute('/refund', { receiptId: checkout.receiptId, requestId: 'refund-checkout', reason: 'Customer requested a complete checkout refund.' })
    expect(refundReplay.status).toBe(200)
    const conflictingRefundReplay = await pluginRoute('/refund', { receiptId: checkout.receiptId, requestId: 'refund-checkout-other', reason: 'Customer requested a complete checkout refund.' })
    expect(conflictingRefundReplay.status).toBe(500)
    expect(value.payments.refunds.size).toBe(1)

    const firstPayment = [...value.payments.payments.values()][0]!
    const transaction = value.provider.transactions.get(firstPayment.reference!)!
    const labels = transaction.metadata as Record<string, string>
    const raw = new TextEncoder().encode(JSON.stringify({ event: 'charge.success', data: { id: 'event-transaction-a', reference: firstPayment.reference, amount: firstPayment.metadata.amountMinor, currency: 'KES', metadata: labels } }))
    const signature = signPaystackWebhook('fixture-secret', raw)
    expect((await value.transport.ingestWebhook(raw, signature)).duplicate).toBe(false)
    expect((await value.transport.ingestWebhook(raw, signature)).duplicate).toBe(true)

    const transcript = JSON.stringify(outputs)
    expect(transcript).not.toContain('fixture-secret')
    expect(transcript).not.toContain('sk_customer')
    expect(transcript).not.toContain('ciphertext')
    expect(value.provider.requests.every(({ authorization }) => authorization === 'Bearer fixture-secret')).toBe(true)
    process.stdout.write('[FUMA-069 demo] review=signed install=exact sandbox=QuickJS purposes=deposit+donation+checkout receipts=3 refund=1 webhook=deduplicated ledger=shared secrets=redacted\n')
  }, 30_000)

  test('denies malformed scope claims, missing grants, revoked reviews, and non-HTTPS host bindings', async () => {
    const value = await fixture()
    const before = value.provider.requests.length
    const tampered = await pluginRoute('/checkout', { requestId: 'tampered', purpose: 'deposit', amountMinor: 99, currency: 'KES', payerEmail: 'payer@example.test', returnPath: '/complete', siteId: 'foreign-site' })
    expect(tampered.status).toBe(500)
    expect(value.provider.requests).toHaveLength(before)

    await unloadPluginInWorker(PLUGIN_ID)
    const deniedManifest = { ...value.manifest, grantedPermissions: ['cms.routes'] as PluginManifest['grantedPermissions'] }
    expect((await loadPluginInWorker({ manifest: deniedManifest, entryFileUrl: join(PACKAGE, 'server/index.js'), settings: {} })).ok).toBe(true)
    bindHostCustomerPayments(value.binding)
    await runLifecycleInWorker(PLUGIN_ID, 'activate')
    const denied = await pluginRoute('/checkout', { requestId: 'missing-grant', purpose: 'deposit', amountMinor: 1000, currency: 'KES', payerEmail: 'payer@example.test', returnPath: '/complete' })
    expect(denied.status).toBe(500)
    expect(value.provider.requests).toHaveLength(before)

    await value.reviews.revoke({ revocationId: 'revocation-customer-payments', decisionId: value.decision.decisionId, submissionId: value.decision.submissionId, artifactId: value.decision.artifactId, actorId: 'security-a', reason: 'Deterministic revocation acceptance.', revokedAt: '2026-07-31T09:00:00.000Z' })
    await expect(value.binding.create({ requestId: 'after-revoke', purpose: 'deposit', amountMinor: 1000, currency: 'KES', payerEmail: 'payer@example.test', returnPath: '/complete' })).rejects.toMatchObject({ code: 'scope' })
    expect(() => new ReviewedCustomerPaymentPluginBinding({ submissionId: 'submission-customer-payments', installation: value.installed, siteOrigin: 'http://site.example.test', reviews: value.reviews, installations: value.artifacts, payments: {} as never })).toThrow('exact HTTPS origin')
  }, 30_000)
})
