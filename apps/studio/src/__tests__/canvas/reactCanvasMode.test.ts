/**
 * Task 51's mounting: a React IR module is a THIRD DOCUMENT KIND on the canvas.
 *
 * The surface itself was built and proven earlier (reactCanvasSurface.test.tsx, 10 pass) but nothing
 * rendered it, so none of it was reachable. It could NOT be mounted as a sidebar panel: this editor's
 * store holds PageNode trees while a module holds the node union from core/react-ir, so offering
 * React-IR insertion from a panel beside a PageNode canvas would insert into a document that cannot
 * hold it — and the failure would surface at SAVE time, far from the insert that caused it.
 *
 * So it follows the single-active-document pattern the visual-component canvas already established.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SITE = join(import.meta.dir, '..', '..', 'admin', 'pages', 'site')
const uiSlice = readFileSync(join(SITE, 'store/slices/uiSlice.ts'), 'utf8')
const canvasRoot = readFileSync(join(SITE, 'canvas/CanvasRoot.tsx'), 'utf8')
const documentTools = readFileSync(join(SITE, 'agent/documentTools.ts'), 'utf8')

describe('the module is a document kind, not a panel', () => {
  it('declares reactModule alongside the existing kinds', () => {
    expect(uiSlice).toContain("| { kind: 'reactModule'; path: string }")
    // The two kinds it joins must still exist - this is an addition, not a replacement.
    expect(uiSlice).toContain("| { kind: 'page'; pageId: string }")
    expect(uiSlice).toContain("| { kind: 'visualComponent'; vcId: string }")
  })

  it('is keyed by PATH rather than an id', () => {
    // The module store keys on the repository path; a module has no numeric id to address it by, so
    // an `id` field would have to be invented and then mapped back to a path somewhere else.
    const decl = uiSlice.slice(uiSlice.indexOf('export type ActiveDocument'))
    expect(decl.slice(0, 1200)).toContain("kind: 'reactModule'; path: string")
  })

  it('states in the source WHY a panel was not the answer', () => {
    const decl = uiSlice.slice(uiSlice.indexOf('export type ActiveDocument'))
    // The reason is the store boundary, not preference: two node models cannot share one store.
    expect(decl.slice(0, 1200)).toContain('PageNode')
  })
})

describe('the canvas renders it', () => {
  it('branches to ReactCanvasSurface for the new kind', () => {
    expect(canvasRoot).toContain("activeDocument?.kind === 'reactModule'")
    // Passes the document's own path, so the surface can refuse when the editor store holds a
    // DIFFERENT module than this document names - two states that could otherwise disagree silently.
    expect(canvasRoot).toContain('<ReactCanvasSurface expectedPath={activeDocument.path} />')
    expect(canvasRoot).toContain("from './ReactCanvasSurface'")
  })

  it('branches AFTER the hooks, so hook order is identical whichever document is open', () => {
    // An early return placed above the hooks would break React's rules the moment somebody switches
    // document — the defect would appear as a crash on switching rather than on first render.
    const branch = canvasRoot.indexOf("activeDocument?.kind === 'reactModule'")
    const lastHook = Math.max(
      canvasRoot.lastIndexOf('useEffect('),
      canvasRoot.lastIndexOf('useMemo('),
      canvasRoot.lastIndexOf('useCallback('),
    )
    expect(lastHook).toBeGreaterThan(-1)
    expect(branch).toBeGreaterThan(lastHook)
  })

  it('marks the region so the two canvases are distinguishable', () => {
    // Both render data-testid="canvas-root", so a test or a script inspecting the canvas needs a way
    // to tell which document it is looking at.
    expect(canvasRoot).toContain('data-canvas-document="reactModule"')
    expect(canvasRoot).toContain('aria-label="Canvas — React module"')
  })
})

describe('the PageNode agent tools REFUSE while a module is open', () => {
  it('returns null from both document readers rather than falling through', () => {
    // This is the sharp one. Both readers ended with
    //   activeDocument?.kind === 'page' ? activeDocument.pageId : store.activePageId
    // so a module on canvas fell through to the PREVIOUSLY OPEN PAGE - the HTML tools would have
    // edited a document the author is not looking at, and reported success.
    const occurrences = documentTools.split("activeDocument?.kind === 'reactModule') return null").length - 1
    expect(occurrences).toBe(2)
  })

  it('guards BEFORE the visualComponent branch and the page fallback', () => {
    const guard = documentTools.indexOf("activeDocument?.kind === 'reactModule') return null")
    const fallback = documentTools.indexOf('store.activePageId')
    expect(guard).toBeGreaterThan(-1)
    expect(fallback).toBeGreaterThan(guard)
  })

  it('still resolves a page document normally', () => {
    // The refusal must not cost the ordinary case: a page document still reaches the page lookup.
    expect(documentTools).toContain("activeDocument?.kind === 'page' ? activeDocument.pageId : store.activePageId")
  })
})

describe('leaving the module has somewhere to return to', () => {
  it('captures the previous page for reactModule as well as visualComponent', () => {
    // Keying the capture on 'visualComponent' alone sent a module through the else branch, which
    // CLEARS previousActivePageId - so entering a module destroyed the way back to the page.
    expect(uiSlice).toContain("doc?.kind === 'visualComponent' || doc?.kind === 'reactModule'")
  })

  it('still clears the captured page when returning to a page or to null', () => {
    // The else branch is what makes the capture single-use; without it a stale id would send somebody
    // back to a page they left two documents ago.
    const body = uiSlice.slice(uiSlice.indexOf('setActiveDocument: (doc) =>'))
    expect(body.slice(0, 1600)).toContain('state.previousActivePageId = null')
  })
})

describe('the AI is not told it is looking at a page it is not', () => {
  it('withholds the page snapshot while a React module is the active document', () => {
    const pageContext = readFileSync(join(SITE, 'agent/pageContext.ts'), 'utf8')
    // Returning the previously open page would describe a document the author is not looking at - and
    // the HTML tools already refuse in that state, so the description and the tools would disagree.
    expect(pageContext).toContain("state.activeDocument?.kind === 'reactModule') return undefined")
  })

  it('withholds it BEFORE resolving an active page, so no page is described first', () => {
    const pageContext = readFileSync(join(SITE, 'agent/pageContext.ts'), 'utf8')
    const guard = pageContext.indexOf("kind === 'reactModule') return undefined")
    const resolve = pageContext.indexOf('state.site?.pages.find')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(resolve)
  })

  it('uses the EXISTING undefined escape hatch rather than inventing a document type', () => {
    // AgentDocumentRef is a validated schema union keyed by id (page | template | visualComponent), and
    // a module is addressed by PATH - so widening that schema would be the wrong shape.
    const toolSchemas = readFileSync(
      join(SITE, '..', '..', '..', 'core', 'ai', 'toolSchemas.ts'), 'utf8')
    expect(toolSchemas).not.toContain("Type.Literal('reactModule')")
  })
})
