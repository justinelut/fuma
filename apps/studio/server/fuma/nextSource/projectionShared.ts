import type * as ts from 'typescript'
import type { FileMap } from '@core/siteImport/types'
import type { NextSourceDraftRevision } from '@core/siteImport'
import { sha256Hex } from '../objectStorage'

export const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()
export const hashText = (value: string): string => sha256Hex(encoder.encode(value))

export const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'small', 'strong', 'em'])
export const BUILTIN_CONTAINER_TAGS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'ul', 'ol'])
export const SAFE_CONTAINER_TAGS = new Set([...BUILTIN_CONTAINER_TAGS, ...TEXT_TAGS, 'li', 'figure', 'figcaption', 'address', 'blockquote', 'code', 'pre', 'dl', 'dt', 'dd', 'br', 'hr'])
export const SAFE_HTML_ATTRIBUTES = /^(?:id|class|title|role|tabindex|lang|dir|aria-[a-z0-9-]+|data-[a-z0-9-]+)$/
export const MAX_STATIC_COLLECTION_ITEMS = 500
export const MAX_PROJECTED_NODES_PER_ROUTE = 10_000

export interface StaticArray {
  readonly [index: number]: StaticValue
  readonly length: number
}
export interface StaticObject {
  readonly [key: string]: StaticValue
}
export type StaticValue = string | number | boolean | null | StaticArray | StaticObject

export function isStaticObject(value: StaticValue): value is StaticObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export type MutableNode = {
  id: string
  moduleId: string
  props: Record<string, unknown>
  breakpointOverrides: Record<string, Record<string, unknown>>
  children: string[]
  parentId: string | null
  classIds: string[]
  inlineStyles?: Record<string, string | number>
}

export type ProjectionContext = {
  sourcePath: string
  sourceFile: ts.SourceFile
  route: string
  sourceHashSha256: string
  files: FileMap
  moduleByPath: ReadonlyMap<string, NextSourceDraftRevision['analysis']['modules'][number]>
  sourceFiles: Map<string, ts.SourceFile>
  componentStack: Set<string>
  bindings: ReadonlyMap<string, StaticValue>
  assetUrls: ReadonlySet<string>
  nodes: Record<string, MutableNode>
  usedIds: Set<string>
  classes: Map<string, string>
}

export class NextSourceProjectionError extends Error {
  readonly code = 'unsupported-source' as const
  readonly sourcePath: string | null

  constructor(message: string, sourcePath: string | null = null) {
    super(sourcePath ? `${sourcePath}: ${message}` : message)
    this.name = 'NextSourceProjectionError'
    this.sourcePath = sourcePath
  }
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function fail(message: string, context?: ProjectionContext): never {
  throw new NextSourceProjectionError(message, context?.sourcePath ?? null)
}

export function sourceText(files: FileMap, path: string): string {
  const file = files.files[path]
  if (!file) throw new NextSourceProjectionError('Analyzed route source is missing from the stored revision.', path)
  try {
    return decoder.decode(file.bytes)
  } catch {
    throw new NextSourceProjectionError('Source must be valid UTF-8.', path)
  }
}

function nodeId(context: ProjectionContext, path: string): string {
  const base = `next-${hashText(`${context.sourceHashSha256}:${context.route}:${path}`).slice(0, 24)}`
  if (context.usedIds.has(base)) fail('Deterministic node identity collision.', context)
  context.usedIds.add(base)
  return base
}

function projectedClassIds(value: string | undefined, context: ProjectionContext): string[] {
  if (!value?.trim()) return []
  return value.trim().split(/\s+/).map((name) => {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) fail(`Static class ${name} is outside the supported CSS identifier subset.`, context)
    const existing = context.classes.get(name)
    if (existing) return existing
    const id = `next-class-${hashText(name).slice(0, 24)}`
    context.classes.set(name, id)
    return id
  })
}

export function addNode(
  context: ProjectionContext,
  path: string,
  moduleId: string,
  props: Record<string, unknown>,
  parentId: string | null,
  inlineStyles?: Record<string, string | number>,
  className?: string,
): MutableNode {
  if (context.usedIds.size >= MAX_PROJECTED_NODES_PER_ROUTE) fail('Static JSX expansion exceeds the per-route node limit.', context)
  const id = nodeId(context, path)
  const node: MutableNode = {
    id,
    moduleId,
    props,
    breakpointOverrides: {},
    children: [],
    parentId,
    classIds: projectedClassIds(className, context),
    ...(inlineStyles && Object.keys(inlineStyles).length > 0 ? { inlineStyles } : {}),
  }
  context.nodes[id] = node
  return node
}
