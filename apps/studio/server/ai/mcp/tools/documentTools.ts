/**
 * Headless site-document catalog for MCP.
 *
 * `site_list_documents` lists editable documents — pages, templates, and visual
 * components — so an MCP agent can orient itself before reading or editing
 * (the site system prompt tells it to call this first for chrome/template work).
 *
 * The site-scope `site_list_documents` in `../../tools/site/readTools.ts` resolves
 * from the browser-posted `ctx.snapshot`, which is null over MCP (no chat turn,
 * no editor snapshot) — calling it there throws on `snap.currentDocument`. This
 * headless version assembles the catalog straight from the DB
 * (`getDraftSiteDocument`) and is ordered ahead of the site toolset in the MCP
 * registry so it wins the de-dup. There is no open-editor focus server-side, so
 * no document is marked active/current; `get_context` reports the live editor.
 */
import { Type } from '@core/utils/typeboxHelpers'
import { describeAgentDocuments } from '@core/ai'
import type { AiTool, ToolContext } from '../../runtime/types'
import { getDraftSiteDocument } from '../../../repositories/publish'
import { SELF_HOST_SITE_ID } from '../../../selfHost'

export const documentMcpTools: AiTool[] = [
  {
    name: 'site_list_documents',
    description:
      'List editable documents: pages, templates, and visual components. Use the returned document refs with site_read_document/site_open_document. Each item includes rootNodeId, template metadata, and a short summary. Headless — no editor needed.',
    scope: 'site',
    execution: 'server',
    inputSchema: Type.Object({}, { additionalProperties: false }),
    requiredCapabilities: ['site.read'],
    handler: async (_input, ctx: ToolContext) => {
      // NOT YET TENANT-SCOPED, and deliberately explicit about it: MCP carries its scope on the
      // session, not the URL, so it needs the session plumbing rather than the request resolver.
      // Naming the legacy scope here keeps the gap visible at the call site.
      const site = await getDraftSiteDocument(ctx.db, SELF_HOST_SITE_ID)
      if (!site) return { ok: false, error: 'No site found.' }
      return {
        currentDocument: null,
        documents: describeAgentDocuments(site, null, null),
      }
    },
  },
]
