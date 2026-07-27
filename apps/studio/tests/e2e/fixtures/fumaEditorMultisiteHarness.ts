import {
  createEditorSessionCoordinator,
  createEditorSessionTarget,
  type BoundEditorSessionAdapter,
  type EditorSessionCoordinatorSnapshot,
  type EditorSessionTarget,
} from '../../../src/admin/fuma/editorSession'

const STORAGE_PREFIX = 'fuma-editor-multisite:'
const COLLIDING_WORKSPACE_ID = 'workspace-collision'
const COLLIDING_SITE_ID = 'site-collision'
const COLLIDING_PAGE_ID = 'page-collision'

const WEBSITE_TARGET = createEditorSessionTarget({
  organizationId: 'organization-website',
  workspaceId: COLLIDING_WORKSPACE_ID,
  siteId: COLLIDING_SITE_ID,
  profileId: 'website',
})
const PUBLICATION_TARGET = createEditorSessionTarget({
  organizationId: 'organization-publication',
  workspaceId: COLLIDING_WORKSPACE_ID,
  siteId: COLLIDING_SITE_ID,
  profileId: 'publication',
})

type Profile = 'Website' | 'Publication'

type HarnessDocument = Readonly<{
  profile: Profile
  site: Readonly<{
    id: string
    name: string
  }>
  page: Readonly<{
    id: string
    title: string
  }>
  importCount: number
}>

type DeferredLoad = Readonly<{
  promise: Promise<HarnessDocument | null>
  resolve(document: HarnessDocument): void
}>

function targetKey(target: EditorSessionTarget): string {
  return JSON.stringify([
    target.organizationId,
    target.workspaceId,
    target.siteId,
    target.profileId,
  ])
}

function storageKey(target: EditorSessionTarget): string {
  return `${STORAGE_PREFIX}${targetKey(target)}`
}

function profileFor(target: EditorSessionTarget): Profile {
  return target.organizationId === WEBSITE_TARGET.organizationId
    ? 'Website'
    : 'Publication'
}

function initialDocument(profile: Profile): HarnessDocument {
  return {
    profile,
    site: {
      id: COLLIDING_SITE_ID,
      name: `${profile} site`,
    },
    page: {
      id: COLLIDING_PAGE_ID,
      title: `${profile} home`,
    },
    importCount: 0,
  }
}

function cloneDocument(document: HarnessDocument): HarnessDocument {
  return structuredClone(document)
}

function readDocument(target: EditorSessionTarget): HarnessDocument {
  const profile = profileFor(target)
  const title = localStorage.getItem(storageKey(target))
  const document = initialDocument(profile)
  if (title === null) return document
  return {
    ...document,
    page: { ...document.page, title },
  }
}

function writeDocument(
  target: EditorSessionTarget,
  document: HarnessDocument,
): void {
  localStorage.setItem(storageKey(target), document.page.title)
}

function resetPersistence(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key)
  }
}

function deferredLoad(): DeferredLoad {
  let resolvePromise: ((document: HarnessDocument) => void) | undefined
  const promise = new Promise<HarnessDocument>((resolve) => {
    resolvePromise = resolve
  })
  if (!resolvePromise) throw new Error('Delayed editor load was not initialized')
  return { promise, resolve: resolvePromise }
}

function output(testId: string, label: string): HTMLElement {
  const row = document.createElement('div')
  const name = document.createElement('span')
  const value = document.createElement('output')
  name.textContent = `${label}: `
  value.dataset.testid = testId
  row.append(name, value)
  return row
}

function action(testId: string, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.testid = testId
  button.textContent = label
  return button
}

function setOutput(testId: string, value: string | number | boolean): void {
  const element = document.querySelector<HTMLOutputElement>(
    `[data-testid="${testId}"]`,
  )
  if (element) element.value = String(value)
}

function activeDocument(
  snapshot: EditorSessionCoordinatorSnapshot<HarnessDocument>,
): HarnessDocument | null {
  return snapshot.kind === 'active' ? snapshot.document : null
}

function mountHarness(): void {
  const params = new URLSearchParams(location.search)
  if (params.get('resetMultisite') === '1') resetPersistence()

  let delayedWebsiteLoad: DeferredLoad | null = null
  let delayedStatus = 'idle'
  const sequences = new Map<string, number>()

  const coordinator = createEditorSessionCoordinator<HarnessDocument>({
    bindAdapter(target): BoundEditorSessionAdapter<HarnessDocument> {
      const boundTarget = createEditorSessionTarget(target)
      const key = targetKey(boundTarget)
      return {
        async load() {
          const loaded = boundTarget.organizationId === WEBSITE_TARGET.organizationId
            && delayedWebsiteLoad !== null
            ? await delayedWebsiteLoad.promise
            : cloneDocument(readDocument(boundTarget))
          return { document: loaded, sequence: sequences.get(key) ?? 0 }
        },
        async save(command) {
          writeDocument(boundTarget, cloneDocument(command.document))
          const sequence = command.expectedSequence + 1
          sequences.set(key, sequence)
          return {
            outcome: 'accepted' as const,
            mutationId: command.mutationId,
            expectedSequence: command.expectedSequence,
            sequence,
            replayed: false,
            document: cloneDocument(command.document),
          }
        },
      }
    },
  })

  document.body.replaceChildren()
  const main = document.createElement('main')
  const heading = document.createElement('h1')
  heading.textContent = 'FUMA editor multisite browser harness'

  const publicOrigin = document.createElement('output')
  publicOrigin.dataset.testid = 'public-origin'
  publicOrigin.value = params.get('publicOrigin') ?? ''

  const titleInput = document.createElement('input')
  titleInput.type = 'text'
  titleInput.id = 'next-page-title'
  titleInput.setAttribute('aria-label', 'Next page title')

  const controls = document.createElement('section')
  controls.setAttribute('aria-label', 'Editor session actions')
  const actions = {
    website: action('target-website', 'Open Website'),
    publication: action('target-publication', 'Open Publication'),
    edit: action('edit-document', 'Edit'),
    undo: action('undo-document', 'Undo'),
    importDocument: action('import-document', 'Import'),
    save: action('save-document', 'Save'),
    reload: action('reload-document', 'Reload'),
    armDelay: action('arm-website-delay', 'Delay next Website load'),
    resolveDelay: action('resolve-website-delay', 'Resolve delayed Website load'),
  }
  controls.append(
    actions.website,
    actions.publication,
    titleInput,
    actions.edit,
    actions.undo,
    actions.importDocument,
    actions.save,
    actions.reload,
    actions.armDelay,
    actions.resolveDelay,
  )

  const evidence = document.createElement('section')
  evidence.setAttribute('aria-label', 'Editor session evidence')
  evidence.append(
    output('target-profile', 'Profile'),
    output('target-organization', 'Organization'),
    output('workspace-id', 'Workspace'),
    output('site-id', 'Site'),
    output('page-id', 'Page'),
    output('page-title', 'Title'),
    output('load-state', 'Load'),
    output('save-state', 'Save'),
    output('import-state', 'Import'),
    output('dirty-state', 'Dirty'),
    output('undo-depth', 'Undo depth'),
    output('redo-depth', 'Redo depth'),
    output('delayed-status', 'Delayed load'),
    output('error-message', 'Error'),
  )

  const status = document.createElement('output')
  status.dataset.testid = 'harness-status'
  status.value = 'ready'
  main.append(heading, publicOrigin, controls, evidence, status)
  document.body.append(main)

  const render = (snapshot: EditorSessionCoordinatorSnapshot<HarnessDocument>) => {
    if (snapshot.kind === 'empty') return
    const documentValue = activeDocument(snapshot)
    setOutput('target-profile', profileFor(snapshot.target))
    setOutput('target-organization', snapshot.target.organizationId)
    setOutput('workspace-id', snapshot.target.workspaceId)
    setOutput('site-id', snapshot.target.siteId)
    setOutput('page-id', documentValue?.page.id ?? '')
    setOutput('page-title', documentValue?.page.title ?? '')
    setOutput('load-state', snapshot.loadState)
    setOutput('save-state', snapshot.saveState)
    setOutput('import-state', snapshot.importState)
    setOutput('dirty-state', snapshot.dirty)
    setOutput('undo-depth', snapshot.undoDepth)
    setOutput('redo-depth', snapshot.redoDepth)
    setOutput('delayed-status', delayedStatus)
    setOutput('error-message', snapshot.errorMessage ?? '')
  }
  coordinator.subscribe(render)

  const run = (operation: () => void | Promise<void>) => {
    void Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        setOutput(
          'error-message',
          error instanceof Error ? error.message : 'Unknown harness error',
        )
      })
  }

  actions.website.addEventListener('click', () => {
    run(() => coordinator.switchTarget(WEBSITE_TARGET))
  })
  actions.publication.addEventListener('click', () => {
    run(() => coordinator.switchTarget(PUBLICATION_TARGET))
  })
  actions.edit.addEventListener('click', () => {
    run(() => {
      const title = titleInput.value
      coordinator.updateDocument((current) => ({
        ...current,
        page: { ...current.page, title },
      }))
    })
  })
  actions.undo.addEventListener('click', () => {
    run(() => {
      coordinator.undo()
    })
  })
  actions.importDocument.addEventListener('click', () => {
    run(() => coordinator.importDocument(async (current) => ({
      ...current,
      page: {
        ...current.page,
        title: `${current.page.title} + imported`,
      },
      importCount: current.importCount + 1,
    })))
  })
  actions.save.addEventListener('click', () => {
    run(() => coordinator.save())
  })
  actions.reload.addEventListener('click', () => {
    run(() => coordinator.reload())
  })
  actions.armDelay.addEventListener('click', () => {
    delayedWebsiteLoad = deferredLoad()
    delayedStatus = 'armed'
    setOutput('delayed-status', delayedStatus)
  })
  actions.resolveDelay.addEventListener('click', () => {
    const pending = delayedWebsiteLoad
    if (pending === null) return
    delayedWebsiteLoad = null
    delayedStatus = 'resolved'
    setOutput('delayed-status', delayedStatus)
    pending.resolve({
      ...initialDocument('Website'),
      page: {
        id: COLLIDING_PAGE_ID,
        title: 'STALE WEBSITE LOAD',
      },
    })
  })
}

mountHarness()
