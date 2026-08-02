import {
  normalizeNextSourceFolderRoot,
  type FileMap,
  type NextSourceProvenance,
} from '@core/siteImport'

export type NextSourceCompatibilityInput = Readonly<{
  fileMap: FileMap
  provenance: NextSourceProvenance
}>

function looksLikeNextSource(fileMap: FileMap): boolean {
  const paths = Object.keys(fileMap.files)
  if (paths.some((path) => /^(?:app|pages)\/.+\.(?:js|jsx|ts|tsx|mdx)$/.test(path))) return true
  const manifest = fileMap.files['package.json']
  if (!manifest) return false
  try {
    const value = JSON.parse(new TextDecoder().decode(manifest.bytes)) as { dependencies?: Record<string, unknown> }
    return typeof value.dependencies?.next === 'string'
  } catch {
    return false
  }
}

export function prepareNextSourceCompatibility(
  fileMap: FileMap,
  provenance: NextSourceProvenance = { kind: 'file-map', locator: 'ingested source map' },
): NextSourceCompatibilityInput | null {
  const normalized = provenance.kind === 'folder' ? normalizeNextSourceFolderRoot(fileMap) : fileMap
  if (!looksLikeNextSource(normalized)) return null
  const root = normalized.strippedTopLevelFolder
  return {
    fileMap: normalized,
    provenance: root && provenance.kind === 'folder' ? { ...provenance, locator: root } : provenance,
  }
}
