import { ObjectStorageError } from './types'

export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

export function assertChecksum(actual: string, expected: string, path = 'checksumSha256'): void {
  if (!SHA256_HEX_PATTERN.test(expected) || actual !== expected) {
    throw new ObjectStorageError('checksum_mismatch', 'Object SHA-256 checksum does not match the declared checksum.', path)
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch (_error) {
    return false
  }
}

function looksLikeHtml(text: string): boolean {
  const normalized = text.replace(/^\uFEFF/, '').trimStart().toLowerCase()
  return normalized.startsWith('<!doctype html')
    || normalized.startsWith('<html')
    || normalized.startsWith('<head')
    || normalized.startsWith('<body')
}

function hasBalancedCssBlocks(text: string): boolean {
  let depth = 0
  for (const character of text) {
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    if (depth < 0) return false
  }
  return depth === 0
}

function looksLikeCss(text: string): boolean {
  const normalized = text.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (/^@(charset|import|namespace)\b[\s\S]*;\s*$/i.test(normalized)) return true

  const firstBlock = normalized.indexOf('{')
  if (firstBlock <= 0 || !normalized.endsWith('}') || !hasBalancedCssBlocks(normalized)) return false
  const prelude = normalized.slice(0, firstBlock).trim()
  if (prelude.startsWith('@')) return /^@[a-z-]+\b/i.test(prelude)
  if (/[;=]/.test(prelude)) return false
  return /^[.#*:[a-z_-]/i.test(prelude)
}

export function detectMimeType(bytes: Uint8Array): string {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif'
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip'
  if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  if (!isUtf8Text(bytes)) return 'application/octet-stream'

  const text = new TextDecoder().decode(bytes).trim()
  if (looksLikeHtml(text)) return 'text/html'
  if (looksLikeCss(text)) return 'text/css'
  if (text !== '') {
    try {
      JSON.parse(text)
      return 'application/json'
    } catch (_error) {
      // Valid UTF-8 that is not a recognized structured format is plain text.
    }
  }
  return 'text/plain'
}

export function assertMimeType(
  bytes: Uint8Array,
  declaredMimeType: string,
  allowedMimeTypes: readonly string[],
): void {
  if (!allowedMimeTypes.includes(declaredMimeType)) {
    throw new ObjectStorageError('mime_not_allowed', `MIME type ${declaredMimeType} is not allowed.`, 'mimeType')
  }
  const detected = detectMimeType(bytes)
  const compatibleRuntimeJson = detected === 'application/json'
    && (declaredMimeType === 'application/vnd.fuma.runtime+json'
      || declaredMimeType === 'application/vnd.fuma.runtime-route+json')
  const compatibleJavaScript = detected === 'text/plain'
    && (declaredMimeType === 'text/javascript'
      || declaredMimeType === 'application/javascript')
  if (detected !== declaredMimeType && !compatibleRuntimeJson && !compatibleJavaScript) {
    throw new ObjectStorageError(
      'mime_mismatch',
      `Object MIME mismatch: declared ${declaredMimeType}, detected ${detected}.`,
      'mimeType',
    )
  }
}
