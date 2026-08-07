import { describe, it, expect } from 'bun:test'
import {
  mergeModules,
  nodeFingerprint,
  verifyIntegrity,
} from '@core/react-ir/merge'
import { REACT_IR_VERSION, type ReactIrModule, type ReactIrNode } from '@core/react-ir/nodes'

const element = (
  id: string,
  children: string[] = [],
  classTokens: string[] = [],
): ReactIrNode => ({ kind: 'element', id, tag: 'div', children, attributes: {}, classTokens })

function moduleWith(nodes: ReactIrNode[], rootNodeId = 'root'): ReactIrModule {
  return {
    version: REACT_IR_VERSION,
    id: 'm1',
    path: 'Page.tsx',
    symbol: 'Page',
    kind: 'page',
    boundary: 'server',
    propsInterface: [],
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeId,
  }
}

const base = moduleWith([element('root', ['a', 'b']), element('a'), element('b')])

function withNode(module: ReactIrModule, node: ReactIrNode): ReactIrModule {
  return { ...module, nodes: { ...module.nodes, [node.id]: node } }
}

function withoutNode(module: ReactIrModule, id: string): ReactIrModule {
  const nodes = { ...module.nodes }
  delete nodes[id]
  return { ...module, nodes }
}

describe('node fingerprint', () => {
  it('ignores editor metadata so locking a layer is not a change', () => {
    const plain = element('a')
    const decorated: ReactIrNode = { ...plain, label: 'Hero', locked: true, hidden: true }
    // Treating these as modifications would manufacture conflicts from nothing.
    expect(nodeFingerprint(plain)).toBe(nodeFingerprint(decorated))
  })

  it('does not depend on property order', () => {
    const one: ReactIrNode = {
      kind: 'element', id: 'a', tag: 'a', children: [], classTokens: ['x'],
      attributes: {
        href: { kind: 'expression', expression: { kind: 'literal', value: '/' } },
        rel: { kind: 'expression', expression: { kind: 'literal', value: 'noreferrer' } },
      },
    }
    const two: ReactIrNode = {
      ...one,
      attributes: {
        rel: { kind: 'expression', expression: { kind: 'literal', value: 'noreferrer' } },
        href: { kind: 'expression', expression: { kind: 'literal', value: '/' } },
      },
    }
    expect(nodeFingerprint(one)).toBe(nodeFingerprint(two))
  })

  it('compares an opaque region by hash, not contents', () => {
    const opaque = (hash: string): ReactIrNode => ({
      kind: 'opaque', id: 'o', symbol: 'W', source: '@/w', props: {},
      sourceHash: hash, reason: 'hook', children: [],
    })
    // The builder never modelled what is inside, so it has no basis to diff it.
    expect(nodeFingerprint(opaque('a'.repeat(64)))).not.toBe(nodeFingerprint(opaque('b'.repeat(64))))
  })
})

describe('merge authority', () => {
  it('keeps a document unchanged when neither side moved', () => {
    const result = mergeModules({ base, visual: base, source: base })
    expect(result.clean).toBe(true)
    expect(result.applied).toHaveLength(0)
    expect(Object.keys(result.merged.nodes).sort()).toEqual(['a', 'b', 'root'])
  })

  it('takes a visual edit when only the canvas changed', () => {
    const visual = withNode(base, element('a', [], ['bg-primary']))
    const result = mergeModules({ base, visual, source: base })
    expect(result.clean).toBe(true)
    const merged = result.merged.nodes['a']
    expect(merged && 'classTokens' in merged ? merged.classTokens : null).toEqual(['bg-primary'])
    expect(result.applied).toEqual([{ nodeId: 'a', kind: 'modified', side: 'visual' }])
  })

  it('takes a hand edit when only source changed', () => {
    const source = withNode(base, element('b', [], ['p-8']))
    const result = mergeModules({ base, visual: base, source })
    expect(result.clean).toBe(true)
    const merged = result.merged.nodes['b']
    expect(merged && 'classTokens' in merged ? merged.classTokens : null).toEqual(['p-8'])
    expect(result.applied).toEqual([{ nodeId: 'b', kind: 'modified', side: 'source' }])
  })

  it('reports a conflict rather than choosing a winner', () => {
    const visual = withNode(base, element('a', [], ['bg-primary']))
    const source = withNode(base, element('a', [], ['bg-muted']))
    const result = mergeModules({ base, visual, source })

    expect(result.clean).toBe(false)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.nodeId).toBe('a')
    // Nothing is chosen: the base survives, so the document stays renderable
    // while a person decides, and neither side's work is discarded.
    const merged = result.merged.nodes['a']
    expect(merged && 'classTokens' in merged ? merged.classTokens : null).toEqual([])
  })

  it('describes a delete-versus-edit collision specifically', () => {
    const visual = withoutNode(base, 'a')
    const source = withNode(base, element('a', [], ['p-2']))
    const result = mergeModules({ base, visual, source })
    expect(result.conflicts[0]?.detail).toBe('a was deleted on the canvas and edited in source.')
  })

  it('accepts the same addition from both sides without complaint', () => {
    const added = element('c', [], ['mt-4'])
    const result = mergeModules({
      base,
      visual: withNode(base, added),
      source: withNode(base, added),
    })
    // Both sides agreeing is not a conflict; flagging it would be noise.
    expect(result.clean).toBe(true)
    expect(result.merged.nodes['c']).toBeDefined()
  })

  it('conflicts when both sides add the same id with different content', () => {
    const result = mergeModules({
      base,
      visual: withNode(base, element('c', [], ['mt-4'])),
      source: withNode(base, element('c', [], ['mt-8'])),
    })
    expect(result.clean).toBe(false)
    expect(result.conflicts[0]?.visual).toBe('added')
    expect(result.conflicts[0]?.source).toBe('added')
  })

  it('applies a removal taken from one side only', () => {
    const result = mergeModules({ base, visual: withoutNode(base, 'b'), source: base })
    expect(result.clean).toBe(true)
    expect(result.merged.nodes['b']).toBeUndefined()
    expect(result.applied).toEqual([{ nodeId: 'b', kind: 'removed', side: 'visual' }])
  })

  it('follows a root move from whichever side made it', () => {
    const visual = { ...withNode(base, element('newRoot', ['a'])), rootNodeId: 'newRoot' }
    const result = mergeModules({ base, visual, source: base })
    expect(result.merged.rootNodeId).toBe('newRoot')
  })

  it('conflicts when both sides move the root differently', () => {
    const visual = { ...withNode(base, element('r1', ['a'])), rootNodeId: 'r1' }
    const source = { ...withNode(base, element('r2', ['b'])), rootNodeId: 'r2' }
    const result = mergeModules({ base, visual, source })
    expect(result.clean).toBe(false)
    // Keeping the base root means the merged document still resolves.
    expect(result.merged.rootNodeId).toBe('root')
  })
})

describe('merge integrity', () => {
  it('accepts a coherent document', () => {
    expect(verifyIntegrity(base)).toHaveLength(0)
  })

  it('catches a dangling reference a merge can produce', () => {
    // One side deletes a node the other still points at. Writing this out would
    // generate source referencing something absent, so it has to be caught before
    // the merge is trusted rather than after a build fails.
    const broken = withoutNode(base, 'a')
    const problems = verifyIntegrity(broken)
    expect(problems.map((problem) => problem.code)).toContain('missing-node')
    expect(problems[0]?.detail).toContain('root references a')
  })

  it('catches a node nothing references', () => {
    const orphaned = withNode(base, element('stray'))
    const problems = verifyIntegrity(orphaned)
    expect(problems.map((problem) => problem.code)).toContain('orphaned-node')
  })

  it('catches a missing root', () => {
    const problems = verifyIntegrity({ ...base, rootNodeId: 'gone' })
    expect(problems.map((problem) => problem.code)).toContain('missing-root')
  })
})
