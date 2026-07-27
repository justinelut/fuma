import { useEffect, useState } from 'react'
import {
  type DynamicPublicationBinding,
  type DynamicPublicationTarget,
  type DynamicPublicationTemplate,
  type DynamicPublicationTemplateDocument,
} from '@core/fuma/publication/dynamicPublication'
import { getErrorMessage } from '@core/utils/errorMessage'
import { Button } from '@ui/components/Button'
import type { DynamicPublicationTemplateClientPort } from './dynamicPublicationClient'
import styles from './DynamicPublicationTemplateEditor.module.css'

const TARGETS: readonly DynamicPublicationTarget['kind'][] = ['post', 'page', 'author', 'tag', 'date', 'collection']
const BINDINGS: readonly DynamicPublicationBinding[] = [
  'archive.title', 'archive.description', 'archive.count', 'content.title', 'content.excerpt',
  'content.url', 'content.publishedAt', 'item.title', 'item.excerpt', 'item.url', 'item.publishedAt',
]
const ELEMENTS = ['article', 'section', 'header', 'main', 'footer', 'h1', 'h2', 'p', 'a', 'li', 'time'] as const
const INITIAL_DOCUMENT: DynamicPublicationTemplateDocument = {
  version: 1,
  blocks: [{ blockId: 'archive-heading', scope: 'root', element: 'h1', value: { kind: 'binding', binding: 'archive.title' }, href: null }],
}

export type DynamicPublicationTemplateEditorProps = Readonly<{
  client: DynamicPublicationTemplateClientPort
  canWrite: boolean
  templates?: readonly DynamicPublicationTemplate[]
  now?: () => Date
  id?: () => string
}>

export function DynamicPublicationTemplateEditor({ client, canWrite, templates: seeded, now = () => new Date(), id = () => crypto.randomUUID() }: DynamicPublicationTemplateEditorProps) {
  const initial = seeded?.[0]
  const [templates, setTemplates] = useState<readonly DynamicPublicationTemplate[]>(seeded ?? [])
  const [selectedId, setSelectedId] = useState(initial?.templateId ?? '')
  const [name, setName] = useState(initial?.name ?? 'Shared archive')
  const [kind, setKind] = useState<DynamicPublicationTarget['kind']>(initial?.target.kind ?? 'author')
  const [targetId, setTargetId] = useState(initial?.target.targetId ?? '')
  const [emptyState, setEmptyState] = useState(initial?.emptyState ?? 'No published content is available yet.')
  const [document, setDocument] = useState<DynamicPublicationTemplateDocument>(initial?.document ?? INITIAL_DOCUMENT)
  const [message, setMessage] = useState('')
  const selected = templates.find((template) => template.templateId === selectedId) ?? null

  useEffect(() => {
    if (seeded) return
    let active = true
    void client.templates().then((items) => {
      if (!active) return
      setTemplates(items)
      const first = items[0]
      setSelectedId(first?.templateId ?? '')
      if (first) {
        setName(first.name)
        setKind(first.target.kind)
        setTargetId(first.target.targetId ?? '')
        setEmptyState(first.emptyState)
        setDocument(first.document)
      }
    }).catch((error) => { if (active) setMessage(getErrorMessage(error, 'Templates failed to load.')) })
    return () => { active = false }
  }, [client, seeded])

  const addBlock = () => setDocument((current) => ({
    version: 1,
    blocks: [...current.blocks, { blockId: id(), scope: kind === 'post' || kind === 'page' ? 'root' : 'item', element: 'p', value: { kind: 'binding', binding: kind === 'post' || kind === 'page' ? 'content.title' : 'item.title' }, href: null }],
  }))
  const patchBlock = (blockId: string, patch: Partial<DynamicPublicationTemplateDocument['blocks'][number]>) => setDocument((current) => ({
    version: 1,
    blocks: current.blocks.map((block) => block.blockId === blockId ? { ...block, ...patch } : block),
  }))
  const save = async () => {
    const timestamp = now().toISOString()
    const expectedVersion = selected?.version ?? null
    const candidate: DynamicPublicationTemplate = {
      templateId: selected?.templateId ?? id(), name, target: { kind, targetId: targetId || null }, document, emptyState,
      version: (expectedVersion ?? 0) + 1, active: true, createdAt: selected?.createdAt ?? timestamp, updatedAt: timestamp,
    }
    try {
      const saved = await client.saveTemplate(candidate, expectedVersion)
      setTemplates((current) => [saved, ...current.filter((template) => template.templateId !== saved.templateId)])
      setSelectedId(saved.templateId)
      setMessage(`Saved ${saved.name} version ${saved.version}. Shared routes now resolve this version.`)
    } catch (error) { setMessage(getErrorMessage(error, 'Template save failed.')) }
  }

  return <section className={styles.editor} aria-labelledby="dynamic-publication-editor-title">
    <header className={styles.heading}><div><p>Publication design</p><h2 id="dynamic-publication-editor-title">Dynamic templates</h2></div>{!canWrite ? <span>Read only</span> : null}</header>
    <div className={styles.layout}>
      <nav className={styles.templates} aria-label="Dynamic publication templates">
        {templates.length ? templates.map((template) => <Button key={template.templateId} type="button" variant="ghost" size="sm" fullWidth align="between" className={template.templateId === selectedId ? styles.active : styles.template} onClick={() => { setSelectedId(template.templateId); setName(template.name); setKind(template.target.kind); setTargetId(template.target.targetId ?? ''); setEmptyState(template.emptyState); setDocument(template.document) }}><span>{template.name}</span><small>{template.target.kind} · v{template.version}</small></Button>) : <p>No dynamic templates yet.</p>}
        <Button type="button" variant="secondary" size="sm" disabled={!canWrite} onClick={() => { setSelectedId(''); setName('Shared archive'); setKind('author'); setTargetId(''); setEmptyState('No published content is available yet.'); setDocument(INITIAL_DOCUMENT) }}>New template</Button>
      </nav>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save() }}>
        <label>Name<input disabled={!canWrite} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className={styles.row}><label>Route type<select disabled={!canWrite} value={kind} onChange={(event) => setKind(event.target.value as DynamicPublicationTarget['kind'])}>{TARGETS.map((target) => <option key={target} value={target}>{target}</option>)}</select></label><label>Specific target ID <span>(blank means shared)</span><input disabled={!canWrite} value={targetId} onChange={(event) => setTargetId(event.target.value)} /></label></div>
        <label>Empty state<textarea disabled={!canWrite} value={emptyState} onChange={(event) => setEmptyState(event.target.value)} /></label>
        <fieldset disabled={!canWrite}><legend>Template bindings</legend>{document.blocks.map((block) => <div className={styles.block} key={block.blockId}><label>Scope<select value={block.scope} onChange={(event) => patchBlock(block.blockId, { scope: event.target.value as 'root' | 'item' })}><option value="root">Route</option><option value="item">Each loop item</option></select></label><label>Element<select value={block.element} onChange={(event) => patchBlock(block.blockId, { element: event.target.value as typeof block.element })}>{ELEMENTS.map((element) => <option key={element} value={element}>{element}</option>)}</select></label><label>Binding<select value={block.value.kind === 'binding' ? block.value.binding : ''} onChange={(event) => patchBlock(block.blockId, { value: { kind: 'binding', binding: event.target.value as DynamicPublicationBinding } })}>{BINDINGS.map((binding) => <option key={binding} value={binding}>{binding}</option>)}</select></label><Button type="button" variant="ghost" size="sm" disabled={document.blocks.length === 1} onClick={() => setDocument((current) => ({ version: 1, blocks: current.blocks.filter((item) => item.blockId !== block.blockId) }))}>Remove block</Button></div>)}<Button type="button" variant="secondary" size="sm" onClick={addBlock}>Add bound block</Button></fieldset>
        <Button type="submit" variant="secondary" size="sm" disabled={!canWrite || !name.trim() || !emptyState.trim()}>Save shared template</Button>
        {message ? <p role="status" className={styles.status}>{message}</p> : null}
      </form>
    </div>
  </section>
}
