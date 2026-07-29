import type { TSchema } from '@sinclair/typebox'
import {
  ComponentPublishCheckCommandSchema,
  ConfirmComponentSourceCommandSchema,
  CreateComponentVariantCommandSchema,
  CreateDeclarativeComponentCommandSchema,
  GetComponentCommandSchema,
  InsertComponentCommandSchema,
  InstallComponentCommandSchema,
  ListComponentUsageCommandSchema,
  PreviewComponentCommandSchema,
  SearchComponentsCommandSchema,
  UninstallComponentCommandSchema,
  UpgradeComponentCommandSchema,
  ValidateComponentSourceCommandSchema,
  type ComponentCatalogAction,
} from '../../../fuma/componentCatalog/contracts'
import type { AiTool, ToolContext } from '../../runtime/types'
import { siteComponentCatalogPort } from './componentCatalogPort'

function tool(input: Readonly<{ name: string; description: string; action: ComponentCatalogAction; schema: TSchema; mutates: boolean; capabilities: AiTool['requiredCapabilities']; mcpCapability: NonNullable<AiTool['mcpCapability']> }>): AiTool { return Object.freeze({ name: input.name, description: input.description, scope: 'site' as const, execution: 'server' as const, mutates: input.mutates, requiredCapabilities: input.capabilities, mcpCapability: input.mcpCapability, inputSchema: input.schema, handler: async (command: unknown, context: ToolContext) => { const port = siteComponentCatalogPort(); if (!port) throw new Error('Hosted component catalog authority is unavailable.'); return port.execute({ conversationId: context.conversationId, actorId: context.userId, operationId: context.toolCallId ?? `${context.conversationId}:${input.name}`, action: input.action, command, nativeAiAuthority: Boolean(context.authority) }) } }) }
export const siteComponentCatalogTools: readonly AiTool[] = Object.freeze([
  tool({ name: 'site_create_component', description: 'Create one immutable private declarative component version for this exact site owner. JSX is forbidden here.', action: 'create', schema: CreateDeclarativeComponentCommandSchema, mutates: true, capabilities: ['site.structure.edit'], mcpCapability: 'component.mutate' }),
  tool({ name: 'site_edit_component', description: 'Create a new exact immutable version of a private declarative component; never mutates prior bytes.', action: 'edit', schema: CreateDeclarativeComponentCommandSchema, mutates: true, capabilities: ['site.structure.edit'], mcpCapability: 'component.mutate' }),
  tool({ name: 'site_create_component_variant', description: 'Create a named visual variant in a new exact component version.', action: 'variant', schema: CreateComponentVariantCommandSchema, mutates: true, capabilities: ['site.structure.edit'], mcpCapability: 'component.mutate' }),
  tool({ name: 'site_preview_component', description: 'Read a declarative preview tree or restricted-client sandbox descriptor without publishing.', action: 'preview', schema: PreviewComponentCommandSchema, mutates: false, capabilities: ['site.read'], mcpCapability: 'component.read' }),
  tool({ name: 'site_validate_component_source', description: 'Statically audit and isolated-compile restricted React/Tailwind source. Returns exact permission disclosure; owner confirmation remains outside native AI.', action: 'validate-source', schema: ValidateComponentSourceCommandSchema, mutates: true, capabilities: ['site.structure.edit'], mcpCapability: 'component.create-source' }),
  tool({ name: 'site_confirm_component_artifact', description: 'Confirm exact validated restricted-client bytes and disclosed permissions. Native AI is denied; direct owner UI or explicitly granted MCP confirmation is required.', action: 'confirm-source', schema: ConfirmComponentSourceCommandSchema, mutates: true, capabilities: ['plugins.install'], mcpCapability: 'component.confirm' }),
  tool({ name: 'site_search_components', description: 'Search starter, private, installed, and currently reviewed component packs.', action: 'search', schema: SearchComponentsCommandSchema, mutates: false, capabilities: ['site.read'], mcpCapability: 'component.read' }),
  tool({ name: 'site_get_component', description: 'Get the exact TypeBox props, slots, variants, permissions, compatibility and immutable component definition.', action: 'get', schema: GetComponentCommandSchema, mutates: false, capabilities: ['site.read'], mcpCapability: 'component.read' }),
  tool({ name: 'site_install_component', description: 'Install one current signed reviewed component pack with exact permission grants and version pin.', action: 'install', schema: InstallComponentCommandSchema, mutates: true, capabilities: ['plugins.install'], mcpCapability: 'component.install' }),
  tool({ name: 'site_insert_component', description: 'Record exact component usage and return the canonical visual-editor insertion descriptor.', action: 'insert', schema: InsertComponentCommandSchema, mutates: true, capabilities: ['site.structure.edit'], mcpCapability: 'component.mutate' }),
  tool({ name: 'site_upgrade_component', description: 'Preview and apply a reviewed exact-version upgrade with affected usage, permission/schema diffs, owner confirmation, and rollback evidence.', action: 'upgrade', schema: UpgradeComponentCommandSchema, mutates: true, capabilities: ['plugins.install'], mcpCapability: 'component.install' }),
  tool({ name: 'site_list_component_usage', description: 'List page-node, Visual Component, template, and retained-release references that guard uninstall.', action: 'usage', schema: ListComponentUsageCommandSchema, mutates: false, capabilities: ['site.read'], mcpCapability: 'component.read' }),
  tool({ name: 'site_uninstall_component', description: 'Uninstall a catalog pin only when every durable usage class is empty; immutable artifact evidence is retained.', action: 'uninstall', schema: UninstallComponentCommandSchema, mutates: true, capabilities: ['plugins.install'], mcpCapability: 'component.install' }),
  tool({ name: 'site_check_component_publish', description: 'Fail closed before publish if any exact component pin is missing, incompatible, withdrawn, or security-revoked.', action: 'publish-check', schema: ComponentPublishCheckCommandSchema, mutates: false, capabilities: ['pages.publish'], mcpCapability: 'component.publish' }),
])
