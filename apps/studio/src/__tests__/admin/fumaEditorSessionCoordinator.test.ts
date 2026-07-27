import { describe, expect, it } from 'bun:test'
import { Value } from '@core/utils/typeboxHelpers'
import {
  EditorSessionCoordinatorError,
  EditorSessionTargetSchema,
  createEditorSessionCoordinator,
  createEditorSessionTarget,
  type BoundEditorSessionAdapter,
  type EditorSessionSaveAccepted,
  type EditorSessionSaveCommand,
  type EditorSessionTarget,
} from '@admin/fuma/editorSession'

type Document = { text: string }

type Deferred<T> = Readonly<{
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}>

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined
  let rejectPromise: ((error: unknown) => void) | undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  if (!resolvePromise || !rejectPromise) throw new Error('Deferred promise was not initialized')
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function target(organizationId: string, profileId = 'website'): EditorSessionTarget {
  return createEditorSessionTarget({
    organizationId,
    workspaceId: 'shared-workspace',
    siteId: 'shared-site',
    profileId,
  })
}

function activeDocument(
  coordinator: ReturnType<typeof createEditorSessionCoordinator<Document>>,
): Document | null {
  const snapshot = coordinator.getSnapshot()
  if (snapshot.kind !== 'active') throw new Error('Expected an active editor session')
  return snapshot.document
}

function accepted(
  command: EditorSessionSaveCommand<Document>,
): EditorSessionSaveAccepted<Document> {
  return {
    outcome: 'accepted',
    mutationId: command.mutationId,
    expectedSequence: command.expectedSequence,
    sequence: command.expectedSequence + 1,
    replayed: false,
    document: structuredClone(command.document),
  }
}

function memoryBinder(initial: Readonly<Record<string, Document>>) {
  const bindCalls: EditorSessionTarget[] = []
  const loadCalls: string[] = []
  const saves: Array<{ organizationId: string; document: Document }> = []

  return {
    bindCalls,
    loadCalls,
    saves,
    bindAdapter(boundTarget: EditorSessionTarget): BoundEditorSessionAdapter<Document> {
      bindCalls.push(boundTarget)
      return {
        async load() {
          loadCalls.push(boundTarget.organizationId)
          return {
            document: structuredClone(initial[boundTarget.organizationId] ?? null),
            sequence: 0,
          }
        },
        async save(command) {
          saves.push({
            organizationId: boundTarget.organizationId,
            document: structuredClone(command.document),
          })
          return accepted(command)
        },
      }
    },
  }
}

describe('FUMA-027 site-keyed editor session coordinator', () => {
  it('publishes a strict TypeBox-derived target and freezes the full copied authority tuple', () => {
    const source = {
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      siteId: 'site-a',
      profileId: 'website',
    }
    const created = createEditorSessionTarget(source)

    expect(Value.Check(EditorSessionTargetSchema, created)).toBe(true)
    expect(Object.isFrozen(created)).toBe(true)
    expect(created).not.toBe(source)
    expect(() => createEditorSessionTarget({
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
    })).toThrow(EditorSessionCoordinatorError)
    expect(() => createEditorSessionTarget({
      organizationId: source.organizationId,
      workspaceId: source.workspaceId,
      siteId: source.siteId,
    })).toThrow(EditorSessionCoordinatorError)
    expect(() => createEditorSessionTarget({ ...source, ownerKey: 'caller-owned' })).toThrow(
      EditorSessionCoordinatorError,
    )
  })

  it('binds load() and save() once to the complete target instead of forwarding an ignorable site ID', async () => {
    const memory = memoryBinder({ 'organization-a': { text: 'loaded-a' } })
    const coordinator = createEditorSessionCoordinator<Document>({
      bindAdapter: memory.bindAdapter,
    })

    await coordinator.switchTarget(target('organization-a'))
    coordinator.replaceDocument({ text: 'edited-a' })
    await coordinator.save()

    expect(memory.bindCalls).toHaveLength(1)
    expect(memory.bindCalls[0]).toEqual(target('organization-a'))
    expect(Object.isFrozen(memory.bindCalls[0])).toBe(true)
    expect(memory.loadCalls).toEqual(['organization-a'])
    expect(memory.saves).toEqual([{
      organizationId: 'organization-a',
      document: { text: 'edited-a' },
    }])
  })

  it('switches cleanly and preserves independent document, history, dirty, and import state for colliding lower-scope IDs', async () => {
    const memory = memoryBinder({
      'organization-a': { text: 'loaded-a' },
      'organization-b': { text: 'loaded-b' },
    })
    const coordinator = createEditorSessionCoordinator<Document>({
      bindAdapter: memory.bindAdapter,
    })

    await coordinator.switchTarget(target('organization-a'))
    coordinator.replaceDocument({ text: 'a-1' })
    coordinator.replaceDocument({ text: 'a-2' })
    expect(coordinator.undo()).toBe(true)
    expect(coordinator.getSnapshot()).toMatchObject({
      document: { text: 'a-1' },
      dirty: true,
      canUndo: true,
      canRedo: true,
      undoDepth: 1,
      redoDepth: 1,
      importState: 'idle',
    })

    const switching = coordinator.switchTarget(target('organization-b'))
    expect(coordinator.getSnapshot()).toMatchObject({
      target: target('organization-b'),
      document: null,
      loadState: 'loading',
      dirty: false,
      canUndo: false,
      canRedo: false,
    })
    await switching
    coordinator.replaceDocument({ text: 'b-1' })
    await coordinator.importDocument(async (document) => ({
      text: `${document.text}-imported`,
    }))
    expect(coordinator.getSnapshot()).toMatchObject({
      document: { text: 'b-1-imported' },
      dirty: true,
      canUndo: true,
      canRedo: false,
      undoDepth: 2,
      importState: 'succeeded',
    })

    await coordinator.switchTarget(target('organization-a'))
    expect(coordinator.getSnapshot()).toMatchObject({
      document: { text: 'a-1' },
      dirty: true,
      canUndo: true,
      canRedo: true,
      undoDepth: 1,
      redoDepth: 1,
      importState: 'idle',
    })
    expect(memory.loadCalls).toEqual(['organization-a', 'organization-b'])

    expect(coordinator.redo()).toBe(true)
    expect(activeDocument(coordinator)).toEqual({ text: 'a-2' })

    await coordinator.switchTarget(target('organization-b'))
    expect(activeDocument(coordinator)).toEqual({ text: 'b-1-imported' })
    expect(coordinator.getSnapshot()).toMatchObject({
      undoDepth: 2,
      redoDepth: 0,
      importState: 'succeeded',
    })
  })

  it('ignores stale cross-target and out-of-order same-target load completions', async () => {
    const loads = new Map<string, Deferred<{ document: Document | null; sequence: number }>[]>()
    const coordinator = createEditorSessionCoordinator<Document>({
      bindAdapter(boundTarget) {
        return {
          load() {
            const pending = deferred<{ document: Document | null; sequence: number }>()
            const queue = loads.get(boundTarget.organizationId) ?? []
            queue.push(pending)
            loads.set(boundTarget.organizationId, queue)
            return pending.promise
          },
          async save(command) {
            return accepted(command)
          }
        }
      },
    })

    const firstA = coordinator.switchTarget(target('organization-a'))
    const loadA1 = loads.get('organization-a')?.[0]
    if (!loadA1) throw new Error('Expected first organization A load')

    const switchB = coordinator.switchTarget(target('organization-b'))
    const loadB = loads.get('organization-b')?.[0]
    if (!loadB) throw new Error('Expected organization B load')
    loadA1.resolve({ document: { text: 'stale-a' }, sequence: 0 })
    await firstA
    expect(coordinator.getSnapshot()).toMatchObject({
      target: target('organization-b'),
      document: null,
      loadState: 'loading',
    })

    loadB.resolve({ document: { text: 'loaded-b' }, sequence: 0 })
    await switchB
    expect(activeDocument(coordinator)).toEqual({ text: 'loaded-b' })

    const returnA = coordinator.switchTarget(target('organization-a'))
    const loadA2 = loads.get('organization-a')?.[1]
    if (!loadA2) throw new Error('Expected second organization A load')
    const newestA = coordinator.reload()
    const loadA3 = loads.get('organization-a')?.[2]
    if (!loadA3) throw new Error('Expected newest organization A load')

    loadA3.resolve({ document: { text: 'newest-a' }, sequence: 0 })
    await newestA
    expect(activeDocument(coordinator)).toEqual({ text: 'newest-a' })
    loadA2.resolve({ document: { text: 'out-of-order-a' }, sequence: 0 })
    await returnA
    expect(activeDocument(coordinator)).toEqual({ text: 'newest-a' })
  })

  it('ignores stale and out-of-order save completions without clearing newer dirty work', async () => {
    const pendingSaves: Array<{
      command: EditorSessionSaveCommand<Document>
      completion: Deferred<EditorSessionSaveAccepted<Document>>
    }> = []
    const coordinator = createEditorSessionCoordinator<Document>({
      bindAdapter() {
        return {
          async load() {
            return { document: { text: 'loaded' }, sequence: 0 }
          },
          save(command) {
            const completion = deferred<EditorSessionSaveAccepted<Document>>()
            pendingSaves.push({ command: structuredClone(command), completion })
            return completion.promise
          },
        }
      },
    })

    await coordinator.switchTarget(target('organization-a'))
    coordinator.replaceDocument({ text: 'first' })
    const firstSave = coordinator.save()
    coordinator.replaceDocument({ text: 'second' })
    const secondSave = coordinator.save()

    expect(pendingSaves.map(({ command }) => command.document)).toEqual([
      { text: 'first' },
      { text: 'second' },
    ])
    pendingSaves[1].completion.resolve(accepted(pendingSaves[1].command))
    await secondSave
    expect(coordinator.getSnapshot()).toMatchObject({
      document: { text: 'second' },
      dirty: false,
      saveState: 'saved',
    })

    coordinator.replaceDocument({ text: 'third' })
    pendingSaves[0].completion.resolve(accepted(pendingSaves[0].command))
    await firstSave
    expect(coordinator.getSnapshot()).toMatchObject({
      document: { text: 'third' },
      dirty: true,
      saveState: 'idle',
    })
  })

  it('ignores stale import completions after a newer import, local edit, or target switch', async () => {
    const memory = memoryBinder({
      'organization-a': { text: 'loaded-a' },
      'organization-b': { text: 'loaded-b' },
    })
    const coordinator = createEditorSessionCoordinator<Document>({
      bindAdapter: memory.bindAdapter,
    })
    await coordinator.switchTarget(target('organization-a'))

    const oldImport = deferred<Document>()
    const newImport = deferred<Document>()
    const first = coordinator.importDocument(() => oldImport.promise)
    const second = coordinator.importDocument(() => newImport.promise)
    newImport.resolve({ text: 'new-import' })
    await second
    oldImport.resolve({ text: 'old-import' })
    await first
    expect(activeDocument(coordinator)).toEqual({ text: 'new-import' })
    expect(coordinator.getSnapshot()).toMatchObject({
      importState: 'succeeded',
      undoDepth: 1,
    })

    const editStaleImport = deferred<Document>()
    const afterEdit = coordinator.importDocument(() => editStaleImport.promise)
    coordinator.replaceDocument({ text: 'local-edit' })
    editStaleImport.resolve({ text: 'must-not-overwrite-edit' })
    await afterEdit
    expect(coordinator.getSnapshot()).toMatchObject({
      document: { text: 'local-edit' },
      importState: 'idle',
    })

    const crossTargetImport = deferred<Document>()
    const staleAcrossSwitch = coordinator.importDocument(() => crossTargetImport.promise)
    await coordinator.switchTarget(target('organization-b'))
    crossTargetImport.resolve({ text: 'must-not-cross-target' })
    await staleAcrossSwitch
    expect(coordinator.getSnapshot()).toMatchObject({
      target: target('organization-b'),
      document: { text: 'loaded-b' },
      importState: 'idle',
    })
  })

  it('keeps separate-tab coordinator instances isolated even for the exact same target', async () => {
    const memory = memoryBinder({ 'organization-a': { text: 'loaded' } })
    const firstTab = createEditorSessionCoordinator<Document>({
      bindAdapter: memory.bindAdapter,
    })
    const secondTab = createEditorSessionCoordinator<Document>({
      bindAdapter: memory.bindAdapter,
    })

    await Promise.all([
      firstTab.switchTarget(target('organization-a')),
      secondTab.switchTarget(target('organization-a')),
    ])
    firstTab.replaceDocument({ text: 'first-tab-edit' })

    expect(firstTab.getSnapshot()).toMatchObject({
      document: { text: 'first-tab-edit' },
      dirty: true,
      canUndo: true,
    })
    expect(secondTab.getSnapshot()).toMatchObject({
      document: { text: 'loaded' },
      dirty: false,
      canUndo: false,
    })
    expect(memory.bindCalls).toHaveLength(2)
  })
})
