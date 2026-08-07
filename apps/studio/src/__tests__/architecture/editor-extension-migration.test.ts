/**
 * Task 60: editor.code extensions migrated to the new IR shape.
 *
 * The claim the migration rests on - that an extension gets the editor store by mutable reference -
 * is asserted against the shipped SDK, and every operation named is asserted to exist in edit.ts.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EXTENSION_OPERATIONS,
  MIGRATION_ORDER,
  UNCARRIED_CAPABILITIES,
  isExpressible,
  reviewExtensionSurface,
} from '../../core/plugin-sdk/editorExtensionMigration'

const STUDIO = join(import.meta.dir, '..', '..', '..')

describe('what an extension gets today', () => {
  it('the store itself, by reference', () => {
    const api = readFileSync(join(STUDIO, 'src/core/plugin-sdk/types/editorApi.ts'), 'utf8')
    expect(api).toContain('read: () => EditorStore')
  })

  it('and a transaction that hands it a MUTABLE store to write into', () => {
    const api = readFileSync(join(STUDIO, 'src/core/plugin-sdk/types/editorApi.ts'), 'utf8')
    expect(api).toContain('transaction: (mutate: (store: EditorStore) => void) => void')
  })

  it('imported from the editor\'s OWN internal types, which is what makes it the ABI', () => {
    const api = readFileSync(join(STUDIO, 'src/core/plugin-sdk/types/editorApi.ts'), 'utf8')
    expect(api).toContain("from '@site/store/types'")
  })
})

describe('the operation vocabulary replaces mutation', () => {
  it('is a closed set', () => {
    expect(EXTENSION_OPERATIONS).toHaveLength(6)
  })

  it('and EVERY operation is one edit.ts already implements', () => {
    // This is what makes an invalid tree unreachable: the engine validates each of these, so an
    // extension cannot express an edit nobody checks.
    const edit = readFileSync(join(STUDIO, 'src/core/react-ir/edit.ts'), 'utf8')
    const expected: Record<string, string> = {
      'insert-nodes': 'insertNodes',
      'move-node': 'moveNode',
      'delete-node': 'deleteNode',
      'duplicate-node': 'duplicateNode',
      'set-class-tokens': 'setClassTokens',
      'reorder-child': 'reorderChild',
    }
    for (const operation of EXTENSION_OPERATIONS) {
      expect(edit).toContain(`export function ${expected[operation]}`)
    }
  })

  it('anything outside the set is not expressible', () => {
    expect(isExpressible('insert-nodes')).toBe(true)
    expect(isExpressible('rewrite-everything')).toBe(false)
  })
})

describe('the review names the two separate problems', () => {
  const sound = {
    receivesStore: false,
    mutatesDirectly: false,
    operationsValidated: true,
    refusalsReported: true,
  }

  it('a sound surface reports nothing', () => {
    expect(reviewExtensionSurface(sound)).toHaveLength(0)
  })

  it('receiving the store makes internal fields part of the contract', () => {
    const problems = reviewExtensionSurface({ ...sound, receivesStore: true })
    expect(problems.map((p) => p.code)).toContain('store-is-the-abi')
    expect(problems[0]!.message).toContain('ordinary rename')
  })

  it('direct mutation is flagged for the tree it can leave behind', () => {
    // The deeper problem, and one that would matter with no engine change at all.
    const problems = reviewExtensionSurface({ ...sound, mutatesDirectly: true })
    const message = problems.find((p) => p.code === 'unvalidated-mutation')!.message
    expect(message).toContain('two parents')
    expect(message).toContain('save time')
  })

  it('an unvalidated operation is flagged', () => {
    const problems = reviewExtensionSurface({ ...sound, operationsValidated: false })
    expect(problems.map((p) => p.code)).toContain('operation-not-validated')
  })

  it('a swallowed refusal is flagged, with what the author sees', () => {
    const problems = reviewExtensionSurface({ ...sound, refusalsReported: false })
    const message = problems.find((p) => p.code === 'refusal-swallowed')!.message
    expect(message).toContain('watching nothing happen')
  })

  it('reports every problem together', () => {
    expect(reviewExtensionSurface({
      receivesStore: true,
      mutatesDirectly: true,
      operationsValidated: false,
      refusalsReported: false,
    })).toHaveLength(4)
  })
})

describe('what cannot be carried across is stated', () => {
  it('reading arbitrary state, with the route to get a field published', () => {
    const entry = UNCARRIED_CAPABILITIES.find((c) => c.capability.includes('arbitrary'))
    expect(entry?.instead).toContain('added to the projection')
  })

  it('writing module+props shapes, because those shapes no longer exist', () => {
    const entry = UNCARRIED_CAPABILITIES.find((c) => c.capability.includes('module+props'))
    expect(entry?.why).toContain('React node union')
    expect(entry?.instead).toContain('conversion map')
  })

  it('and deciding undo granularity, which is now a property of the operation', () => {
    const entry = UNCARRIED_CAPABILITIES.find((c) => c.capability.includes('undo'))
    expect(entry?.why).toContain('one step')
  })

  it('every entry states why AND what to do instead', () => {
    for (const entry of UNCARRIED_CAPABILITIES) {
      expect(entry.why.length).toBeGreaterThan(40)
      expect(entry.instead.length).toBeGreaterThan(30)
    }
  })
})

describe('the ordering agrees with ABI v2 rather than contradicting it', () => {
  it('depends on the frame tier, because an extension must still render', () => {
    expect(MIGRATION_ORDER.dependsOn).toContain('frame tier')
    expect(MIGRATION_ORDER.reason).toContain('unable to draw')
  })

  it('the new surface ships ALONGSIDE the old one first, avoiding a flag day', () => {
    expect(MIGRATION_ORDER.firstStep).toContain('alongside')
  })

  it('and removal is last', () => {
    expect(MIGRATION_ORDER.lastStep).toContain('Remove store.read')
  })
})
