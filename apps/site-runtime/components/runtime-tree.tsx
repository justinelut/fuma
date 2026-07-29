import { createElement, Fragment, type CSSProperties, type ReactNode } from 'react'
import type { ComponentRegistryEntry, RuntimeJson, RuntimeNode, RuntimeRouteArtifact } from '../lib/contracts'
import { componentKey, ExactRuntimeRegistry, RuntimeRegistryError } from '../lib/component-registry'
import { ApplicationBookingAction, ApplicationCartAction, ApplicationMemberStatus } from './application-controls'
import { RestrictedClientBoundary } from './restricted-client'
import { RuntimeLink } from './runtime-link'

const BUILTIN_TAGS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'ul', 'ol'])
const FORBIDDEN_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'link', 'meta', 'style'])
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'small', 'strong', 'em'])
const SAFE_RICH_TAGS = new Set(['a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'])
const SAFE_SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'symbol', 'use', 'title', 'desc'])
const SAFE_INPUT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'time', 'datetime-local', 'file', 'hidden'])

type JsonRecord = Readonly<Record<string, RuntimeJson>>
type RenderContext = Readonly<{
  host: string
  registry: ExactRuntimeRegistry
  publicData: ReadonlyMap<string, RuntimeJson>
  entry: RuntimeJson
  outlet: ReactNode
  componentStack: ReadonlySet<string>
  parameters: ReadonlyMap<string, RuntimeJson>
  slotFills: ReadonlyMap<string, readonly RuntimeNode[]>
}>

type Decoration = Readonly<{ className?: string; style?: CSSProperties; 'data-fuma-node'?: string; 'data-fuma-component'?: string }>

function record(value: RuntimeJson | undefined): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
function stringValue(value: RuntimeJson | undefined, fallback = ''): string { return typeof value === 'string' ? value : fallback }
function numberValue(value: RuntimeJson | undefined, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function booleanValue(value: RuntimeJson | undefined): boolean { return value === true }
function arrayValue(value: RuntimeJson | undefined): readonly RuntimeJson[] { return Array.isArray(value) ? value : [] }


function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}
function safeUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^(?:javascript|vbscript|data):/i.test(trimmed) || hasControlCharacters(trimmed)) return null
  if (/^(?:https?:|mailto:|tel:|\/|#|cms:page:)/i.test(trimmed)) return trimmed
  return null
}

function safeStyle(node: RuntimeNode): CSSProperties | undefined {
  const output: Record<string, string> = {}
  for (const declaration of node.styles) {
    if (!/^(?:--[A-Za-z_][A-Za-z0-9_-]*|[a-z][a-z0-9-]*)$/.test(declaration.property)) continue
    if (/[{}]|<\/|expression\s*\(|javascript\s*:|@import/i.test(declaration.value)) continue
    const property = declaration.property.startsWith('--')
      ? declaration.property
      : declaration.property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
    output[property] = declaration.value
  }
  return Object.keys(output).length === 0 ? undefined : output as CSSProperties
}

function decoration(node: RuntimeNode, inherited?: Decoration): Decoration {
  const className = [...node.classes, ...(inherited?.className?.split(/\s+/).filter(Boolean) ?? [])].join(' ') || undefined
  return {
    ...(className ? { className } : {}),
    ...((safeStyle(node) || inherited?.style) ? { style: { ...safeStyle(node), ...inherited?.style } } : {}),
    'data-fuma-node': inherited?.['data-fuma-node'] ?? node.nodeId,
    'data-fuma-component': inherited?.['data-fuma-component'] ?? componentKey(node.component),
  }
}

function htmlAttributes(value: RuntimeJson | undefined): Readonly<Record<string, string>> {
  const input = record(value)
  const output: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(input)) {
    if (typeof rawValue !== 'string') continue
    const name = rawName.toLowerCase()
    if (name.startsWith('on') || ['style', 'class', 'classname', 'href', 'src', 'srcdoc', 'formaction'].includes(name)) continue
    if (!/^(?:id|title|role|lang|dir|tabindex|name|value|aria-[a-z0-9_-]+|data-[a-z0-9_-]+)$/.test(name)) continue
    if (hasControlCharacters(rawValue)) continue
    output[name === 'tabindex' ? 'tabIndex' : name] = rawValue
  }
  return output
}

function resolveTag(tag: RuntimeJson | undefined, customTag: RuntimeJson | undefined): string {
  const candidate = stringValue(tag, 'div')
  if (BUILTIN_TAGS.has(candidate)) return candidate
  if (candidate !== 'custom') return 'div'
  const custom = stringValue(customTag).trim().toLowerCase()
  return /^[a-z][a-z0-9-]{0,31}$/.test(custom) && !FORBIDDEN_TAGS.has(custom) ? custom : 'div'
}

function textWithBreaks(value: string): ReactNode[] {
  return value.split('\n').flatMap((part, index) => index === 0 ? [part] : [<br key={`br-${index}`} />, part])
}

function sanitizeMarkup(value: string, svg: boolean): string | null {
  if (!value.trim() || value.length > 1_000_000 || /<!--|<!doctype|<\?xml/i.test(value)) return null
  const allowed = svg ? SAFE_SVG_TAGS : SAFE_RICH_TAGS
  for (const match of value.matchAll(/<\/?\s*([A-Za-z][A-Za-z0-9:-]*)\b/g)) {
    if (!allowed.has(match[1]!.toLowerCase())) return null
  }
  let output = value
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:srcdoc|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  output = output.replace(/\s+(href|src|xlink:href)\s*=\s*(["'])(.*?)\2/gi, (whole, name: string, quote: string, url: string) => {
    const safe = svg && url.startsWith('#') ? url : safeUrl(url)
    return safe ? ` ${name.toLowerCase()}=${quote}${safe}${quote}` : ''
  })
  return /(?:javascript|vbscript)\s*:|<\/style/i.test(output) ? null : output
}

function applyBindings(node: RuntimeNode, context: RenderContext): JsonRecord {
  const output: Record<string, RuntimeJson> = { ...record(node.props) }
  for (const binding of node.bindings) {
    const value = context.publicData.get(binding.publicDataKey)
    if (value !== undefined) output[binding.prop] = value
  }
  const meta = record(output.__fuma)
  const propBindings = record(meta.propBindings)
  for (const [prop, rawBinding] of Object.entries(propBindings)) {
    const parameterId = stringValue(record(rawBinding).paramId)
    const value = context.parameters.get(parameterId)
    if (value !== undefined) output[prop] = value
  }
  for (const [key, value] of Object.entries(output)) {
    if (typeof value !== 'string' || context.entry === null) continue
    const match = value.match(/^\{\{?entry\.([A-Za-z0-9_.-]+)\}?\}$/)
    if (!match) continue
    let selected: RuntimeJson | undefined = context.entry
    for (const segment of match[1]!.split('.')) selected = record(selected)[segment]
    if (selected !== undefined) output[key] = selected
  }
  return output
}

function nodeChildren(node: RuntimeNode, context: RenderContext): ReactNode[] {
  return node.slots.flatMap((slot) => slot.children.map((child) => (
    <RuntimeTreeNode key={`${slot.name}:${child.nodeId}`} node={child} context={context} />
  )))
}

function fieldProps(props: JsonRecord) {
  const fieldId = stringValue(props.fieldId)
  return {
    name: stringValue(props.name, fieldId) || undefined,
    id: stringValue(props.id) || undefined,
    required: booleanValue(props.required),
    disabled: booleanValue(props.disabled),
  }
}

function renderOfficial(node: RuntimeNode, props: JsonRecord, children: ReactNode[], context: RenderContext, inherited?: Decoration): ReactNode {
  const attributes = htmlAttributes(props.htmlAttributes)
  const decorated = { ...attributes, ...decoration(node, inherited) }
  switch (node.component.componentId) {
    case 'layout.section': {
      const tag = resolveTag(props.element ?? props.tag, props.customTag)
      return createElement(tag, decorated, children)
    }
    case 'base.body': return <Fragment>{children}</Fragment>
    case 'base.container': {
      const tag = resolveTag(props.tag, props.customTag)
      return VOID_TAGS.has(tag) ? createElement(tag, decorated) : createElement(tag, decorated, children)
    }
    case 'base.text': {
      const tag = stringValue(props.tag, 'p')
      const content = textWithBreaks(stringValue(props.text))
      return tag === 'none' ? <Fragment>{content}</Fragment> : createElement(TEXT_TAGS.has(tag) ? tag : 'p', decorated, content)
    }
    case 'base.image': {
      const src = safeUrl(stringValue(props.src))
      if (!src) return null
      return <img {...decorated} src={src} alt={stringValue(props.alt)} loading={props.loading === 'eager' ? 'eager' : 'lazy'} decoding={props.decoding === 'sync' || props.decoding === 'auto' ? props.decoding : 'async'} fetchPriority={props.fetchPriority === 'high' || props.fetchPriority === 'low' ? props.fetchPriority : undefined} />
    }
    case 'base.link': {
      const href = safeUrl(stringValue(props.href, '#'))
      if (!href) return null
      const content = children.length > 0 ? children : stringValue(props.text)
      const target = props.target === '_blank' || props.target === '_parent' ? props.target : '_self'
      return <RuntimeLink value={href} currentHost={context.host} target={target} decoration={decorated}>{content}</RuntimeLink>
    }
    case 'base.button': {
      const href = safeUrl(stringValue(props.href))
      if (href) {
        const target = props.target === '_blank' || props.target === '_parent' ? props.target : '_self'
        return <RuntimeLink value={href} currentHost={context.host} target={target} decoration={decorated}>{stringValue(props.label)}</RuntimeLink>
      }
      return <button {...decorated} type="button" disabled={booleanValue(props.disabled)} aria-disabled={booleanValue(props.disabled) || undefined}>{stringValue(props.label)}</button>
    }
    case 'base.list': {
      const Tag = props.listType === 'ordered' ? 'ol' : 'ul'
      const items = stringValue(props.items).split('\n').map((item) => item.trim()).filter(Boolean)
      return <Tag {...decorated}>{items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</Tag>
    }
    case 'base.svg': {
      const markup = sanitizeMarkup(stringValue(props.svg), true)
      if (!markup) return null
      const title = stringValue(props.title).trim()
      const labelled = title ? markup.replace(/^(\s*<svg\b)/i, `$1 role="img" aria-label="${title.replace(/["&<>]/g, '')}"`) : markup
      return <span {...decorated} data-fuma-svg dangerouslySetInnerHTML={{ __html: labelled }} />
    }
    case 'base.video': {
      const raw = stringValue(props.videoUrl)
      const youtube = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/i)?.[1]
      if (youtube) {
        const query = new URLSearchParams({ rel: booleanValue(props.noRelatedVideos) ? '0' : '1', autoplay: booleanValue(props.autoplay) ? '1' : '0' })
        return <iframe {...decorated} src={`https://www.youtube.com/embed/${youtube}?${query}`} title={stringValue(props.title, 'YouTube video')} loading="lazy" allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
      }
      const src = safeUrl(raw)
      return <video {...decorated} src={src ?? undefined} poster={safeUrl(stringValue(props.poster)) ?? undefined} autoPlay={booleanValue(props.autoplay)} loop={booleanValue(props.loop)} muted={booleanValue(props.muted)} controls={props.controls !== false} playsInline={props.playsinline !== false} preload={props.preload === 'none' || props.preload === 'auto' ? props.preload : 'metadata'} />
    }
    case 'base.form': {
      const mode = props.mode === 'custom' ? 'custom' : 'cms'
      const action = mode === 'custom' ? safeUrl(stringValue(props.action)) : null
      const honeypot = mode === 'cms' ? <input type="text" name={stringValue(props.honeypotName, 'company')} autoComplete="off" tabIndex={-1} data-instatic-honeypot hidden /> : null
      return <form {...decorated} action={action ?? undefined} method={props.method === 'get' ? 'get' : 'post'} data-instatic-form-id={stringValue(props.formId, 'form')} data-instatic-form-mode={mode} data-instatic-target-table={mode === 'cms' ? stringValue(props.targetTableId) : undefined}>{honeypot}{children}</form>
    }
    case 'base.label': return <label {...decorated} htmlFor={props.targetMode === 'explicit' ? stringValue(props.targetId) : undefined} data-instatic-label-target={props.targetMode === 'explicit' ? undefined : 'auto'}>{stringValue(props.text, 'Label')}</label>
    case 'base.input': {
      const inputType = SAFE_INPUT_TYPES.has(stringValue(props.inputType)) ? stringValue(props.inputType) : 'text'
      return <input {...decorated} {...fieldProps(props)} type={inputType} data-instatic-form-control="input" data-instatic-field-id={stringValue(props.fieldId)} placeholder={stringValue(props.placeholder) || undefined} defaultValue={stringValue(props.value) || undefined} autoComplete={stringValue(props.autocomplete) || undefined} min={stringValue(props.min) || undefined} max={stringValue(props.max) || undefined} minLength={numberValue(props.minLength) || undefined} maxLength={numberValue(props.maxLength) || undefined} pattern={stringValue(props.pattern) || undefined} readOnly={booleanValue(props.readOnly)} />
    }
    case 'base.textarea': return <textarea {...decorated} {...fieldProps(props)} data-instatic-form-control="textarea" data-instatic-field-id={stringValue(props.fieldId)} placeholder={stringValue(props.placeholder) || undefined} rows={Math.max(1, numberValue(props.rows, 4))} minLength={numberValue(props.minLength) || undefined} maxLength={numberValue(props.maxLength) || undefined} readOnly={booleanValue(props.readOnly)} defaultValue={stringValue(props.value)} />
    case 'base.select': return <select {...decorated} {...fieldProps(props)} data-instatic-form-control="select" data-instatic-field-id={stringValue(props.fieldId)} multiple={booleanValue(props.multiple)}>{children}</select>
    case 'base.option': return <option {...decorated} value={stringValue(props.value)} disabled={booleanValue(props.disabled)}>{stringValue(props.label, 'Option')}</option>
    case 'base.option-group': return <optgroup {...decorated} label={stringValue(props.label, 'Group')} disabled={booleanValue(props.disabled)}>{children}</optgroup>
    case 'base.checkbox':
    case 'base.radio': return <input {...decorated} {...fieldProps(props)} type={node.component.componentId === 'base.checkbox' ? 'checkbox' : 'radio'} data-instatic-form-control={node.component.componentId.slice('base.'.length)} data-instatic-field-id={stringValue(props.fieldId)} value={stringValue(props.value, 'on')} defaultChecked={booleanValue(props.checked)} />
    case 'base.submit': return <button {...decorated} type="submit" form={stringValue(props.formId) || undefined} disabled={booleanValue(props.disabled)}>{stringValue(props.label, 'Submit')}</button>
    case 'base.form-message': {
      const kind = props.kind === 'error' || props.kind === 'success' ? props.kind : 'status'
      return <div {...decorated} data-instatic-form-message={kind} data-instatic-form-id={stringValue(props.formId)} role={kind === 'error' ? 'alert' : 'status'}>{stringValue(props.text)}</div>
    }
    case 'application.member-status': return <ApplicationMemberStatus decoration={decorated} label={stringValue(props.publicLabel, 'Sign in')} />
    case 'application.cart-action': return <ApplicationCartAction decoration={decorated} itemId={stringValue(props.itemId)} quantity={Math.max(1, Math.min(10_000, Math.trunc(numberValue(props.quantity, 1))))} label={stringValue(props.label, 'Add to cart')} />
    case 'application.booking-action': return <ApplicationBookingAction decoration={decorated} selectionId={stringValue(props.selectionId)} resourceId={stringValue(props.resourceId)} startsAt={stringValue(props.startsAt)} label={stringValue(props.label, 'Reserve')} />
    case 'base.outlet': {
      if (context.outlet !== null) return createElement(resolveTag(props.tag, props.customTag), { ...decorated, 'data-instatic-content-region': true }, context.outlet)
      const html = sanitizeMarkup(stringValue(props.html), false)
      return createElement(resolveTag(props.tag, props.customTag), { ...decorated, 'data-instatic-content-region': true, ...(html ? { dangerouslySetInnerHTML: { __html: html } } : {}) })
    }
    case 'base.slot-outlet': {
      const fill = context.slotFills.get(stringValue(props.slotName, 'children'))
      return fill ? <Fragment>{fill.map((child) => <RuntimeTreeNode key={child.nodeId} node={child} context={context} />)}</Fragment> : null
    }
    case 'base.slot-instance': return null
    case 'base.loop': return renderLoop(node, props, context, decorated)
    default: throw new RuntimeRegistryError('unknown', `No compiled renderer exists for ${componentKey(node.component)}.`)
  }
}

function renderLoop(node: RuntimeNode, props: JsonRecord, context: RenderContext, decorated: Decoration): ReactNode {
  const variants = node.slots.flatMap((slot) => slot.children)
  const items = arrayValue(props.items ?? props.entries ?? props.data)
  if (variants.length === 0 || items.length === 0) return null
  const tag = resolveTag(props.tag, props.customTag)
  return createElement(tag, { ...decorated, 'data-instatic-loop': node.nodeId, 'data-instatic-loop-page': '1' }, items.map((entry, index) => (
    <RuntimeTreeNode key={`${node.nodeId}:${index}`} node={variants[index % variants.length]!} context={{ ...context, entry }} />
  )))
}

function privateSlotFills(node: RuntimeNode): ReadonlyMap<string, readonly RuntimeNode[]> {
  const fills = new Map<string, readonly RuntimeNode[]>()
  for (const child of node.slots.flatMap((slot) => slot.children)) {
    if (child.component.namespace !== 'fuma.official' || child.component.componentId !== 'base.slot-instance') continue
    fills.set(stringValue(record(child.props).slotName, 'children'), child.slots.flatMap((slot) => slot.children))
  }
  return fills
}

function privateParameters(entry: ComponentRegistryEntry, props: JsonRecord): ReadonlyMap<string, RuntimeJson> {
  const overrides = record(props.propOverrides)
  const values = new Map<string, RuntimeJson>()
  for (const parameter of entry.parameters) values.set(parameter.id, Object.prototype.hasOwnProperty.call(overrides, parameter.id) ? overrides[parameter.id]! : parameter.defaultValue)
  return values
}

export function RuntimeTreeNode({ node, context, inherited }: Readonly<{ node: RuntimeNode; context: RenderContext; inherited?: Decoration }>): ReactNode {
  const entry = context.registry.resolve(node.component, node.requiredCapabilities)
  const props = applyBindings(node, context)
  if (record(props.__fuma).hidden === true) return null
  if (entry.execution === 'private-declarative') {
    if (!entry.definition) throw new RuntimeRegistryError('trust', `${componentKey(entry.reference)} has no declarative definition.`)
    const key = componentKey(entry.reference)
    if (context.componentStack.has(key)) throw new RuntimeRegistryError('trust', `${key} recursively invokes itself.`)
    const stack = new Set(context.componentStack)
    stack.add(key)
    return <RuntimeTreeNode node={entry.definition} context={{ ...context, componentStack: stack, parameters: privateParameters(entry, props), slotFills: privateSlotFills(node) }} inherited={decoration(node, inherited)} />
  }
  const children = nodeChildren(node, context)
  if (entry.execution === 'restricted-client') {
    return <div {...decoration(node, inherited)}><RestrictedClientBoundary component={componentKey(entry.reference)} initialOpen={booleanValue(props.initialOpen)} interactive={node.requiredCapabilities.includes('browser.events')}>{children}</RestrictedClientBoundary></div>
  }
  return renderOfficial(node, props, children, context, inherited)
}

export function runtimeStyleCss(route: RuntimeRouteArtifact): string {
  const tokens = route.styles.tokens.length > 0 ? `:root{${route.styles.tokens.map(({ name, value }) => `${name}:${value}`).join(';')}}` : ''
  const rules = route.styles.rules.map((rule) => `${rule.selector}{${rule.declarations.map(({ property, value }) => `${property}:${value}`).join(';')}}`).join('\n')
  return [tokens, rules].filter(Boolean).join('\n')
}

function hasOutlet(node: RuntimeNode): boolean {
  if (node.component.namespace === 'fuma.official' && node.component.componentId === 'base.outlet') return true
  return node.slots.some((slot) => slot.children.some(hasOutlet))
}

export function RuntimeTree({ route, host, ownerKey, siteId }: Readonly<{ route: RuntimeRouteArtifact; host: string; ownerKey: string; siteId: string }>) {
  const registry = new ExactRuntimeRegistry(route, { ownerKey, siteId })
  const publicData = new Map(route.publicData.map(({ key, value }) => [key, value]))
  const base: RenderContext = { host, registry, publicData, entry: null, outlet: null, componentStack: new Set(), parameters: new Map(), slotFills: new Map() }
  let content: ReactNode = <RuntimeTreeNode node={route.page.root} context={base} />
  for (const layout of [...route.layouts].reverse()) {
    const rendered = <RuntimeTreeNode key={layout.layoutId} node={layout.root} context={{ ...base, outlet: content }} />
    content = hasOutlet(layout.root) ? rendered : <Fragment>{rendered}{content}</Fragment>
  }
  return <Fragment>{content}</Fragment>
}
