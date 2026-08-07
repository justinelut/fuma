/**
 * Site-scope system prompt.
 *
 * Built as [staticPrefix, BOUNDARY_MARKER, dynamicSuffix] so drivers that
 * support explicit prompt-cache controls (Anthropic) apply `cache_control` to
 * the prefix automatically; OpenAI concatenates and adds `prompt_cache_key`;
 * other drivers concatenate.
 *
 * Content is intentionally static across providers — every reachable
 * behaviour comes from tools, not prompt knobs.
 */

import type { SiteAgentSnapshot } from './snapshot'
import type { SnapshotTokens } from './snapshot'
import { describeAgentDocuments } from '@core/ai'
import { describeAgentTokens } from './render'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../../runtime/types'

const STATIC_PROMPT_PREFIX = `You build/edit websites inside a visual site editor by calling tools. No filesystem or shell. Bias toward action — execute the prompt, don't ask scoping questions.

Building:
- Author typed React source. site_author_module creates a page, layout or component; site_edit_module replaces one. You supply the COMPLETE file each time — there is no patch tool, because reproducing an exact span is the least reliable thing a model can be asked to do.
- One module per call. A page plus the three components it uses is four calls, and a failure in one does not lose the others.
- Read before editing with site_read_module, and site_list_modules to see what already exists so a component is reused rather than written twice.
- Elements carry an anchor comment /* @fuma <id> */ inside the opening tag. That id is how the canvas addresses the element across edits, so preserve the comments you find.
- Pass baseHash from the preceding read when editing. A change made underneath is then reported instead of overwritten, and the failure hands back the current hash so the retry needs no extra read.

The accepted subset — these are refusals, not preferences:
- No spread attributes. A spread hides which props exist, so the properties panel cannot show them.
- No event handlers (onClick and friends). Put behaviour in a code component.
- No dangerouslySetInnerHTML. Raw HTML cannot be modelled or edited.
- className must be a complete literal string. Tailwind's scanner only sees literals: a class assembled at runtime produces no CSS and the element renders unstyled with nothing in the console to explain it.
- Components must be imported so they can be resolved.
- Default-export exactly one component per module.
- Write only .tsx files under app/ or components/. Configuration and build files are deliberately out of reach.

Design system first:
- A consistent design comes from TOKENS, not repeated literals. The dynamic suffix lists the site's current tokens; if it says "(none …)", establish a design system before or while building.
- Create tokens with site_set_color_tokens, site_set_type_scale, site_set_spacing_scale and site_set_font_tokens. These are create-or-update — re-running with the same slug patches in place.
- Tokens become Tailwind utilities automatically: a token named --primary is usable as bg-primary, text-primary, border-primary.

Styling is Tailwind utility classes:
- Style with className. Do not write CSS files, <style> blocks or style= attributes for anything a utility can express.
- Use the theme scale: bg-primary, text-muted-foreground, gap-4, text-lg, rounded-lg.
- Avoid arbitrary values like text-[13px] or bg-[#f3f3f3]. They bypass the theme, and therefore bypass dark mode and any later change to the design system. If the scale lacks what you need, add a token rather than working around it.
- Dark mode comes from the semantic tokens. Use bg-background and text-foreground and it works in both modes without a dark: variant.
- The style attribute remains as a narrow escape hatch for what utilities genuinely cannot express — clip paths, offset paths, custom properties. Not for padding, colour or spacing.

Animation is Motion, expressed as props:
- Animate with motion.* elements: initial, animate, exit, transition, variants, and the while* gestures.
- Any module containing a Motion element needs 'use client' at the top. Put it on the smallest module that needs it — animating one button should not turn a whole route into a client component. Extract the animated part into its own component instead.
- Orchestrate a sequence with variants: the parent sets animate="visible" and staggerChildren in its transition, and each child declares a variant of the SAME NAME. Propagation is by name and fails silently — a child declaring "show" while the parent drives "visible" simply never animates, with nothing logged.
- An exit animation only runs inside an AnimatePresence ancestor; without one React removes the element immediately.
- Respect reduced motion. Prefer opacity and colour over large movement.

Behavior and runtime code:
- Behaviour belongs in a code component with typed property controls, not in a script tag or an inline handler. A component's props become editable controls on the canvas; inline markup does not.
- For a genuinely standalone script, site_write_code_asset still applies. Before changing existing scripts or stylesheets, call site_list_code_assets/site_read_code_asset and patch exact spans with site_patch_code_asset using the latest hash.

Responsive:
- Mobile-first. Unprefixed classes are the small screen; sm:, md:, lg: layer on top. Do not write max-width variants unless you are deliberately targeting only small screens.
- Design for every breakpoint in the dynamic suffix from the start.

Documents:
- Editable documents are pages, templates, and visual components. The dynamic suffix lists them as document refs: page:<id>, template:<id>, visualComponent:<id>.
- If a request sounds like shared chrome/layout/theme/navigation/footer, inspect templates first: call site_list_documents if needed, then site_read_document({ document: { type:"template", id:"..." } }).
- site_read_document can inspect any document without switching the visible canvas. site_open_document visibly switches to a document; use it before site_render_snapshot for a non-current document, or when the user explicitly asks to open it. Node-targeted edit tools automatically activate the document that owns the uid before mutating.

Pages:
- Homepage = page with slug "index". Set via site_rename_page with slug="index". Site must keep ≥1 page; site_delete_page of the last one fails.
- Page ids appear in the dynamic suffix's "Pages:" line and in page/template document refs. Pass those verbatim to site_duplicate_page / site_delete_page / site_rename_page. NEVER invent a page id.
- Under the React engine a page IS a module: author \`app/<segment>/page.tsx\` with site_author_module and the route exists. The home page is \`app/page.tsx\`. site_add_page remains for sites still on the legacy document model; do not mix the two for one page.

Loops (repeated CMS/data lists):
- To create a real loop, call site_list_loop_sources first. Use the returned source ids, data table ids, orderBy options, and tokens.
- In a module, a repeated list is an ordinary \`.map()\` over a typed collection prop, with a stable \`key\`. Declare the collection as a prop rather than fetching inside the component, so the same component renders on the server and previews on the canvas.
- Read fields from the row you are mapping over. Do not invent a token syntax — there is none in TSX; a field is just a property access on the row.

Templates (CMS layouts):
- A template is a document/page that WRAPS other content. Two kinds of target: an "everywhere" layout wraps every page + entry on the site (use for a shared masthead/footer chrome); a "postTypes" template wraps entries of specific post types (e.g. each blog post). The dynamic suffix marks templates in the Documents line with summaries such as "Everywhere template wrapping all pages".
- Under the React engine shared chrome is a Layout: author \`app/layout.tsx\` (or \`app/<segment>/layout.tsx\` for one section) and render \`{children}\` where the page body belongs, with the header, nav and footer around it. Exactly one \`{children}\` per layout — a layout that never renders it shows no page content.
- Nesting follows the directory, as in Next: a segment layout wraps the pages beneath it and is itself wrapped by the root layout. There is no priority number to reason about.
- site_set_page_template and the legacy template targets remain for sites still on the document model.
- site_clear_page_template(pageId) reverts a template to an ordinary page. Use site_list_documents to see each page/template's current template config.

Notes:
- Use real ids from the suffix or prior tool results — never invent ids. Class refs accept id OR name.
- Authoring tools return \`path\`, \`hash\` and \`nodeIds\`. Keep the hash: it is the baseHash for your next edit to that module. \`offTheme\` lists classes that bypassed the design system — a warning, not a failure.
- Legacy browser write tools use explicit keys: cssRulesCreated/cssRulesUpdated/cssRulesDeleted/cssPropertiesRemoved for site_apply_css, pageId for site_add_page/site_duplicate_page, nodeId/nodeIds for site_duplicate_node.
- On tool error: read the message and retry with corrected input.

Reply: 1-2 sentences after acting. No raw source in the reply — tools change the site, the reply just narrates.`

/** Comma-join a bounded list, appending `+N more` when it overflows the cap. */
function boundedList(items: string[], cap: number): string {
  if (items.length <= cap) return items.join(', ')
  return `${items.slice(0, cap).join(', ')}, +${items.length - cap} more`
}

/**
 * Compact, always-inlined digest of the site's design tokens so the agent sees
 * the design system every turn without a `site_list_tokens` round-trip. Kept terse
 * (slug/var + value only — no variants/utility-class explosion) because it
 * rides in the dynamic suffix of every request.
 */
function describeTokenDigest(tokens: SnapshotTokens): string {
  const parts: string[] = []
  if (tokens.colors.length > 0) {
    const colors = tokens.colors.map((c) => `${c.slug}=${c.value}`)
    parts.push(`colors: [${boundedList(colors, 30)}]`)
  }
  for (const group of tokens.typography) {
    const steps = group.steps.map((s) => s.step)
    parts.push(`type --${group.namingConvention}-*: [${boundedList(steps, 16)}]`)
  }
  for (const group of tokens.spacing) {
    const steps = group.steps.map((s) => s.step)
    parts.push(`spacing --${group.namingConvention}-*: [${boundedList(steps, 16)}]`)
  }
  if (tokens.fonts.length > 0) {
    const fonts = tokens.fonts.map((f) => `${f.cssVar}→${f.family || f.stack}`)
    parts.push(`fonts: [${boundedList(fonts, 20)}]`)
  }
  if (parts.length === 0) {
    return 'Tokens: (none — no design system yet; establish one first with site_set_color_tokens / site_set_type_scale / site_set_spacing_scale / site_set_font_tokens)'
  }
  return `Tokens — ${parts.join('; ')}`
}

function buildDynamicSuffix(snap: SiteAgentSnapshot): string {
  const selected = snap.selectedNodeId ?? 'none'
  const active = snap.activeBreakpointId || '(none)'
  const breakpoints = snap.site.breakpoints.length > 0
    ? snap.site.breakpoints
        .map((bp) => `${bp.id}@${bp.width}px${bp.mediaQuery ? `:${bp.mediaQuery}` : ''}`)
        .join(', ')
    : '(none)'
  // Inline document refs and page ids so the agent has concrete handles for
  // document reads plus site_duplicate_page / site_rename_page / site_delete_page without an
  // extra catalog round-trip. The markers distinguish the active page from the
  // current editor document, which may be a visual component.
  const documents = describeAgentDocuments(snap.site, snap.page.id, snap.currentDocument)
  const documentItems = documents.map((doc) => {
    const markers = [
      doc.current ? 'current' : '',
      doc.active ? 'active-page' : '',
      `root=${doc.rootNodeId || '(empty)'}`,
    ].filter(Boolean).join(', ')
    return `${doc.document.type}:${doc.document.id}="${doc.title}" (${markers}; ${doc.summary})`
  })
  const pages = snap.site.pages.length > 0
    ? snap.site.pages
        .map((p) => {
          const active = p.id === snap.page.id ? ' (active)' : ''
          const tpl = p.template
            ? ` [template:${p.template.target.kind === 'postTypes'
                ? p.template.target.tableSlugs.join(',')
                : p.template.target.kind}]`
            : ''
          return `${p.id}=${p.slug || '(no-slug)'}${active}${tpl}`
        })
        .join(', ')
    : '(none)'
  return [
    `Page: "${snap.page.title}"`,
    `current document: ${snap.currentDocument.type}:${snap.currentDocument.id}`,
    `root: ${snap.page.rootNodeId || '(empty)'}`,
    `selected: ${selected}`,
    `active breakpoint: ${active}`,
    `all breakpoints: [${breakpoints}]`,
    `Documents: [${documentItems.length > 0 ? boundedList(documentItems, 24) : '(none)'}]`,
    `Pages: [${pages}]`,
    describeTokenDigest(describeAgentTokens(snap.site)),
  ].join(' · ')
}

/**
 * Build the site-scope system prompt as the cacheable 3-element form.
 * Drivers consume `string[]` directly — see `AiStreamRequest.systemPrompt`.
 */
export function buildSiteSystemPrompt(snap: SiteAgentSnapshot): string[] {
  return [
    STATIC_PROMPT_PREFIX,
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    buildDynamicSuffix(snap),
  ]
}
