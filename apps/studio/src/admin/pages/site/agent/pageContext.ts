/**
 * Site-editor page-context adapter.
 *
 * Reads the active page, current document, and the two editor-only scalars
 * (`selectedNodeId`, `activeBreakpointId`) off the live store and delegates to
 * the pure `buildSiteAgentSnapshot`. This is the only *site-specific* piece of
 * the agent layer — wired in via `agentSliceConfig.site.ts`.
 *
 * Returns `undefined` when there is no active page/site; the chat handler then
 * falls back to its empty snapshot.
 */

import type { EditorStore } from '@site/store/types'
import { buildSiteAgentSnapshot, type SiteAgentSnapshot } from './siteAgentSnapshot'
import { documentRefForPage, type AgentDocumentRef } from '@core/ai'

export function buildCurrentPageContext(get: () => EditorStore): SiteAgentSnapshot | undefined {
  const state = get()
  // A React IR module is open, so there is NO PageNode document to describe. Returning the previously
  // open page instead would tell the model it is looking at a page the author is not, and the HTML
  // tools already refuse in that state - so the description and the tools would disagree.
  //
  // `undefined` is the existing escape hatch: the chat handler falls back to its empty snapshot, which
  // is the honest answer. The model still has the TSX authoring tools, which address a module by PATH
  // rather than through this snapshot.
  if (state.activeDocument?.kind === 'reactModule') return undefined

  const activePage =
    state.site?.pages.find((p) => p.id === state.activePageId) ?? state.site?.pages[0]
  if (!activePage || !state.site) return undefined
  const currentDocument = resolveCurrentDocument(state, activePage)
  return buildSiteAgentSnapshot(activePage, state.site, {
    selectedNodeId: state.selectedNodeId,
    activeBreakpointId: state.activeBreakpointId,
    currentDocument,
  })
}

function resolveCurrentDocument(state: EditorStore, activePage: NonNullable<EditorStore['site']>['pages'][number]): AgentDocumentRef {
  if (state.activeDocument?.kind === 'visualComponent') {
    return { type: 'visualComponent', id: state.activeDocument.vcId }
  }
  if (state.activeDocument?.kind === 'page') {
    const pageId = state.activeDocument.pageId
    const page = state.site?.pages.find((p) => p.id === pageId)
    if (page) return documentRefForPage(page)
  }
  return documentRefForPage(activePage)
}
