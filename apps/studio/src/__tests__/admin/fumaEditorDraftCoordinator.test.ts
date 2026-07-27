import { describe, expect, it } from 'bun:test'
import {
  EditorSessionConflictError,
  createEditorSessionCoordinator,
  createEditorSessionTarget,
  type BoundEditorSessionAdapter,
  type EditorSessionSaveAccepted,
  type EditorSessionSaveCommand,
  type EditorSessionTarget,
} from '@admin/fuma/editorSession'

type Document = Readonly<{ text: string }>

type Deferred<T> = Readonly<{
  promise: Promise<T>
  resolve(value: T): void
}>

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((done) => { resolve = done })
  if (!resolve) throw new Error('deferred not initialized')
  return { promise, resolve }
}

function target(profileId = 'website', siteId = 'site-a'): EditorSessionTarget {
  return createEditorSessionTarget({
    organizationId: 'organization-a',
    workspaceId: 'workspace-a',
    siteId,
    profileId,
  })
}

function key(value: EditorSessionTarget): string {
  return JSON.stringify([
    value.organizationId,
    value.workspaceId,
    value.siteId,
    value.profileId,
  ])
}

class DraftServer {
  readonly streams = new Map<string, { document: Document; sequence: number }>()
  readonly commands: EditorSessionSaveCommand<Document>[] = []

  adapter(value: EditorSessionTarget): BoundEditorSessionAdapter<Document> {
    const streamKey = key(value)
    const current = () => this.streams.get(streamKey) ?? {
      document: { text: `loaded-${value.profileId}-${value.siteId}` },
      sequence: 0,
    }
    return {
      load: async () => structuredClone(current()),
      save: async (command) => {
        this.commands.push(structuredClone(command))
        const head = current()
        if (command.expectedSequence !== head.sequence) {
          throw new EditorSessionConflictError<Document>({
            code: 'draft-sequence-conflict',
            mutationId: command.mutationId,
            expectedSequence: command.expectedSequence,
            authoritativeSequence: head.sequence,
            authoritativeDocument: structuredClone(head.document),
          })
        }
        const next = {
          document: structuredClone(command.document),
          sequence: head.sequence + 1,
        }
        this.streams.set(streamKey, next)
        return {
          outcome: 'accepted',
          mutationId: command.mutationId,
          expectedSequence: command.expectedSequence,
          sequence: next.sequence,
          replayed: false,
          document: structuredClone(next.document),
        }
      },
    }
  }
}

function mutationIds(tab: string): () => string {
  let value = 0
  return () => `${tab}.${++value}`
}

describe('FUMA-028 client draft sequence reconciliation', () => {
  it('shows one tab conflict, preserves its local edit, and requires explicit resolution', async () => {
    const server = new DraftServer()
    const first = createEditorSessionCoordinator<Document>({
      bindAdapter: (value) => server.adapter(value),
      generateMutationId: mutationIds('tab-a'),
    })
    const second = createEditorSessionCoordinator<Document>({
      bindAdapter: (value) => server.adapter(value),
      generateMutationId: mutationIds('tab-b'),
    })
    await Promise.all([first.switchTarget(target()), second.switchTarget(target())])
    first.replaceDocument({ text: 'first tab' })
    second.replaceDocument({ text: 'second tab' })

    await first.save()
    await expect(second.save()).rejects.toBeInstanceOf(EditorSessionConflictError)
    expect(first.getSnapshot()).toMatchObject({ sequence: 1, dirty: false, saveState: 'saved' })
    expect(second.getSnapshot()).toMatchObject({
      document: { text: 'second tab' },
      sequence: 1,
      dirty: true,
      saveState: 'conflict',
      conflict: {
        code: 'draft-sequence-conflict',
        expectedSequence: 0,
        authoritativeSequence: 1,
        authoritativeDocument: { text: 'first tab' },
      },
    })
    await expect(second.save()).rejects.toBeInstanceOf(EditorSessionConflictError)

    second.resolveConflict('retry-local')
    await second.save()
    expect(second.getSnapshot()).toMatchObject({
      document: { text: 'second tab' }, sequence: 2, dirty: false, saveState: 'saved',
    })
    expect(server.commands.map(({ expectedSequence, mutationId }) => ({
      expectedSequence, mutationId,
    }))).toEqual([
      { expectedSequence: 0, mutationId: 'tab-a.1' },
      { expectedSequence: 0, mutationId: 'tab-b.1' },
      { expectedSequence: 1, mutationId: 'tab-b.2' },
    ])
  })

  it('accepts authoritative conflict state only when explicitly requested', async () => {
    const server = new DraftServer()
    const first = createEditorSessionCoordinator<Document>({
      bindAdapter: (value) => server.adapter(value),
      generateMutationId: mutationIds('first'),
    })
    const second = createEditorSessionCoordinator<Document>({
      bindAdapter: (value) => server.adapter(value),
      generateMutationId: mutationIds('second'),
    })
    await Promise.all([first.switchTarget(target()), second.switchTarget(target())])
    first.replaceDocument({ text: 'authoritative' })
    await first.save()
    second.replaceDocument({ text: 'discard me' })
    await expect(second.save()).rejects.toBeInstanceOf(EditorSessionConflictError)

    second.resolveConflict('accept-authoritative')
    expect(second.getSnapshot()).toMatchObject({
      document: { text: 'authoritative' },
      sequence: 1,
      dirty: false,
      saveState: 'idle',
      canUndo: false,
    })
  })

  it('advances sequence from an accepted stale response without clearing newer local work', async () => {
    const completion = deferred<EditorSessionSaveAccepted<Document>>()
    const commands: EditorSessionSaveCommand<Document>[] = []
    const coordinator = createEditorSessionCoordinator<Document>({
      generateMutationId: mutationIds('tab'),
      bindAdapter() {
        return {
          load: async () => ({ document: { text: 'loaded' }, sequence: 0 }),
          save(command) {
            commands.push(structuredClone(command))
            if (commands.length === 1) return completion.promise
            return Promise.resolve({
              outcome: 'accepted',
              mutationId: command.mutationId,
              expectedSequence: command.expectedSequence,
              sequence: command.expectedSequence + 1,
              replayed: false,
              document: command.document,
            })
          },
        }
      },
    })
    await coordinator.switchTarget(target())
    coordinator.replaceDocument({ text: 'sent' })
    const saving = coordinator.save()
    coordinator.replaceDocument({ text: 'newer local' })
    completion.resolve({
      outcome: 'accepted',
      mutationId: 'tab.1',
      expectedSequence: 0,
      sequence: 1,
      replayed: false,
      document: { text: 'sent' },
    })
    await saving
    expect(coordinator.getSnapshot()).toMatchObject({
      document: { text: 'newer local' }, sequence: 1, dirty: true, saveState: 'idle',
    })
    await coordinator.save()
    expect(commands[1]).toMatchObject({ expectedSequence: 1, mutationId: 'tab.2' })
  })

  it('isolates equal site IDs by profile and equal targets by coordinator instance', async () => {
    const server = new DraftServer()
    const website = createEditorSessionCoordinator<Document>({
      bindAdapter: (value) => server.adapter(value),
      generateMutationId: mutationIds('website-tab'),
    })
    const publication = createEditorSessionCoordinator<Document>({
      bindAdapter: (value) => server.adapter(value),
      generateMutationId: mutationIds('publication-tab'),
    })
    await Promise.all([
      website.switchTarget(target('website')),
      publication.switchTarget(target('publication')),
    ])
    website.replaceDocument({ text: 'website edit' })
    publication.replaceDocument({ text: 'publication edit' })
    await Promise.all([website.save(), publication.save()])

    expect(website.getSnapshot()).toMatchObject({ sequence: 1, document: { text: 'website edit' } })
    expect(publication.getSnapshot()).toMatchObject({ sequence: 1, document: { text: 'publication edit' } })
    expect(server.streams.size).toBe(2)
    expect(server.commands.map(({ mutationId }) => mutationId).sort()).toEqual([
      'publication-tab.1', 'website-tab.1',
    ])
  })
})
