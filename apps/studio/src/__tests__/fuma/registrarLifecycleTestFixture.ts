import { platformCredentialAuthority, type DomainScope } from '../../../server/fuma/domains/contracts'
import type { RegistrarQuote, RegistrationContacts } from '../../../server/fuma/registrar/contracts'
import {
  DeterministicFakeRegistrarProvider,
  FakeFumaManagedDnsOnboarding,
  FakeRegistrarClock,
} from '../../../server/fuma/registrar/fakes'
import { MemoryRegistrarWorkflowRepository } from '../../../server/fuma/registrar/memory'
import { RegistrarWorkflow, type RegistrarWorkflowRepository } from '../../../server/fuma/registrar/workflow'

export const registrarScope: DomainScope = Object.freeze({
  platformId: 'fuma',
  organizationId: 'organization-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  ownerKey: 'owner-a',
  generation: 4,
  state: 'active',
  transferFence: null,
  profileId: 'website',
})

export const registrarAuthority = platformCredentialAuthority(registrarScope.platformId)

const contact = Object.freeze({
  name: 'Fuma Registrant',
  email: 'registrant@example.test',
  phoneE164: '+254700000000',
  address: 'Nairobi, Kenya',
  country: 'KE' as const,
})

export const registrarContacts: RegistrationContacts = Object.freeze({
  registrant: contact,
  administrative: contact,
  technical: contact,
  billing: contact,
})

export type RegistrarHarness = ReturnType<typeof createRegistrarHarness>

export function createRegistrarHarness(input: Readonly<{
  repository?: RegistrarWorkflowRepository
  entitled?: boolean
}> = {}) {
  const clock = new FakeRegistrarClock()
  const provider = new DeterministicFakeRegistrarProvider(registrarAuthority, clock.now)
  const repository = input.repository ?? new MemoryRegistrarWorkflowRepository()
  const onboarding = new FakeFumaManagedDnsOnboarding()
  const stepUpPurposes: string[] = []
  const workflow = new RegistrarWorkflow({
    provider,
    repository,
    stepUp: {
      async consume(proof, purpose) {
        stepUpPurposes.push(`${proof}:${purpose}`)
        return proof === 'fresh-step-up'
      },
    },
    entitled: async () => input.entitled ?? true,
    onboarding,
    authority: registrarAuthority,
    credentialId: 'credential-registrar',
    now: clock.now,
  })
  return { clock, provider, repository, onboarding, stepUpPurposes, workflow }
}

export async function quoted(harness: RegistrarHarness, hostname = 'Example.CO.KE.', periodYears = 1): Promise<RegistrarQuote> {
  return await harness.workflow.searchAndQuote(registrarScope, { hostname, periodYears })
}

export function purchaseCommand(quote: RegistrarQuote, requestId = 'purchase-request-1') {
  return {
    requestId,
    quoteId: quote.quoteId,
    expectedHostname: quote.hostname,
    expectedAmountMinor: quote.registrationAmountMinor,
    currency: quote.currency,
    expectedTermsHash: quote.termsHash,
    contacts: registrarContacts,
    confirmation: `PURCHASE ${quote.hostname}`,
    stepUpProof: 'fresh-step-up',
  } as const
}

export function renewalCommand(
  quote: RegistrarQuote,
  registration: Readonly<{ registrationId: string; hostname: string; expiresAt: string }>,
  requestId = 'renewal-request-1',
) {
  return {
    requestId,
    registrationId: registration.registrationId,
    quoteId: quote.quoteId,
    expectedHostname: registration.hostname,
    expectedPreviousExpiresAt: registration.expiresAt,
    expectedAmountMinor: quote.renewalAmountMinor,
    currency: quote.currency,
    periodYears: quote.periodYears,
    expectedTermsHash: quote.termsHash,
    confirmation: `RENEW ${registration.hostname}`,
    stepUpProof: 'fresh-step-up',
  } as const
}
