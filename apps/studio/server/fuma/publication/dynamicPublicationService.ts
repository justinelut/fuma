import {
  DynamicPublicationLoopPageSchema,
  DynamicPublicationLoopQuerySchema,
  DynamicPublicationTemplateSchema,
  canonicalDynamicPublicationPath,
  parseDynamicPublicationContract,
  type DynamicPublicationBinding,
  type DynamicPublicationLoopItem,
  type DynamicPublicationLoopPage,
  type DynamicPublicationLoopQuery,
  type DynamicPublicationTarget,
  type DynamicPublicationTemplate,
} from '@core/fuma/publication/dynamicPublication'
import type { PublicationRepositoryScope } from './scope'
import type { DynamicPublicationRepository } from './dynamicPublicationRepository'

export class DynamicPublicationError extends Error {
  readonly code: 'conflict' | 'not-found' | 'page-out-of-range'
  constructor(code: DynamicPublicationError['code'], message: string) {
    super(message)
    this.name = 'DynamicPublicationError'
    this.code = code
  }
}

export type DynamicPublicationRender = Readonly<{
  template: DynamicPublicationTemplate
  page: DynamicPublicationLoopPage
  html: string
}>

export class DynamicPublicationService {
  readonly #repository: DynamicPublicationRepository
  constructor(repository: DynamicPublicationRepository) { this.#repository = repository }

  listTemplates(scope: PublicationRepositoryScope): Promise<readonly DynamicPublicationTemplate[]> {
    return this.#repository.listTemplates(scope)
  }

  async saveTemplate(scope: PublicationRepositoryScope, input: DynamicPublicationTemplate, expectedVersion: number | null): Promise<DynamicPublicationTemplate> {
    const template = parseDynamicPublicationContract('template', DynamicPublicationTemplateSchema, input)
    if ((expectedVersion === null && template.version !== 1) || (expectedVersion !== null && template.version !== expectedVersion + 1)) {
      throw new DynamicPublicationError('conflict', 'Dynamic Publication template version is not monotonic.')
    }
    const blockIds = template.document.blocks.map((block) => block.blockId)
    if (new Set(blockIds).size !== blockIds.length) throw new TypeError('Dynamic Publication template block IDs must be unique.')
    if ((template.target.kind === 'post' || template.target.kind === 'page') && template.document.blocks.some((block) => block.scope === 'item')) {
      throw new TypeError('Detail templates cannot contain archive item blocks.')
    }
    if (!await this.#repository.saveTemplate(scope, template, expectedVersion)) {
      throw new DynamicPublicationError('conflict', 'Dynamic Publication template changed concurrently or target authority conflicts.')
    }
    return template
  }

  async render(scope: PublicationRepositoryScope, input: DynamicPublicationLoopQuery): Promise<DynamicPublicationRender> {
    const query = parseDynamicPublicationContract('loop query', DynamicPublicationLoopQuerySchema, input)
    const template = await this.#repository.resolveTemplate(scope, query.target)
    if (!template) throw new DynamicPublicationError('not-found', 'No active Dynamic Publication template matches this route.')
    const result = await this.#repository.queryLoop(scope, query)
    const maxPage = Math.max(1, Math.ceil(result.total / query.pageSize))
    if (query.page > maxPage) throw new DynamicPublicationError('page-out-of-range', 'Dynamic Publication page is outside the canonical result set.')
    const canonicalPath = canonicalDynamicPublicationPath(query.target, query.page)
    const page = parseDynamicPublicationContract('loop page', DynamicPublicationLoopPageSchema, {
      target: query.target,
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
      items: result.items,
      canonicalPath,
      previousPath: query.page > 1 ? canonicalDynamicPublicationPath(query.target, query.page - 1) : null,
      nextPath: query.page < maxPage ? canonicalDynamicPublicationPath(query.target, query.page + 1) : null,
    })
    return Object.freeze({ template, page, html: renderDynamicPublicationTemplate(template, page) })
  }
}

export function renderDynamicPublicationTemplate(template: DynamicPublicationTemplate, page: DynamicPublicationLoopPage): string {
  const detail = template.target.kind === 'post' || template.target.kind === 'page'
  const first = page.items[0] ?? null
  const root = template.document.blocks.filter((block) => block.scope === 'root')
    .map((block) => renderBlock(block, page, first, detail)).join('')
  const repeated = page.items.flatMap((item) => template.document.blocks
    .filter((block) => block.scope === 'item')
    .map((block) => renderBlock(block, page, item, false))).join('')
  const empty = page.items.length === 0 ? `<p data-publication-empty="true">${escapeHtml(template.emptyState)}</p>` : ''
  return `<main data-publication-template="${escapeAttribute(template.templateId)}" data-template-version="${template.version}">${root}${repeated}${empty}</main>`
}

function renderBlock(
  block: DynamicPublicationTemplate['document']['blocks'][number],
  page: DynamicPublicationLoopPage,
  item: DynamicPublicationLoopItem | null,
  detail: boolean,
): string {
  const value = block.value.kind === 'literal' ? block.value.value : bindingValue(block.value.binding, page, item, detail)
  const hrefValue = block.href === null ? null : block.href.kind === 'literal'
    ? block.href.value
    : bindingValue(block.href.binding, page, item, detail)
  const href = block.element === 'a' && hrefValue !== null && isSafeRelativeHref(hrefValue)
    ? ` href="${escapeAttribute(hrefValue)}"`
    : ''
  const datetime = block.element === 'time' && /^\d{4}-\d{2}-\d{2}T/.test(value)
    ? ` datetime="${escapeAttribute(value)}"`
    : ''
  return `<${block.element} data-block-id="${escapeAttribute(block.blockId)}"${href}${datetime}>${escapeHtml(value)}</${block.element}>`
}

function bindingValue(binding: DynamicPublicationBinding, page: DynamicPublicationLoopPage, item: DynamicPublicationLoopItem | null, detail: boolean): string {
  if (binding === 'archive.title') return archiveTitle(page.target)
  if (binding === 'archive.description') return `Page ${page.page} of ${Math.max(1, Math.ceil(page.total / page.pageSize))}`
  if (binding === 'archive.count') return String(page.total)
  const source = item
  if (!source) return ''
  if (binding === 'content.title' || binding === 'item.title') return source.title
  if (binding === 'content.excerpt' || binding === 'item.excerpt') return source.excerpt
  if (binding === 'content.publishedAt' || binding === 'item.publishedAt') return source.publishedAt
  if (binding === 'content.url' || binding === 'item.url') return canonicalDynamicPublicationPath({ kind: source.kind, targetId: source.slug })
  return detail ? source.title : ''
}

function archiveTitle(target: DynamicPublicationTarget): string {
  const selector = target.targetId ?? ''
  if (target.kind === 'date') return `Archive ${selector}`
  if (target.kind === 'collection') return `Collection ${selector}`
  return `${target.kind[0]!.toUpperCase()}${target.kind.slice(1)} ${selector}`
}
function isSafeRelativeHref(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false
  for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) <= 31) return false
  return true
}
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function escapeAttribute(value: string): string { return escapeHtml(value) }
