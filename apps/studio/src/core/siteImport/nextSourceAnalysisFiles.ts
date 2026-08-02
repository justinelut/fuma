import type { FileMap } from './types'
import type { NextSourceFileEvidence } from './nextSourceContracts'

export function assertSafeNextSourceFileMap(fileMap: FileMap): string[] {
  const paths = Object.keys(fileMap.files)
  if (paths.length === 0) throw new Error('Next.js source analysis requires at least one ingested file.')
  for (const path of paths) {
    if (
      !path || path.startsWith('/') || path.includes('\\')
      || path.split('/').some((part) => !part || part === '.' || part === '..')
      || /^[A-Za-z]:/.test(path)
    ) throw new Error(`Unsafe ingested source path: ${path}`)
  }
  return paths.sort()
}

export async function nextSourceSha256(bytes: Uint8Array): Promise<string> {
  const input = bytes.slice().buffer as ArrayBuffer
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function inventoryNextSourceFiles(fileMap: FileMap, paths: readonly string[]): Promise<NextSourceFileEvidence[]> {
  return Promise.all(paths.map(async (path) => {
    const bytes = fileMap.files[path]!.bytes
    return { path, sizeBytes: bytes.byteLength, sha256: await nextSourceSha256(bytes) }
  }))
}
