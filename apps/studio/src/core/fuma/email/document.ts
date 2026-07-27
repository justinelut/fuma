import { Type, compiled, type Static } from '../../utils/typeboxHelpers'

export const EMAIL_DOCUMENT_VERSION = 1 as const
export const EMAIL_DOCUMENT_MAX_BYTES = 64 * 1024
export const EMAIL_DOCUMENT_MAX_DEPTH = 12
export const EMAIL_DOCUMENT_MAX_NODES = 256
export const EMAIL_DOCUMENT_MAX_OUTPUT_BYTES = 512 * 1024

const MAX_DATA_DEPTH = EMAIL_DOCUMENT_MAX_DEPTH * 2 + 2
const MAX_ARRAY_ITEMS = 64
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const ACTIVE_CONTENT_PATTERN = /<\s*\/?\s*(?:script|iframe|object|embed|style|svg|math)\b|(?:^|[\s"'`])on[a-z]+\s*=|(?:javascript|vbscript)\s*:/i
const EXECUTABLE_SOURCE_PATTERN = /(?:^|\n)\s*(?:import\s+(?:[\w*{]|["'])|export\s+(?:default|const|let|var|function|class)|(?:require|import)\s*\()/m
const COLOR_PATTERN = '^#[0-9a-fA-F]{6}$'
const LENGTH_PATTERN = '^(?:0|[1-9][0-9]{0,3}(?:\\.[0-9]{1,2})?(?:px|%|em|rem))$'

const EmailLengthSchema = Type.String({ maxLength: 16, pattern: LENGTH_PATTERN })
const EmailColorSchema = Type.String({ pattern: COLOR_PATTERN })

export const EmailStyleSchema = Type.Object(
  {
    backgroundColor: Type.Optional(EmailColorSchema),
    borderColor: Type.Optional(EmailColorSchema),
    borderRadius: Type.Optional(EmailLengthSchema),
    borderStyle: Type.Optional(Type.Union([
      Type.Literal('solid'),
      Type.Literal('dashed'),
      Type.Literal('dotted'),
    ])),
    borderWidth: Type.Optional(EmailLengthSchema),
    color: Type.Optional(EmailColorSchema),
    display: Type.Optional(Type.Union([Type.Literal('block'), Type.Literal('inline-block')])),
    fontFamily: Type.Optional(Type.Union([
      Type.Literal('Arial, Helvetica, sans-serif'),
      Type.Literal('Georgia, Times, serif'),
      Type.Literal('Verdana, Geneva, sans-serif'),
    ])),
    fontSize: Type.Optional(EmailLengthSchema),
    fontWeight: Type.Optional(Type.Union([
      Type.Literal(400),
      Type.Literal(500),
      Type.Literal(600),
      Type.Literal(700),
    ])),
    height: Type.Optional(EmailLengthSchema),
    lineHeight: Type.Optional(EmailLengthSchema),
    marginBottom: Type.Optional(EmailLengthSchema),
    marginLeft: Type.Optional(EmailLengthSchema),
    marginRight: Type.Optional(EmailLengthSchema),
    marginTop: Type.Optional(EmailLengthSchema),
    maxWidth: Type.Optional(EmailLengthSchema),
    paddingBottom: Type.Optional(EmailLengthSchema),
    paddingLeft: Type.Optional(EmailLengthSchema),
    paddingRight: Type.Optional(EmailLengthSchema),
    paddingTop: Type.Optional(EmailLengthSchema),
    textAlign: Type.Optional(Type.Union([
      Type.Literal('left'),
      Type.Literal('center'),
      Type.Literal('right'),
    ])),
    textDecoration: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('underline')])),
    textTransform: Type.Optional(Type.Union([
      Type.Literal('none'),
      Type.Literal('uppercase'),
      Type.Literal('lowercase'),
    ])),
    whiteSpace: Type.Optional(Type.Union([Type.Literal('normal'), Type.Literal('nowrap')])),
    width: Type.Optional(EmailLengthSchema),
    wordBreak: Type.Optional(Type.Union([Type.Literal('normal'), Type.Literal('break-all')])),
  },
  { additionalProperties: false },
)

const StyleProperty = { style: Type.Optional(EmailStyleSchema) }
const EmailTextSchema = Type.String({ maxLength: 8_000 })
const EmailUrlSchema = Type.String({ minLength: 1, maxLength: 2_048 })

export const EmailNodeSchema = Type.Recursive((Self) => {
  const children = Type.Array(Self, { maxItems: 64 })
  return Type.Union([
    Type.Object({ type: Type.Literal('container'), children, ...StyleProperty }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal('section'), children, ...StyleProperty }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal('row'), children, ...StyleProperty }, { additionalProperties: false }),
    Type.Object({
      type: Type.Literal('column'),
      children,
      width: Type.Optional(EmailLengthSchema),
      ...StyleProperty,
    }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal('text'), text: EmailTextSchema, ...StyleProperty }, { additionalProperties: false }),
    Type.Object({
      type: Type.Literal('heading'),
      text: Type.String({ minLength: 1, maxLength: 500 }),
      level: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]),
      ...StyleProperty,
    }, { additionalProperties: false }),
    Type.Object({
      type: Type.Literal('link'),
      text: Type.String({ minLength: 1, maxLength: 2_000 }),
      href: EmailUrlSchema,
      ...StyleProperty,
    }, { additionalProperties: false }),
    Type.Object({
      type: Type.Literal('button'),
      text: Type.String({ minLength: 1, maxLength: 500 }),
      href: EmailUrlSchema,
      ...StyleProperty,
    }, { additionalProperties: false }),
    Type.Object({
      type: Type.Literal('image'),
      src: EmailUrlSchema,
      alt: Type.String({ maxLength: 500 }),
      width: Type.Integer({ minimum: 1, maximum: 2_000 }),
      height: Type.Integer({ minimum: 1, maximum: 2_000 }),
      ...StyleProperty,
    }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal('divider'), ...StyleProperty }, { additionalProperties: false }),
    Type.Object({
      type: Type.Literal('spacer'),
      height: EmailLengthSchema,
      ...StyleProperty,
    }, { additionalProperties: false }),
  ])
}, { $id: 'FumaEmailNodeV1' })

export const EmailDocumentSchema = Type.Object(
  {
    version: Type.Literal(EMAIL_DOCUMENT_VERSION),
    lang: Type.Optional(Type.Union([Type.Literal('en'), Type.Literal('fr'), Type.Literal('sw')])),
    direction: Type.Optional(Type.Union([Type.Literal('ltr'), Type.Literal('rtl')])),
    previewText: Type.Optional(Type.String({ maxLength: 200 })),
    bodyStyle: Type.Optional(EmailStyleSchema),
    children: Type.Array(EmailNodeSchema, { maxItems: 64 }),
  },
  { additionalProperties: false, $id: 'FumaEmailDocumentV1' },
)

export type EmailStyle = Static<typeof EmailStyleSchema>
export type EmailNode = Static<typeof EmailNodeSchema>
export type EmailDocument = Static<typeof EmailDocumentSchema>

const EMAIL_DOCUMENT_VALIDATOR = compiled(EmailDocumentSchema)

export type EmailDocumentDiagnosticCode =
  | 'DATA_ONLY'
  | 'DEPTH_LIMIT'
  | 'NODE_LIMIT'
  | 'PROHIBITED_CONTENT'
  | 'PROTOTYPE_KEY'
  | 'SCHEMA'
  | 'SIZE_LIMIT'
  | 'UNSAFE_URL'

export type EmailDocumentDiagnostic = Readonly<{
  code: EmailDocumentDiagnosticCode
  path: string
  message: string
}>

export type EmailDocumentValidationResult =
  | Readonly<{ ok: true; value: EmailDocument }>
  | Readonly<{ ok: false; diagnostics: readonly EmailDocumentDiagnostic[] }>

export class EmailDocumentValidationError extends Error {
  readonly diagnostics: readonly EmailDocumentDiagnostic[]

  constructor(diagnostics: readonly EmailDocumentDiagnostic[]) {
    super(`Invalid EmailDocument: ${diagnostics.map((item) => `${item.code} ${item.path} ${item.message}`).join('; ')}`)
    this.name = 'EmailDocumentValidationError'
    this.diagnostics = diagnostics
  }
}

function pointer(path: string, key: string | number): string {
  const escaped = String(key).replaceAll('~', '~0').replaceAll('/', '~1')
  return path === '/' ? `/${escaped}` : `${path}/${escaped}`
}

function diagnostic(
  code: EmailDocumentDiagnosticCode,
  path: string,
  message: string,
): EmailDocumentDiagnostic {
  return Object.freeze({ code, path, message })
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedDiagnostics(items: EmailDocumentDiagnostic[]): readonly EmailDocumentDiagnostic[] {
  const unique = new Map(items.map((item) => [`${item.path}\0${item.code}\0${item.message}`, item]))
  return Object.freeze([...unique.values()].sort((left, right) =>
    compareText(left.path, right.path)
      || compareText(left.code, right.code)
      || compareText(left.message, right.message),
  ))
}

function scanDataOnly(input: unknown): EmailDocumentDiagnostic[] {
  const diagnostics: EmailDocumentDiagnostic[] = []
  const pending: Array<{ value: unknown; path: string; depth: number }> = [{ value: input, path: '/', depth: 0 }]
  const seen = new WeakSet<object>()
  let bytes = 0

  while (pending.length > 0) {
    const entry = pending.pop()!
    const { value, path, depth } = entry
    if (depth > MAX_DATA_DEPTH) {
      diagnostics.push(diagnostic('DEPTH_LIMIT', path, `data depth exceeds ${MAX_DATA_DEPTH}`))
      continue
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        diagnostics.push(diagnostic('DATA_ONLY', path, 'numbers must be finite'))
        continue
      }
      const encoded = JSON.stringify(value)
      bytes += encoded === undefined ? 0 : new TextEncoder().encode(encoded).byteLength
      if (typeof value === 'string'
        && (ACTIVE_CONTENT_PATTERN.test(value) || EXECUTABLE_SOURCE_PATTERN.test(value))) {
        diagnostics.push(diagnostic('PROHIBITED_CONTENT', path, 'executable markup or source is not allowed'))
      }
    } else if (typeof value !== 'object') {
      diagnostics.push(diagnostic('DATA_ONLY', path, `received non-data value of type ${typeof value}`))
      continue
    } else {
      try {
        if (seen.has(value)) {
          diagnostics.push(diagnostic('DATA_ONLY', path, 'cyclic or repeated references are not allowed'))
          continue
        }
        seen.add(value)
        const isArray = Array.isArray(value)
        const prototype = Reflect.getPrototypeOf(value)
        if ((!isArray && prototype !== Object.prototype && prototype !== null)
          || (isArray && prototype !== Array.prototype)) {
          diagnostics.push(diagnostic('DATA_ONLY', path, 'only plain JSON objects and arrays are allowed'))
          continue
        }

        const ownKeys = Reflect.ownKeys(value)
        if (ownKeys.some((key) => typeof key === 'symbol')) {
          diagnostics.push(diagnostic('DATA_ONLY', path, 'symbol keys are not allowed'))
          continue
        }
        const stringKeys = (ownKeys as string[]).sort(compareText)
        const descriptors = new Map<string, PropertyDescriptor>()
        let invalidDescriptor = false
        for (const key of stringKeys) {
          const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
          if (!descriptor || !('value' in descriptor)) {
            diagnostics.push(diagnostic('DATA_ONLY', pointer(path, key), 'accessor properties are not allowed'))
            invalidDescriptor = true
          } else {
            descriptors.set(key, descriptor)
          }
        }
        if (invalidDescriptor) continue

        let dataKeys: string[]
        if (isArray) {
          const length = descriptors.get('length')?.value
          if (!Number.isSafeInteger(length) || length < 0) {
            diagnostics.push(diagnostic('DATA_ONLY', path, 'array length must be a safe non-negative integer'))
            continue
          }
          if (length > MAX_ARRAY_ITEMS) {
            diagnostics.push(diagnostic('SIZE_LIMIT', path, `arrays cannot exceed ${MAX_ARRAY_ITEMS} items`))
            continue
          }
          const arrayKeys = stringKeys.filter((key) => key !== 'length')
          const denseKeys = Array.from({ length }, (_, index) => String(index))
          if (arrayKeys.length !== denseKeys.length
            || denseKeys.some((key) => !descriptors.has(key))) {
            diagnostics.push(diagnostic('DATA_ONLY', path, 'arrays must be dense and cannot have custom properties'))
            continue
          }
          dataKeys = denseKeys
        } else {
          dataKeys = stringKeys
          if (dataKeys.some((key) => descriptors.get(key)?.enumerable !== true)) {
            diagnostics.push(diagnostic('DATA_ONLY', path, 'non-enumerable data properties are not allowed'))
            continue
          }
        }

        bytes += 2 + Math.max(0, dataKeys.length - 1)
        for (let index = dataKeys.length - 1; index >= 0; index -= 1) {
          const key = dataKeys[index]
          const childPath = pointer(path, key)
          if (FORBIDDEN_KEYS.has(key)) {
            diagnostics.push(diagnostic('PROTOTYPE_KEY', childPath, `property ${JSON.stringify(key)} is forbidden`))
            continue
          }
          if (!isArray) {
            bytes += new TextEncoder().encode(JSON.stringify(key)).byteLength + 1
          }
          pending.push({ value: descriptors.get(key)!.value, path: childPath, depth: depth + 1 })
        }
      } catch {
        diagnostics.push(diagnostic('DATA_ONLY', path, 'data reflection failed'))
      }
    }

    if (bytes > EMAIL_DOCUMENT_MAX_BYTES) {
      diagnostics.push(diagnostic('SIZE_LIMIT', '/', `decoded document exceeds ${EMAIL_DOCUMENT_MAX_BYTES} bytes`))
      break
    }
  }
  return diagnostics
}

function canonicalizeData(value: unknown): unknown {
  if (Array.isArray(value)) {
    const length = Reflect.getOwnPropertyDescriptor(value, 'length')!.value as number
    return Array.from({ length }, (_, index) =>
      canonicalizeData(Reflect.getOwnPropertyDescriptor(value, String(index))!.value))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Reflect.ownKeys(value).map(String).sort(compareText).map((key) =>
        [key, canonicalizeData(Reflect.getOwnPropertyDescriptor(value, key)!.value)]),
    )
  }
  return value
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function containsUrlWhitespaceOrControl(raw: string): boolean {
  for (const character of raw) {
    const codePoint = character.codePointAt(0)!
    if (/\s/u.test(character) || codePoint < 0x20 || codePoint === 0x7f) return true
  }
  return false
}

function safeUrlMessage(raw: string, image: boolean): string | undefined {
  if (containsUrlWhitespaceOrControl(raw)) return 'URLs cannot contain whitespace or control characters'
  if (image && !raw.startsWith('https://')) return 'image URLs must use https'
  if (!image && raw.startsWith('mailto:')) {
    return /^mailto:[^@/?#\s]+@[^@/?#\s]+$/.test(raw) ? undefined : 'mailto URLs must contain one address and no parameters'
  }
  if (!raw.startsWith('https://')) return 'links must use https or mailto'
  try {
    const url = new URL(raw)
    if (!url.hostname || url.username || url.password) return 'https URLs require a host and cannot contain credentials'
    if (url.port && url.port !== '443') return 'https URLs cannot use a custom port'
    return undefined
  } catch {
    return 'URL is malformed'
  }
}

function semanticDiagnostics(document: EmailDocument): EmailDocumentDiagnostic[] {
  const diagnostics: EmailDocumentDiagnostic[] = []
  const pending: Array<{ node: EmailNode; path: string; depth: number }> = document.children
    .map((node, index) => ({ node, path: `/children/${index}`, depth: 1 }))
    .reverse()
  let nodeCount = 0

  while (pending.length > 0) {
    const entry = pending.pop()!
    nodeCount += 1
    if (nodeCount > EMAIL_DOCUMENT_MAX_NODES) {
      diagnostics.push(diagnostic('NODE_LIMIT', entry.path, `document exceeds ${EMAIL_DOCUMENT_MAX_NODES} nodes`))
      break
    }
    if (entry.depth > EMAIL_DOCUMENT_MAX_DEPTH) {
      diagnostics.push(diagnostic('DEPTH_LIMIT', entry.path, `node depth exceeds ${EMAIL_DOCUMENT_MAX_DEPTH}`))
      continue
    }

    if (entry.node.type === 'image') {
      const message = safeUrlMessage(entry.node.src, true)
      if (message) diagnostics.push(diagnostic('UNSAFE_URL', `${entry.path}/src`, message))
    } else if (entry.node.type === 'link' || entry.node.type === 'button') {
      const message = safeUrlMessage(entry.node.href, false)
      if (message) diagnostics.push(diagnostic('UNSAFE_URL', `${entry.path}/href`, message))
    }

    if ('children' in entry.node) {
      for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
        pending.push({
          node: entry.node.children[index],
          path: `${entry.path}/children/${index}`,
          depth: entry.depth + 1,
        })
      }
    }
  }
  return diagnostics
}

export function validateEmailDocument(input: unknown): EmailDocumentValidationResult {
  const structural = scanDataOnly(input)
  if (structural.length > 0) return { ok: false, diagnostics: sortedDiagnostics(structural) }

  let canonical: unknown
    try {
      canonical = canonicalizeData(input)
    } catch {
      return {
        ok: false,
        diagnostics: sortedDiagnostics([diagnostic('DATA_ONLY', '/', 'data canonicalization failed')]),
      }
    }
  if (!EMAIL_DOCUMENT_VALIDATOR.Check(canonical)) {
    const diagnostics = [...EMAIL_DOCUMENT_VALIDATOR.Errors(canonical)].map((error) =>
      diagnostic('SCHEMA', error.path || '/', error.message),
    )
    return { ok: false, diagnostics: sortedDiagnostics(diagnostics) }
  }

  const document = deepFreeze(EMAIL_DOCUMENT_VALIDATOR.Decode(canonical))
  const semantic = semanticDiagnostics(document)
  if (semantic.length > 0) return { ok: false, diagnostics: sortedDiagnostics(semantic) }
  return { ok: true, value: document }
}

export function parseEmailDocument(input: unknown): EmailDocument {
  const result = validateEmailDocument(input)
  if (!result.ok) throw new EmailDocumentValidationError(result.diagnostics)
  return result.value
}
