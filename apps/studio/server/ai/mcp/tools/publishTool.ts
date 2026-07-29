/**
 * Explicit full-site publish tool for MCP connectors.
 *
 * Site editing tools write the live editor draft and the browser bridge flushes
 * that draft before returning. Publishing stays a separate operation so a
 * multi-tool edit cannot leak half-finished work to visitors. A connector that
 * was explicitly granted `pages.publish` can call this server-side tool after
 * its edit sequence is complete; the canonical publish pipeline rebuilds the
 * static slot, swaps it atomically, and bumps the in-memory publish version.
 */
import { Type } from '@core/utils/typeboxHelpers'
import type { AiTool, ToolContext } from '../../runtime/types'
import { createAuditEvent } from '../../../repositories/audit'
import { publishDraftSite } from '../../../publish/publishSite'

export interface McpPublishConfirmationInput {
  confirmationId: string
  stepUpReceiptId: string
  confirmedAt: string
}

export interface McpPublishRuntime {
  connectorId: string
  uploadsDir?: string
  publish?: (input: Readonly<{ confirmation: McpPublishConfirmationInput | null; context: ToolContext }>) => Promise<unknown>
}

export function createPublishMcpTool(runtime?: McpPublishRuntime): AiTool {
  return {
    name: 'site_publish',
    description:
      'Publish the saved site draft to the live public site. Call this ONCE after the requested site edits are complete — site_insert_html, site_apply_css, token tools, and other site writes save a draft and deliberately do not publish on their own. This runs the full-site publish pipeline, rebuilding content-hashed HTML/CSS/runtime assets and atomically swapping the public static slot. Requires the connector to have pages.publish.',
    scope: 'site',
    execution: 'server',
    mutates: true,
    requiredCapabilities: ['pages.publish'],
    inputSchema: Type.Object({
      confirmation: Type.Optional(Type.Object({
        confirmationId: Type.String({ minLength: 1, maxLength: 255 }),
        stepUpReceiptId: Type.String({ minLength: 1, maxLength: 255 }),
        confirmedAt: Type.String({ format: 'date-time' }),
      }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    handler: async (input, ctx: ToolContext) => {
      if (!runtime) {
        throw new Error('MCP publish runtime is not configured.')
      }
      const confirmation = (input as { confirmation?: McpPublishConfirmationInput }).confirmation ?? null
      if (runtime.publish) return runtime.publish({ confirmation, context: ctx })
      if (!runtime.uploadsDir) throw new Error('MCP publish uploads directory is not configured.')

      const result = await publishDraftSite(ctx.db, ctx.userId, runtime.uploadsDir)
      await createAuditEvent(ctx.db, {
        actorUserId: ctx.userId,
        action: 'publish',
        targetType: 'site',
        targetId: 'default',
        metadata: {
          publishedPages: result.publishedPages,
          source: 'mcp',
          connectorId: runtime.connectorId,
        },
      })
      return result
    },
  }
}

export function createComponentPublishMcpTool(runtime?: McpPublishRuntime): AiTool {
  const base = createPublishMcpTool(runtime)
  return {
    ...base,
    name: 'site_publish_components',
    mcpCapability: 'component.publish',
    description: 'Validate every exact component pin and security revocation, then publish through the existing site publisher. Requires component.publish plus a fresh operation-bound confirmation and step-up.',
    handler: async (input, context) => {
      const { siteComponentCatalogPort } = await import('../../tools/site/componentCatalogPort')
      const port = siteComponentCatalogPort()
      if (!port) throw new Error('Hosted component catalog authority is unavailable.')
      await port.execute({ conversationId: context.conversationId, actorId: context.userId, operationId: context.toolCallId ?? `${context.conversationId}:site_publish_components`, action: 'publish-check', command: {}, nativeAiAuthority: false })
      if (!base.handler) throw new Error('MCP publish runtime is unavailable.')
      return base.handler(input, context)
    },
  }
}
