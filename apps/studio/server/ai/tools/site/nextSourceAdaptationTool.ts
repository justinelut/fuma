import type { AiTool, ToolContext } from '../../runtime/types'
import {
  NextSourceAdaptationCommandSchema,
  NextSourceInteractionMappingCommandSchema,
  nextSourceAdaptationToolPort,
} from './nextSourceAdaptationPort'

export const NEXT_SOURCE_ADAPTATION_TOOL_NAME = 'site_propose_source_fix'

export const nextSourceAdaptationTool: AiTool = Object.freeze({
  name: NEXT_SOURCE_ADAPTATION_TOOL_NAME,
  description: 'Propose a hash-bound patch for diagnostics on an exact imported Next.js source revision. Executable changes remain blocked until a distinct direct owner confirms the diff.',
  scope: 'site',
  execution: 'server',
  mutates: true,
  requiredCapabilities: ['site.structure.edit'] as const,
  inputSchema: NextSourceAdaptationCommandSchema,
  handler: async (command: unknown, context: ToolContext) => {
    const port = nextSourceAdaptationToolPort()
    if (!port) throw new Error('Hosted next source adaptation authority is unavailable.')
    if (!context.toolCallId) throw new Error('Exact native tool-call identity is required for source adaptation.')
    return port.execute({
      conversationId: context.conversationId,
      actorId: context.userId,
      operationId: context.toolCallId,
      command,
    })
  },
})

export const NEXT_SOURCE_INTERACTION_MAPPING_TOOL_NAME = 'site_map_source_interactions'

export const nextSourceInteractionMappingTool: AiTool = Object.freeze({
  name: NEXT_SOURCE_INTERACTION_MAPPING_TOOL_NAME,
  description: 'Map exact detected Next.js source interactions to existing reviewed Fuma authorities. Unsupported, provider-specific, podcast, and dynamic behavior remains blocking.',
  scope: 'site',
  execution: 'server',
  mutates: true,
  requiredCapabilities: ['site.structure.edit'] as const,
  inputSchema: NextSourceInteractionMappingCommandSchema,
  handler: async (command: unknown, context: ToolContext) => {
    const port = nextSourceAdaptationToolPort()
    if (!port) throw new Error('Hosted next source adaptation authority is unavailable.')
    if (!context.toolCallId) throw new Error('Exact native tool-call identity is required for source interaction mapping.')
    return port.mapInteractions({
      conversationId: context.conversationId,
      actorId: context.userId,
      operationId: context.toolCallId,
      command,
    })
  },
})
