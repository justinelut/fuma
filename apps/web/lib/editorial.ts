import generatedSearch from '../generated/editorial-search.json'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  compileEditorialSources,
  parseEditorialSource,
  searchEditorialIndex,
  type EditorialCompilation,
  type EditorialEntry,
  type EditorialSearchIndex,
  type EditorialSource,
} from './editorial-compiler'

export type {
  EditorialBlock,
  EditorialCompilation,
  EditorialEntry,
  EditorialHeading,
  EditorialSearchIndex,
  EditorialSearchRecord,
  EditorialSource,
} from './editorial-compiler'
export {
  buildEditorialSearchIndex,
  compileEditorialSources,
  generateAtom,
  generateRss,
  isSafeEditorialHref,
  parseEditorialSource,
  searchEditorialIndex,
} from './editorial-compiler'

const APP_CWD = process.cwd().endsWith(`${path.sep}apps${path.sep}web`)
  ? process.cwd()
  : path.join(process.cwd(), 'apps', 'web')
const ROOT = path.join(APP_CWD, 'content', 'public')
const COLLECTIONS = ['docs', 'guides', 'blog', 'changelog', 'legal'] as const

async function diskSources(): Promise<readonly EditorialSource[]> {
  const sources: EditorialSource[] = []
  for (const collection of COLLECTIONS) {
    const directory = path.join(ROOT, collection)
    let files: string[]
    try {
      files = (await fs.readdir(directory))
        .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
        .sort()
    } catch {
      continue
    }
    for (const file of files) {
      const sourcePath = path.join(directory, file)
      sources.push({ sourcePath, source: await fs.readFile(sourcePath, 'utf8') })
    }
  }
  return sources
}

export async function compileDiskEditorial(now = new Date()): Promise<EditorialCompilation> {
  return compileEditorialSources(await diskSources(), now)
}

export async function readEditorial(
  includeDrafts = false,
  now = new Date(),
): Promise<readonly EditorialEntry[]> {
  const compilation = await compileDiskEditorial(now)
  return includeDrafts ? compilation.allEntries : compilation.publicEntries
}

function validCollection(value: string): value is typeof COLLECTIONS[number] {
  return (COLLECTIONS as readonly string[]).includes(value)
}

export async function getEditorial(
  collection: string,
  slug: string,
  now = new Date(),
): Promise<EditorialEntry | null> {
  if (!validCollection(collection)) return null
  return (await readEditorial(false, now)).find((entry) => entry.meta.collection === collection && entry.meta.slug === slug) ?? null
}

export async function getEditorialPreview(
  collection: string,
  slug: string,
  now = new Date(),
): Promise<EditorialEntry | null> {
  if (!validCollection(collection)) return null
  return (await readEditorial(true, now)).find((entry) => entry.meta.collection === collection && entry.meta.slug === slug) ?? null
}

export async function resolveEditorialRedirect(pathname: string, now = new Date()): Promise<string | null> {
  return (await compileDiskEditorial(now)).redirects.get(pathname) ?? null
}

export function searchCompiledEditorial(
  compilation: EditorialCompilation,
  query: string,
): readonly EditorialEntry[] {
  const matches = searchEditorialIndex(compilation.searchIndex, query)
  const byPath = new Map(compilation.publicEntries.map((entry) => [entry.canonicalPath, entry]))
  return matches.map((match) => byPath.get(match.path)).filter((entry): entry is EditorialEntry => entry !== undefined)
}

export async function searchEditorial(query: string, now = new Date()): Promise<readonly EditorialEntry[]> {
  const compilation = await compileDiskEditorial(now)
  const generated = generatedSearch as EditorialSearchIndex
  const publicPaths = new Set(compilation.publicEntries.map((entry) => entry.canonicalPath))
  const currentIndex = generated.filter((record) => publicPaths.has(record.path))
  const matches = searchEditorialIndex(currentIndex, query)
  const byPath = new Map(compilation.publicEntries.map((entry) => [entry.canonicalPath, entry]))
  return matches.map((match) => byPath.get(match.path)).filter((entry): entry is EditorialEntry => entry !== undefined)
}

export const __editorialTest = Object.freeze({ parseEditorialSource })
