import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { Body, Html, Text } from 'react-email'
import {
  EMAIL_DOCUMENT_MAX_DEPTH,
  EMAIL_DOCUMENT_MAX_NODES,
  EmailDocumentValidationError,
  parseEmailDocument,
  validateEmailDocument,
  type EmailDocumentDiagnosticCode,
} from '@core/fuma/email'
import {
  renderEmailDocument,
  renderTrustedSystemTemplate,
} from '../../../server/fuma/email'

const VALID_DOCUMENT = {
  version: 1,
  lang: 'en',
  direction: 'ltr',
  previewText: 'Your weekly workspace update',
  bodyStyle: {
    backgroundColor: '#f4f4f4',
    color: '#171717',
    fontFamily: 'Arial, Helvetica, sans-serif',
    paddingTop: '24px',
    paddingBottom: '24px',
  },
  children: [{
    type: 'container',
    style: { backgroundColor: '#ffffff', maxWidth: '600px', paddingTop: '24px', paddingBottom: '24px' },
    children: [{
      type: 'section',
      style: { paddingLeft: '24px', paddingRight: '24px' },
      children: [
        { type: 'heading', level: 1, text: 'Workspace update', style: { fontSize: '24px', lineHeight: '32px' } },
        { type: 'text', text: 'Hello <strong>Amina</strong>. Your workspace is ready.' },
        { type: 'button', text: 'Review workspace', href: 'https://app.fuma.invalid/review?id=42', style: { backgroundColor: '#171717', color: '#ffffff', paddingTop: '12px', paddingBottom: '12px', paddingLeft: '20px', paddingRight: '20px' } },
        { type: 'divider', style: { borderColor: '#dedede', borderWidth: '1px', borderStyle: 'solid' } },
        { type: 'row', children: [
          { type: 'column', width: '40%', children: [{ type: 'text', text: 'Status', style: { fontWeight: 700 } }] },
          { type: 'column', children: [{ type: 'link', text: 'Ready', href: 'mailto:team@fuma.invalid' }] },
        ] },
        { type: 'image', src: 'https://cdn.fuma.invalid/email/status.png', alt: 'Ready', width: 120, height: 32 },
        { type: 'spacer', height: '16px' },
      ],
    }],
  }],
}

function expectRejected(input: unknown, code?: EmailDocumentDiagnosticCode) {
  const first = validateEmailDocument(input)
  const second = validateEmailDocument(input)
  expect(first.ok).toBe(false)
  expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  if (!first.ok && code) expect(first.diagnostics.map((item) => item.code)).toContain(code)
}

function nestedDocument(depth: number): unknown {
  let node: unknown = { type: 'text', text: 'bottom' }
  for (let index = 1; index < depth; index += 1) {
    node = { type: 'section', children: [node] }
  }
  return { version: 1, children: [node] }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0
    return value / 0x1_0000_0000
  }
}

describe('FUMA-042 EmailDocument renderer', () => {
  it('demo renders valid tenant data to deterministic HTML and plaintext without interpreting markup', async () => {
    const first = await renderEmailDocument(VALID_DOCUMENT)
    const second = await renderEmailDocument(VALID_DOCUMENT)

    expect(first.html).toBe(second.html)
    expect(first.text).toBe(second.text)
    expect(first.html).toContain('Workspace update')
    expect(first.html).toContain('&lt;strong&gt;Amina&lt;/strong&gt;')
    expect(first.html).toContain('https://app.fuma.invalid/review?id=42')
    expect(first.html).not.toMatch(/<script|javascript:/i)
    expect(first.text).toContain('Review workspace')
    expect(first.text).toContain('https://app.fuma.invalid/review?id=42')
    expect(Object.isFrozen(first.document)).toBe(true)
    expect(Object.isFrozen(first.document.children[0])).toBe(true)
    process.stdout.write('[FUMA-042 demo] tenant data rendered to deterministic HTML/plaintext; markup remained text\n')
  })

  it('canonicalizes object key order before rendering', async () => {
    const left = {
      version: 1,
      bodyStyle: { color: '#171717', backgroundColor: '#ffffff' },
      children: [{ type: 'text', text: 'Stable', style: { color: '#171717', fontSize: '16px' } }],
    }
    const right = {
      children: [{ style: { fontSize: '16px', color: '#171717' }, text: 'Stable', type: 'text' }],
      bodyStyle: { backgroundColor: '#ffffff', color: '#171717' },
      version: 1,
    }
    expect(await renderEmailDocument(left)).toEqual(await renderEmailDocument(right))
  })

  it('returns stable diagnostics and throws one typed validation error', () => {
    const input = { version: 2, children: [], unexpected: true }
    expectRejected(input, 'SCHEMA')
    expect(() => parseEmailDocument(input)).toThrow(EmailDocumentValidationError)
    try {
      parseEmailDocument(input)
    } catch (error) {
      expect(error).toBeInstanceOf(EmailDocumentValidationError)
      if (error instanceof EmailDocumentValidationError) {
        expect(error.diagnostics).toEqual([...error.diagnostics].sort((left, right) =>
          compareText(left.path, right.path)
            || compareText(left.code, right.code)
            || compareText(left.message, right.message),
        ))
      }
    }
  })

  it('rejects scripts, imports, arbitrary components, props, callbacks, and equivalent tenant code', () => {
    const callbackDocument = { version: 1, children: [{ type: 'button', text: 'Run', href: 'https://fuma.invalid', onClick() {} }] }
    const getterDocument = { version: 1, children: [] as unknown[] }
    Object.defineProperty(getterDocument, 'previewText', { enumerable: true, get: () => `${Date.now()}` })

    const attacks: unknown[] = [
      'export default function TenantEmail(){ return <Text>owned</Text> }',
      { version: 1, children: [{ type: 'script', source: 'alert(1)' }] },
      { version: 1, imports: ['react-email'], children: [] },
      { version: 1, children: [{ type: 'text', text: '<script>alert(1)</script>' }] },
      { version: 1, children: [{ type: 'text', text: 'import("https://evil.invalid/code.js")' }] },
      { version: 1, children: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
      { version: 1, children: [{ type: 'Text', text: 'arbitrary component casing' }] },
      { version: 1, children: [{ type: 'text', text: 'extra prop', dangerouslySetInnerHTML: { __html: '<b>owned</b>' } }] },
      callbackDocument,
      getterDocument,
      { version: 1, children: [], generatedAt: new Date() },
    ]

    for (const attack of attacks) expectRejected(attack)
    process.stdout.write('[FUMA-042 demo] equivalent JSX/JavaScript tenant input rejected before render\n')
  })

  it('rejects unsafe URLs and CSS injection while allowing only closed style properties', () => {
    const attacks: unknown[] = [
      { version: 1, children: [{ type: 'link', text: 'x', href: 'javascript:alert(1)' }] },
      { version: 1, children: [{ type: 'link', text: 'x', href: 'http://fuma.invalid' }] },
      { version: 1, children: [{ type: 'button', text: 'x', href: 'https://user:pass@fuma.invalid' }] },
      { version: 1, children: [{ type: 'image', src: 'data:image/png;base64,AAAA', alt: '', width: 1, height: 1 }] },
      { version: 1, children: [{ type: 'image', src: 'https://fuma.invalid:8443/x.png', alt: '', width: 1, height: 1 }] },
      { version: 1, children: [{ type: 'text', text: 'x', style: { backgroundImage: 'url(javascript:alert(1))' } }] },
      { version: 1, children: [{ type: 'text', text: 'x', style: { color: '#fff;position:fixed' } }] },
      { version: 1, children: [{ type: 'text', text: 'x', style: { width: 'calc(100% + 1px)' } }] },
    ]
    for (const attack of attacks) expectRejected(attack)
  })

  it('accepts exact depth/node limits and rejects the first excess plus decoded-size abuse', () => {
    const exactDepth = validateEmailDocument(nestedDocument(EMAIL_DOCUMENT_MAX_DEPTH))
    expect(exactDepth.ok).toBe(true)
    expectRejected(nestedDocument(EMAIL_DOCUMENT_MAX_DEPTH + 1), 'DEPTH_LIMIT')

    const exactNodes = {
      version: 1,
      children: Array.from({ length: 64 }, () => ({
        type: 'section',
        children: Array.from({ length: 3 }, () => ({ type: 'text', text: 'x' })),
      })),
    }
    expect(64 + 64 * 3).toBe(EMAIL_DOCUMENT_MAX_NODES)
    expect(validateEmailDocument(exactNodes).ok).toBe(true)

    const manyNodes = {
      version: 1,
      children: Array.from({ length: 64 }, () => ({
        type: 'section',
        children: Array.from({ length: 4 }, () => ({ type: 'text', text: 'x' })),
      })),
    }
    expect(64 + 64 * 4).toBeGreaterThan(EMAIL_DOCUMENT_MAX_NODES)
    expectRejected(manyNodes, 'NODE_LIMIT')
    expectRejected({
      version: 1,
      children: Array.from({ length: 9 }, () => ({ type: 'text', text: 'x'.repeat(8_000) })),
    }, 'SIZE_LIMIT')

    const oversizedSparseChildren = new Array(1_000_000)
    expectRejected({ version: 1, children: oversizedSparseChildren }, 'SIZE_LIMIT')
    expectRejected({ version: 1, children: new Array(1) }, 'DATA_ONLY')
  })

  it('rejects prototype keys, polluted prototypes, cycles, symbols, reflection failures, and non-finite numbers', () => {
    const prototypeKey = JSON.parse('{"version":1,"children":[],"__proto__":{"polluted":true}}')
    const polluted = { version: 1, children: [] }
    Object.setPrototypeOf(polluted, { polluted: true })
    const cyclic: { version: number; children: unknown[]; self?: unknown } = { version: 1, children: [] }
    cyclic.self = cyclic
    const symbolKey = { version: 1, children: [], [Symbol('hidden')]: true }
    const reflectionFailure = new Proxy({ version: 1, children: [] }, {
      ownKeys() { throw new Error('hostile ownKeys trap') },
    })
    const canonicalizationFailure = () => {
      let ownKeysCalls = 0
      return new Proxy({ version: 1, children: [] }, {
        ownKeys(target) {
          ownKeysCalls += 1
          if (ownKeysCalls > 1) throw new Error('stateful ownKeys trap')
          return Reflect.ownKeys(target)
        },
      })
    }

    expectRejected(prototypeKey, 'PROTOTYPE_KEY')
    expectRejected(polluted, 'DATA_ONLY')
    expectRejected(cyclic, 'DATA_ONLY')
    expectRejected(symbolKey, 'DATA_ONLY')
    expectRejected(reflectionFailure, 'DATA_ONLY')
    const firstCanonicalizationFailure = validateEmailDocument(canonicalizationFailure())
    const secondCanonicalizationFailure = validateEmailDocument(canonicalizationFailure())
    expect(firstCanonicalizationFailure.ok).toBe(false)
    expect(JSON.stringify(firstCanonicalizationFailure)).toBe(JSON.stringify(secondCanonicalizationFailure))
    if (!firstCanonicalizationFailure.ok) {
      expect(firstCanonicalizationFailure.diagnostics.map((item) => item.code)).toContain('DATA_ONLY')
    }
    expectRejected({ version: 1, children: [{ type: 'text', text: 'x' }], value: Number.NaN }, 'DATA_ONLY')
  })

  it('runs a seeded adversarial corpus without accepting any generated attack', () => {
    const random = seededRandom(0xf042)
    const protocols = ['javascript:', 'data:', 'http:', 'file:', 'vbscript:']
    const styleKeys = ['backgroundImage', 'position', 'behavior', 'animationName']
    const componentNames = ['script', 'iframe', 'custom', 'RawHtml']

    for (let index = 0; index < 128; index += 1) {
      const kind = index % 4
      let attack: unknown
      if (kind === 0) {
        attack = { version: 1, children: [{ type: 'link', text: 'fuzz', href: `${protocols[Math.floor(random() * protocols.length)]}//evil.invalid/${index}` }] }
      } else if (kind === 1) {
        const key = styleKeys[Math.floor(random() * styleKeys.length)]
        attack = { version: 1, children: [{ type: 'text', text: 'fuzz', style: { [key]: `url(javascript:${index})` } }] }
      } else if (kind === 2) {
        attack = { version: 1, children: [{ type: componentNames[Math.floor(random() * componentNames.length)], text: 'fuzz' }] }
      } else {
        attack = { version: 1, children: [{ type: 'text', text: `\nexport default function Attack${index}(){ return import('evil') }` }] }
      }
      expectRejected(attack)
    }
  })

  it('keeps trusted server-authored JSX on a separate explicit boundary', async () => {
    const template = createElement(Html, null,
      createElement(Body, null, createElement(Text, null, 'Trusted system notice')),
    )
    const rendered = await renderTrustedSystemTemplate(template)
    expect(rendered.html).toContain('Trusted system notice')
    expect(rendered.text).toBe('Trusted system notice')
  })
})
