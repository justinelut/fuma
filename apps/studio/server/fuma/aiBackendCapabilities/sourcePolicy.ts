import { Type, safeParseValue, type Static } from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const
const MAX_SOURCE_BYTES = 2 * 1024 * 1024

export const FrontendSourceKindSchema = Type.Union([
  Type.Literal('ai-generated'),
  Type.Literal('imported'),
  Type.Literal('tenant-authored'),
  Type.Literal('plugin-ui'),
  Type.Literal('exported'),
])
export type FrontendSourceKind = Static<typeof FrontendSourceKindSchema>

export const FrontendSourcePolicyInputSchema = Type.Object({
  kind: FrontendSourceKindSchema,
  path: Type.String({ minLength: 1, maxLength: 1_024 }),
  source: Type.String({ maxLength: MAX_SOURCE_BYTES }),
}, Strict)

export const FRONTEND_AUTHORITY_DENIAL_CODES = Object.freeze([
  'database-import',
  'sql-surface',
  'connection-string',
  'environment-secret',
  'filesystem-process',
  'provider-sdk',
  'generated-server-code',
  'unrestricted-network',
] as const)
export type FrontendAuthorityDenialCode = (typeof FRONTEND_AUTHORITY_DENIAL_CODES)[number]

export class FrontendAuthorityPolicyError extends Error {
  override readonly name = 'FrontendAuthorityPolicyError'
  readonly code: FrontendAuthorityDenialCode | 'invalid-source'

  constructor(code: FrontendAuthorityPolicyError['code']) {
    super(code === 'invalid-source'
      ? 'Frontend source failed the bounded source contract.'
      : `Frontend source requests forbidden authority (${code}).`)
    this.code = code
  }
}

const RULES: readonly Readonly<{
  code: FrontendAuthorityDenialCode
  patterns: readonly RegExp[]
}>[] = Object.freeze([
  {
    code: 'database-import',
    patterns: [
      /(?:from|import\s*\()\s*["'][^"']*(?:server\/db|database|postgres|pg|drizzle|prisma|typeorm|sequelize|knex|kysely|mikro-orm)[^"']*["']/i,
      /require\s*\(\s*["'][^"']*(?:postgres|pg|drizzle|prisma|typeorm|sequelize|knex|kysely|mikro-orm)[^"']*["']\s*\)/i,
    ],
  },
  {
    code: 'sql-surface',
    patterns: [
      /\b(?:db|database|sql|orm)\s*\.\s*(?:query|execute|unsafe|transaction|select|insert|update|delete)\s*\(/i,
      /(?:^|[;`"'])\s*(?:select|insert\s+into|update\s+[A-Za-z_]|delete\s+from|alter\s+table|create\s+table|drop\s+table)\b/i,
      /\b(?:tableName|columnName|rawSql|sqlQuery)\s*:/i,
    ],
  },
  {
    code: 'connection-string',
    patterns: [
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb|redis):\/\//i,
      /\bDATABASE_URL\b/,
    ],
  },
  {
    code: 'environment-secret',
    patterns: [
      /\b(?:process|Bun|Deno)\.env\b/,
      /\b(?:API_KEY|SECRET_KEY|PRIVATE_KEY|ACCESS_TOKEN|CLIENT_SECRET|PAYSTACK_SECRET_KEY)\b/,
    ],
  },
  {
    code: 'filesystem-process',
    patterns: [
      /(?:from|import\s*\()\s*["'](?:node:)?(?:fs|child_process|worker_threads|cluster|vm|net|tls|dgram|http2)["']/i,
      /\b(?:spawn|execFile|execSync|fork)\s*\(/,
    ],
  },
  {
    code: 'provider-sdk',
    patterns: [
      /(?:from|import\s*\()\s*["'](?:@aws-sdk|aws-sdk|stripe|paystack|@octokit|cloudinary|resend|nodemailer|openai|@anthropic-ai)[^"']*["']/i,
    ],
  },
  {
    code: 'generated-server-code',
    patterns: [
      /["']use server["']/,
      /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/,
      /\b(?:NextRequest|NextResponse)\b/,
      /\b(?:middleware|routeHandler|serverAction)\s*[:=]/,
    ],
  },
  {
    code: 'unrestricted-network',
    patterns: [
      /\bfetch\s*\(/,
      /\b(?:WebSocket|EventSource)\s*\(/,
      /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/i,
    ],
  },
])

/**
 * Structural preflight for code that crosses an AI/import/tenant frontend
 * boundary. It deliberately returns only the source kind/path on success and
 * never returns source bytes to an authority resolver.
 */
export function assertFrontendCapabilitySource(raw: unknown): Readonly<{
  kind: FrontendSourceKind
  path: string
  sizeBytes: number
}> {
  const parsed = safeParseValue(FrontendSourcePolicyInputSchema, raw)
  if (!parsed.ok) throw new FrontendAuthorityPolicyError('invalid-source')
  const value = parsed.value
  const sizeBytes = new TextEncoder().encode(value.source).byteLength
  if (sizeBytes > MAX_SOURCE_BYTES) throw new FrontendAuthorityPolicyError('invalid-source')
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(value.source))) {
      throw new FrontendAuthorityPolicyError(rule.code)
    }
  }
  return Object.freeze({ kind: value.kind, path: value.path, sizeBytes })
}
