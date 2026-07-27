import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const OpaqueValueSchema = Type.String({
  minLength: 16,
  maxLength: 512,
  pattern: '^[A-Za-z0-9_-]+$',
})

const APP_ORIGIN = 'https://app.fuma.co.ke'

export function safeAppResumeUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 1_200) return null
  try {
    const target = new URL(value)
    if (target.origin !== APP_ORIGIN || target.pathname !== '/resume') return null
    if (target.username || target.password || target.hash) return null
    const keys = Array.from(target.searchParams.keys())
    if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes('intent') || !keys.includes('correlation')) return null
    if (!Value.Check(OpaqueValueSchema, target.searchParams.get('intent'))) return null
    if (!Value.Check(OpaqueValueSchema, target.searchParams.get('correlation'))) return null
    return target
  } catch {
    return null
  }
}
