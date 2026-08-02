import type { ExpertInquiryReceipt, ExpertPluginLink, ExpertProfileRecord } from './contracts'
import type { ExpertDiscoveryRepository } from './service'

const clone = <T>(value: T): T => structuredClone(value)

export class MemoryExpertDiscoveryRepository implements ExpertDiscoveryRepository {
  readonly profiles = new Map<string, ExpertProfileRecord>()
  readonly links = new Map<string, ExpertPluginLink>()
  readonly inquiries = new Map<string, Readonly<{ receipt: ExpertInquiryReceipt; senderFingerprintSha256: string }>>()

  async approve(input: Parameters<ExpertDiscoveryRepository['approve']>[0]): Promise<boolean> {
    if (this.profiles.has(input.profile.expertId) || [...this.profiles.values()].some((profile) => profile.public.id === input.profile.public.id || profile.public.slug === input.profile.public.slug)) return false
    this.profiles.set(input.profile.expertId, clone(input.profile)); return true
  }
  async get(expertId: string): Promise<ExpertProfileRecord | null> { const value = this.profiles.get(expertId); return value ? clone(value) : null }
  async listCandidates(): Promise<readonly ExpertProfileRecord[]> { return [...this.profiles.values()].map(clone) }
  async replace(profile: ExpertProfileRecord, expectedPublicRevision: number): Promise<boolean> {
    const current = this.profiles.get(profile.expertId)
    if (!current || current.publicRevision !== expectedPublicRevision || profile.publicRevision !== expectedPublicRevision + 1) return false
    this.profiles.set(profile.expertId, clone(profile)); return true
  }
  async putPluginLink(link: ExpertPluginLink, expectedPublicRevision: number): Promise<boolean> {
    const profile = this.profiles.get(link.expertId); if (!profile || profile.publicRevision !== expectedPublicRevision) return false
    const key = `${link.expertId}\0${link.pluginId}`; if (this.links.has(key)) return false
    this.links.set(key, clone(link)); this.profiles.set(link.expertId, { ...profile, publicRevision: profile.publicRevision + 1 }); return true
  }
  async listPluginLinks(expertId: string): Promise<readonly ExpertPluginLink[]> { return [...this.links.values()].filter((value) => value.expertId === expertId).map(clone) }
  async putInquiry(receipt: ExpertInquiryReceipt, senderFingerprintSha256: string): Promise<boolean> {
    if (this.inquiries.has(receipt.inquiryId)) return false
    this.inquiries.set(receipt.inquiryId, clone({ receipt, senderFingerprintSha256 })); return true
  }
  async inquiryCount(expertId: string): Promise<number> { return [...this.inquiries.values()].filter(({ receipt }) => receipt.expertId === expertId).length }
}
