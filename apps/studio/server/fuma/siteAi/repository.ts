import type {
  SiteAiAuditFact,
  SiteAiConversationBinding,
  SiteAiSnapshotBinding,
  SiteAiToolReceipt,
  SiteAiTurnJob,
} from './contracts'

export type SiteAiToolClaim = Readonly<
  | { outcome: 'claimed'; receipt: SiteAiToolReceipt }
  | { outcome: 'replay'; receipt: SiteAiToolReceipt }
  | { outcome: 'in-flight'; receipt: SiteAiToolReceipt }
  | { outcome: 'conflict'; receipt: SiteAiToolReceipt }
>

/**
 * FUMA-065 persists only scope bindings, hashes, jobs, receipts, and audit.
 * Native `server/ai/conversations/store.ts` remains the sole message/history
 * authority; this repository never stores prompts, messages, or snapshots.
 */
export interface SiteAiRepository {
  putConversation(binding: SiteAiConversationBinding): Promise<SiteAiConversationBinding>
  conversation(conversationId: string): Promise<SiteAiConversationBinding | null>
  putSnapshot(binding: SiteAiSnapshotBinding): Promise<SiteAiSnapshotBinding>
  snapshot(snapshotId: string): Promise<SiteAiSnapshotBinding | null>
  putJob(job: SiteAiTurnJob): Promise<SiteAiTurnJob>
  job(jobId: string): Promise<SiteAiTurnJob | null>
  updateJob(job: SiteAiTurnJob, expectedState: SiteAiTurnJob['state']): Promise<boolean>
  claimTool(receipt: SiteAiToolReceipt): Promise<SiteAiToolClaim>
  completeTool(receipt: SiteAiToolReceipt): Promise<SiteAiToolReceipt>
  appendAudit(fact: SiteAiAuditFact): Promise<void>
  auditForConversation(conversationId: string): Promise<readonly SiteAiAuditFact[]>
}
