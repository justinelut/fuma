import { useEffect, useMemo, useState } from 'react'
import { Code2, Component, Sparkles, X } from 'lucide-react'
import { Button } from '@admin/fuma/ui/button'
import { AnimationPanel } from '@site/panels/AnimationPanel/AnimationPanel'
import { ReactPropertiesMount } from '@site/panels/ReactPropertiesPanel/ReactPropertiesMount'
import { classTokensOf, type ReactIrNode } from '@core/react-ir/nodes'
import { splitClassString } from '@core/react-ir/classTokens'
import type { MotionAnimation } from '@core/react-ir/motion'
import {
  useOpenModule,
  useReactEditorStore,
  useSelectedNode,
  useSelection,
} from './reactEditorStore'
import styles from './ReactCanvasSurface.module.css'

type InspectorTab = 'style' | 'properties' | 'motion'

const EMPTY_ANIMATION: MotionAnimation = Object.freeze({})

export function ReactInspector() {
  const module = useOpenModule()
  const selection = useSelection()
  const node = useSelectedNode()
  const replaceClasses = useReactEditorStore((state) => state.replaceClasses)
  const changeAnimation = useReactEditorStore((state) => state.setAnimation)
  const [tab, setTab] = useState<InspectorTab>('style')

  if (selection.length !== 1 || node === null || module === null) {
    return (
      <aside className={styles.inspector} aria-label="React inspector">
        <div className={styles.inspectorEmpty} role="status">
          <span className={styles.inspectorEmptyIcon} aria-hidden="true"><Component /></span>
          <strong>{selection.length > 1 ? 'One layer at a time' : 'Select a layer'}</strong>
          <p>
            {selection.length > 1
              ? 'Choose one layer to edit its classes, component options, and Motion behavior.'
              : 'Click an element on the canvas. Its React controls will appear here.'}
          </p>
        </div>
      </aside>
    )
  }

  return (
    <aside className={styles.inspector} aria-label="React inspector">
      <header className={styles.inspectorHeader}>
        <span className={styles.nodeKind}>{node.kind}</span>
        <strong className={styles.nodeName}>{nodeName(node)}</strong>
        <code className={styles.nodeId}>{node.id}</code>
      </header>

      <nav className={styles.inspectorTabs} aria-label="Layer controls">
        <InspectorTabButton tab="style" active={tab} onSelect={setTab} icon={<Code2 />}>
          Tailwind
        </InspectorTabButton>
        <InspectorTabButton tab="properties" active={tab} onSelect={setTab} icon={<Component />}>
          Props
        </InspectorTabButton>
        <InspectorTabButton tab="motion" active={tab} onSelect={setTab} icon={<Sparkles />}>
          Motion
        </InspectorTabButton>
      </nav>

      <div className={styles.inspectorBody}>
        {tab === 'style' && (
          <TailwindPanel node={node} onReplace={replaceClasses} />
        )}
        {tab === 'properties' && <ReactPropertiesMount />}
        {tab === 'motion' && (
          <MotionPanel
            node={node}
            boundary={module.boundary}
            onChange={changeAnimation}
          />
        )}
      </div>
    </aside>
  )
}

function InspectorTabButton({
  tab,
  active,
  onSelect,
  icon,
  children,
}: Readonly<{
  tab: InspectorTab
  active: InspectorTab
  onSelect: (tab: InspectorTab) => void
  icon: React.ReactNode
  children: React.ReactNode
}>) {
  const selected = tab === active
  return (
    <button
      type="button"
      className={styles.inspectorTab}
      aria-pressed={selected}
      onClick={() => onSelect(tab)}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

function TailwindPanel({
  node,
  onReplace,
}: Readonly<{
  node: ReactIrNode
  onReplace: (tokens: readonly string[]) => void
}>) {
  const tokens = useMemo(() => classTokensOf(node), [node])
  const classValue = tokens.join(' ')
  const [draft, setDraft] = useState(classValue)

  useEffect(() => setDraft(classValue), [classValue, node.id])

  if (!('classTokens' in node)) {
    return (
      <InspectorNotice
        title="No element to style"
        body={`A ${node.kind} layer does not render an element of its own, so it carries no Tailwind classes.`}
      />
    )
  }

  const commit = () => onReplace(splitClassString(draft.trim()))

  return (
    <div className={styles.controlSection} data-testid="react-tailwind-panel">
      <div className={styles.controlHeading}>
        <div>
          <span className={styles.eyebrow}>Class tokens</span>
          <h3>Tailwind</h3>
        </div>
        <span className={styles.tokenCount}>{tokens.length}</span>
      </div>
      <p className={styles.controlHelp}>
        This is the exact class list written to TSX. Responsive and state variants stay editable.
      </p>
      <label className={styles.classField}>
        <span>Classes</span>
        <textarea
          value={draft}
          rows={5}
          spellCheck={false}
          placeholder="grid gap-6 md:grid-cols-2"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commit()
          }}
        />
      </label>
      <div className={styles.classActions}>
        <Button type="button" size="sm" onClick={commit}>Apply classes</Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={tokens.length === 0}
          onClick={() => { setDraft(''); onReplace([]) }}
        >
          Clear
        </Button>
      </div>
      {tokens.length === 0 ? (
        <p className={styles.emptyTokens}>No classes yet. Add utilities above or insert a styled block.</p>
      ) : (
        <ul className={styles.tokenList} aria-label="Applied Tailwind classes">
          {tokens.map((token) => (
            <li key={token}>
              <code>{token}</code>
              <button
                type="button"
                aria-label={`Remove ${token}`}
                onClick={() => onReplace(tokens.filter((current) => current !== token))}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MotionPanel({
  node,
  boundary,
  onChange,
}: Readonly<{
  node: ReactIrNode
  boundary: 'server' | 'client'
  onChange: (animation: MotionAnimation | null) => void
}>) {
  if (node.kind !== 'element' && node.kind !== 'component') {
    return (
      <InspectorNotice
        title="No Motion target"
        body={`A ${node.kind} layer has no element for Motion to animate.`}
      />
    )
  }

  if (boundary === 'server') {
    return (
      <InspectorNotice
        title="Keep the route on the server"
        body="Motion belongs in a client component. Open or extract the interactive component instead of turning the whole route into client code."
      />
    )
  }

  const animation = node.animation ?? EMPTY_ANIMATION
  return (
    <div data-testid="react-motion-panel">
      <div className={styles.motionIntro}>
        <div>
          <span className={styles.eyebrow}>Motion</span>
          <h3>{node.animation ? 'Animation attached' : 'Add animation'}</h3>
        </div>
        {node.animation && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
      <AnimationPanel animation={animation} hasPresenceAncestor={false} onChange={onChange} />
    </div>
  )
}

function InspectorNotice({ title, body }: Readonly<{ title: string, body: string }>) {
  return (
    <div className={styles.inspectorNotice} role="status">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}

function nodeName(node: ReactIrNode): string {
  if (node.label?.trim()) return node.label
  if (node.kind === 'element') return `<${node.tag}>`
  if (node.kind === 'component') return node.component.symbol
  if (node.kind === 'repeat') return node.source.id
  if (node.kind === 'slot') return node.name
  if (node.kind === 'opaque') return node.symbol
  return node.kind
}
