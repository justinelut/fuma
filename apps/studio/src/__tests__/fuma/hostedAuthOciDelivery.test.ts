import { createHostedAuthOciDelivery } from '../../../server/auth/hosted/ociDelivery'
import type { OciEmailDeliveryProvider } from '../../../server/fuma/publication/servicePorts'

const config = {
  environment: 'production' as const,
  hosts: { product: 'admin.trimly.co.ke', marketing: 'trimly.co.ke', marketingStatus: 'deferred' as const },
  ociEmail: {
    region: 'af-johannesburg-1',
    tenancyId: 'ocid1.tenancy.oc1..test',
    userId: 'ocid1.user.oc1..test',
    fingerprint: '00:11:22',
    privateKeyPem: 'unused-by-injected-provider',
    compartmentId: 'ocid1.compartment.oc1..test',
    approvedSender: 'staff@trimly.co.ke',
    eventVerificationSecret: 'unused-event-secret',
  },
}

describe('FUMA-072 hosted auth OCI delivery', () => {
  test('delivers protected-owner recovery through the existing OCI authority without leaking unescaped HTML', async () => {
    const submitted: Parameters<OciEmailDeliveryProvider['submit']>[0][] = []
    const delivery = createHostedAuthOciDelivery({
      config,
      provider: { async submit(input) { submitted.push(input); return { providerMessageId: 'oci-message-1' } } },
    })
    await delivery.sendPasswordReset({ email: 'owner@example.com', name: '<Protected Owner>', url: 'https://admin.trimly.co.ke/api/auth/reset-password?token=opaque' })
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toMatchObject({
      recipient: 'owner@example.com', senderEmail: 'staff@trimly.co.ke', replyToEmail: 'staff@trimly.co.ke',
      subject: 'Reset your Fuma staff password', headers: { 'X-Fuma-Auth-Message': 'password-reset' },
    })
    expect(submitted[0]!.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
    expect(submitted[0]!.html).toContain('&lt;Protected Owner&gt;')
    expect(submitted[0]!.html).not.toContain('<Protected Owner>')
    expect(submitted[0]!.text).toContain('https://admin.trimly.co.ke/api/auth/reset-password?token=opaque')
  })

  test('rejects non-product and non-HTTPS links before delivery', async () => {
    let calls = 0
    const delivery = createHostedAuthOciDelivery({ config, provider: { async submit() { calls += 1; return { providerMessageId: 'unexpected' } } } })
    await expect(delivery.sendVerification({ email: 'staff@example.com', name: 'Staff', url: 'https://attacker.example/verify' })).rejects.toThrow('configured product HTTPS origin')
    await expect(delivery.sendPasswordReset({ email: 'staff@example.com', name: 'Staff', url: 'http://admin.trimly.co.ke/reset' })).rejects.toThrow('configured product HTTPS origin')
    await expect(delivery.sendPasswordReset({ email: 'staff@example.com', name: 'Staff', url: 'https://admin.trimly.co.ke:444/reset' })).rejects.toThrow('configured product HTTPS origin')
    expect(calls).toBe(0)
  })

  test('supports the exact central auth host with customer-account wording', async () => {
    const submitted: Parameters<OciEmailDeliveryProvider['submit']>[0][] = []
    const delivery = createHostedAuthOciDelivery({
      config,
      linkHost: 'auth.trimly.co.ke',
      audience: 'account',
      provider: { async submit(input) { submitted.push(input); return { providerMessageId: 'oci-auth-message' } } },
    })
    await delivery.sendVerification({ email: 'user@example.com', name: 'Customer', url: 'https://auth.trimly.co.ke/api/auth/verify-email?token=opaque' })
    expect(submitted[0]?.subject).toBe('Verify your Fuma account email')
    await expect(delivery.sendVerification({ email: 'user@example.com', name: 'Customer', url: 'https://admin.trimly.co.ke/api/auth/verify-email?token=opaque' })).rejects.toThrow('configured product HTTPS origin')
  })

  test('cannot be composed outside production', () => {
    expect(() => createHostedAuthOciDelivery({ config: { ...config, environment: 'local' }, provider: { async submit() { return { providerMessageId: 'unused' } } } })).toThrow('production-only')
  })
})
