import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import manifestJson from '../content/public/legal/approval-manifest.json'
import { parseEditorialSource } from './editorial-compiler'

const POLICY_SLUGS = ['acceptable-use', 'cookies', 'privacy', 'terms'] as const
const REQUIRED_APPROVALS = ['legal', 'privacy', 'trust-and-safety'] as const
const SHA256 = '^[a-f0-9]{64}$'
const TIMESTAMP = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'

const PolicyReceiptSchema = Type.Object({
  slug: Type.Union(POLICY_SLUGS.map((slug) => Type.Literal(slug))),
  version: Type.String({ minLength: 1, maxLength: 40, pattern: '^[0-9A-Za-z._-]+$' }),
  sourceSha256: Type.String({ pattern: SHA256 }),
}, { additionalProperties: false })

const ApprovalSchema = Type.Object({
  role: Type.Union(REQUIRED_APPROVALS.map((role) => Type.Literal(role))),
  actor: Type.String({ minLength: 2, maxLength: 120, pattern: '^[^\\u0000-\\u001F\\u007F]+$' }),
  approvedAt: Type.String({ minLength: 20, maxLength: 20, pattern: TIMESTAMP }),
  policySetSha256: Type.String({ pattern: SHA256 }),
}, { additionalProperties: false })

const WithdrawalSchema = Type.Object({
  actor: Type.String({ minLength: 2, maxLength: 120, pattern: '^[^\\u0000-\\u001F\\u007F]+$' }),
  withdrawnAt: Type.String({ minLength: 20, maxLength: 20, pattern: TIMESTAMP }),
  reason: Type.String({ minLength: 10, maxLength: 500, pattern: '^[^\\u0000-\\u001F\\u007F]+$' }),
  policySetSha256: Type.String({ pattern: SHA256 }),
}, { additionalProperties: false })

export const LegalPolicyApprovalManifestSchema = Type.Object({
  schemaVersion: Type.Literal(2),
  manifestVersion: Type.String({ minLength: 1, maxLength: 40, pattern: '^[0-9A-Za-z._-]+$' }),
  issuedAt: Type.String({ minLength: 20, maxLength: 20, pattern: TIMESTAMP }),
  supersedesPolicySetSha256: Type.Union([Type.String({ pattern: SHA256 }), Type.Null()]),
  approvalState: Type.Union([
    Type.Literal('pending'),
    Type.Literal('approved'),
    Type.Literal('withdrawn'),
  ]),
  policySetSha256: Type.String({ pattern: SHA256 }),
  requiredApprovals: Type.Tuple(REQUIRED_APPROVALS.map((role) => Type.Literal(role))),
  policies: Type.Array(PolicyReceiptSchema, { minItems: 4, maxItems: 4 }),
  approvals: Type.Array(ApprovalSchema, { maxItems: 3 }),
  withdrawal: Type.Union([WithdrawalSchema, Type.Null()]),
}, { additionalProperties: false })

export type LegalPolicyApprovalManifest = Readonly<Static<typeof LegalPolicyApprovalManifestSchema>>

const APP_CWD = process.cwd().endsWith(`${path.sep}apps${path.sep}web`)
  ? process.cwd()
  : path.join(process.cwd(), 'apps', 'web')
const LEGAL_ROOT = path.join(APP_CWD, 'content', 'public', 'legal')

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function policySetDigest(policies: LegalPolicyApprovalManifest['policies']): string {
  return sha256(policies.map(({ slug, version, sourceSha256 }) => `${slug}\0${version}\0${sourceSha256}`).join('\n'))
}

function canonicalTimestamp(value: string): boolean {
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) && new Date(epoch).toISOString().replace(/\.\d{3}Z$/, 'Z') === value
}

export function validateLegalPolicyManifestState(value: unknown): LegalPolicyApprovalManifest {
  if (!Value.Check(LegalPolicyApprovalManifestSchema, value)) {
    throw new Error('Invalid legal policy approval manifest')
  }
  const manifest = value as LegalPolicyApprovalManifest
  if (!canonicalTimestamp(manifest.issuedAt)) throw new Error('Legal policy manifest issue timestamp is invalid')
  if (manifest.supersedesPolicySetSha256 === manifest.policySetSha256) {
    throw new Error('Legal policy manifest cannot supersede itself')
  }
  const slugs = manifest.policies.map(({ slug }) => slug)
  if (slugs.join(',') !== POLICY_SLUGS.join(',')) throw new Error('Legal policy manifest must be complete and sorted')
  if (new Set(slugs).size !== POLICY_SLUGS.length) throw new Error('Legal policy manifest contains a duplicate policy')
  if (policySetDigest(manifest.policies) !== manifest.policySetSha256) {
    throw new Error('Legal policy set digest does not match its receipts')
  }

  const approvalRoles = manifest.approvals.map(({ role }) => role)
  if (new Set(approvalRoles).size !== approvalRoles.length) throw new Error('Legal policy approval role is duplicated')
  if (manifest.approvals.some(({ approvedAt, policySetSha256 }) => !canonicalTimestamp(approvedAt)
    || policySetSha256 !== manifest.policySetSha256)) {
    throw new Error('Legal policy approval targets invalid time or a different policy set')
  }
  const completeApproval = REQUIRED_APPROVALS.every((role) => approvalRoles.includes(role))
  if (manifest.approvalState === 'pending' && (manifest.approvals.length !== 0 || manifest.withdrawal !== null)) {
    throw new Error('Pending legal policy set cannot contain approval or withdrawal claims')
  }
  if (manifest.approvalState === 'approved' && (!completeApproval || manifest.withdrawal !== null)) {
    throw new Error('Approved legal policy set requires every named review role and no withdrawal')
  }
  if (manifest.approvalState === 'withdrawn') {
    if (!manifest.withdrawal || !canonicalTimestamp(manifest.withdrawal.withdrawnAt)
      || manifest.withdrawal.policySetSha256 !== manifest.policySetSha256) {
      throw new Error('Withdrawn legal policy set requires a matching withdrawal record')
    }
    if (manifest.approvals.length !== 0 && !completeApproval) {
      throw new Error('Withdrawn legal policy set cannot preserve partial approval claims')
    }
  }
  return Object.freeze(manifest)
}

export async function readLegalPolicyApprovalManifest(): Promise<LegalPolicyApprovalManifest> {
  const manifest = validateLegalPolicyManifestState(manifestJson)
  for (const receipt of manifest.policies) {
    const sourcePath = path.join(LEGAL_ROOT, `${receipt.slug}.md`)
    const source = await fs.readFile(sourcePath, 'utf8')
    const entry = parseEditorialSource(source, sourcePath)
    if (entry.meta.collection !== 'legal' || entry.meta.slug !== receipt.slug || entry.meta.version !== receipt.version) {
      throw new Error(`Legal policy receipt does not match ${receipt.slug} metadata`)
    }
    if (sha256(source) !== receipt.sourceSha256) throw new Error(`Legal policy receipt does not match ${receipt.slug} bytes`)
  }
  return manifest
}

export const __legalPolicyApprovalTest = Object.freeze({ policySetDigest, sha256 })
